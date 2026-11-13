-- Apply once to the existing QueueMate database before using cashier login.
-- This is additive: it preserves all existing records and does not change grants
-- or policies on any existing table.
CREATE TABLE IF NOT EXISTS public.auth_sessions (
  session_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  expires_at timestamp with time zone NOT NULL,
  revoked_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS auth_sessions_staff_id_idx
  ON public.auth_sessions (staff_id);

CREATE INDEX IF NOT EXISTS auth_sessions_expires_at_idx
  ON public.auth_sessions (expires_at);

ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
