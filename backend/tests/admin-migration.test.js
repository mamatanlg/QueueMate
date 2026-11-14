import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const migrationUrl = new URL(
  '../../database/migrations/002_active_cashier_window_assignments.sql',
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
