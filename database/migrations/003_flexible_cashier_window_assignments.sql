-- Allow cashier accounts to exist without a counter assignment.
-- Migration 002's partial unique index continues to enforce one active cashier
-- per window; each cashier has only one assigned_window_id column.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.staff
    WHERE role = 'cashier'
      AND is_active = true
      AND assigned_window_id IS NOT NULL
    GROUP BY assigned_window_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION
      'Cannot migrate cashier window assignments: duplicate active cashier assignments exist';
  END IF;

  EXECUTE
    'ALTER TABLE public.staff
     DROP CONSTRAINT IF EXISTS staff_assigned_window_id_key';

  EXECUTE
    'CREATE UNIQUE INDEX IF NOT EXISTS staff_one_active_cashier_per_window_idx
     ON public.staff (assigned_window_id)
     WHERE role = ''cashier'' AND is_active = true';

  EXECUTE
    'ALTER TABLE public.staff
     DROP CONSTRAINT IF EXISTS staff_window_role_check';

  EXECUTE
    'ALTER TABLE public.staff
     ADD CONSTRAINT staff_window_role_check
     CHECK (
       role = ''cashier''
       OR (role = ''admin'' AND assigned_window_id IS NULL)
     )';
END
$migration$;
