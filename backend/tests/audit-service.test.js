import assert from 'node:assert/strict'
import test from 'node:test'
import { listAuditLogs, writeAuditLog } from '../src/services/audit-service.js'

test('audit writes include actor and affected record without exposing credential values', async () => {
  let call
  await writeAuditLog({
    async query(sql, values) {
      call = { sql, values }
      return { rows: [] }
    },
  }, {
    actor: {
      staff_id: 'staff-1',
      username: 'admin1',
      role: 'admin',
    },
    action: 'staff.account.updated',
    affectedTable: 'staff',
    affectedRecordId: 'cashier-1',
    details: {
      changedFields: ['username', 'password'],
      username: 'cashier2',
    },
  })

  assert.match(call.sql, /INSERT INTO audit_logs/)
  assert.deepEqual(call.values.slice(0, 6), [
    'staff-1',
    'admin1',
    'admin',
    'staff.account.updated',
    'staff',
    'cashier-1',
  ])
  assert.equal(call.values[6].includes('valid-admin-password'), false)
  assert.deepEqual(JSON.parse(call.values[6]), {
    changedFields: ['username', 'password'],
    username: 'cashier2',
  })
})

test('audit-log reads return a bounded newest-first list in the API shape', async () => {
  let query
  const timestamp = new Date('2026-11-25T10:00:00.000Z')
  const auditLogs = await listAuditLogs({
    database: {
      async query(sql) {
        query = sql
        return {
          rows: [{
            id: '17',
            actor_staff_id: 'staff-1',
            actor_username: 'admin1',
            actor_role: 'admin',
            action: 'queue.ticket.called',
            affected_table: 'queue_tickets',
            affected_record_id: 'ticket-1',
            details: { queueNumber: 8 },
            created_at: timestamp,
          }],
        }
      },
    },
  })

  assert.match(query, /ORDER BY created_at DESC, id DESC\s+LIMIT 100/)
  assert.deepEqual(auditLogs, [{
    id: '17',
    actor: { staffId: 'staff-1', username: 'admin1', role: 'admin' },
    action: 'queue.ticket.called',
    affectedRecord: { table: 'queue_tickets', id: 'ticket-1' },
    details: { queueNumber: 8 },
    timestamp,
  }])
})
