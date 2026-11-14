-- Preserve inactive cashier assignments for historical reference while
-- enforcing one active cashier per window. Existing active conflicts must be
-- resolved explicitly before this migration; no staff or history is changed.
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
    'CREATE UNIQUE INDEX staff_one_active_cashier_per_window_idx
     ON public.staff (assigned_window_id)
     WHERE role = ''cashier'' AND is_active = true';
END
$migration$;
