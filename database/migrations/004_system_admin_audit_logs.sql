-- Add a separately provisioned system administrator role without promoting
-- existing administrators or changing staff and queue records.
ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_role_check;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_role_check
  CHECK (role IN ('cashier', 'admin', 'system_admin'));

ALTER TABLE public.staff
  DROP CONSTRAINT IF EXISTS staff_window_role_check;

ALTER TABLE public.staff
  ADD CONSTRAINT staff_window_role_check
  CHECK (
    (role = 'cashier')
    OR (role IN ('admin', 'system_admin') AND assigned_window_id IS NULL)
  );

CREATE TABLE public.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_staff_id uuid,
  actor_username varchar(100),
  actor_role varchar(20),
  action varchar(100) NOT NULL,
  affected_table varchar(50),
  affected_record_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_logs_details_object_check
    CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX audit_logs_created_at_idx
  ON public.audit_logs (created_at DESC, id DESC);

CREATE INDEX audit_logs_action_created_at_idx
  ON public.audit_logs (action, created_at DESC);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'Audit log records are append-only';
END;
$function$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_mutation();
