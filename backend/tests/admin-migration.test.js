import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../database/migrations/002_active_cashier_window_assignments.sql',
  import.meta.url,
)
const flexibleMigrationUrl = new URL(
  '../../database/migrations/003_flexible_cashier_window_assignments.sql',
  import.meta.url,
)
const systemAdminMigrationUrl = new URL(
  '../../database/migrations/004_system_admin_audit_logs.sql',
  import.meta.url,
)

test('active cashier assignment migration guards conflicts and preserves historical rows', async () => {
  const migration = await readFile(migrationUrl, 'utf8')

  assert.match(migration, /DO \$migration\$[\s\S]*RAISE EXCEPTION/)
  assert.match(migration, /role = 'cashier'[\s\S]*is_active = true/)
  assert.match(migration, /GROUP BY assigned_window_id[\s\S]*HAVING COUNT\(\*\) > 1/)
  assert.match(migration, /DROP CONSTRAINT IF EXISTS staff_assigned_window_id_key/)
  assert.match(migration, /CREATE UNIQUE INDEX staff_one_active_cashier_per_window_idx/)
  assert.match(migration, /WHERE role = ''cashier'' AND is_active = true/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE)\s+/im)
  assert.doesNotMatch(migration, /\b(?:FOREIGN KEY|REFERENCES|queue_tickets|queue_history)\b/i)
})

test('flexible assignment migration permits unassigned cashiers and preserves active-window uniqueness', async () => {
  const migration = await readFile(flexibleMigrationUrl, 'utf8')

  assert.match(migration, /DROP CONSTRAINT IF EXISTS staff_window_role_check/)
  assert.match(migration, /role = ''cashier''\s+OR \(role = ''admin'' AND assigned_window_id IS NULL\)/)
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS staff_one_active_cashier_per_window_idx/)
  assert.match(migration, /WHERE role = ''cashier'' AND is_active = true/)
  assert.match(migration, /GROUP BY assigned_window_id[\s\S]*HAVING COUNT\(\*\) > 1/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE)\s+/im)
  assert.doesNotMatch(migration, /\b(?:REFERENCES|queue_tickets|queue_history)\b/i)
})

test('System Admin migration is additive and makes audit records append-only', async () => {
  const migration = await readFile(systemAdminMigrationUrl, 'utf8')

  assert.match(migration, /role IN \('cashier', 'admin', 'system_admin'\)/)
  assert.match(migration, /role IN \('admin', 'system_admin'\) AND assigned_window_id IS NULL/)
  assert.match(migration, /CREATE TABLE public\.audit_logs/)
  assert.match(migration, /actor_staff_id uuid/)
  assert.match(migration, /action varchar\(100\) NOT NULL/)
  assert.match(migration, /details jsonb NOT NULL/)
  assert.match(migration, /created_at timestamptz NOT NULL DEFAULT now\(\)/)
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/)
  assert.match(migration, /BEFORE UPDATE OR DELETE ON public\.audit_logs/)
  assert.match(migration, /RAISE EXCEPTION 'Audit log records are append-only'/)
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE)\s+/im)
  assert.doesNotMatch(migration, /\b(?:queue_tickets|queue_history)\b/i)
})
