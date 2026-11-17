import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  listAvailableWindows,
  setCashierWindowAssignment,
} from '../src/services/window-assignment-service.js'

function makeWindow(number, overrides = {}) {
  return {
    id: `window-${number}`,
    window_number: number,
    window_name: `Window ${number}`,
    is_active: true,
    availability_status: 'available',
    ...overrides,
  }
}

class AssignmentDatabase {
  constructor({ staff, windows, tickets = [] }) {
    this.staff = staff.map((cashier) => ({ ...cashier }))
    this.windows = windows.map((window) => ({ ...window }))
    this.tickets = tickets.map((ticket) => ({ ...ticket }))
    this.windowLock = Promise.resolve()
  }

  async query(sql) {
    assert.match(sql, /NOT EXISTS/)
    return {
      rows: this.windows
        .filter((window) => window.is_active
          && window.availability_status === 'available'
          && !this.staff.some((cashier) => cashier.role === 'cashier'
            && cashier.is_active
            && cashier.assigned_window_id === window.id))
        .map(({ id, window_number, window_name }) => ({
          id,
          window_number,
          window_name,
        })),
    }
  }

  async connect() {
    const client = {
      unlockWindow: null,
      release: () => {},
      query: async (sql, values = []) => {
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) {
          if (sql === 'COMMIT' || sql === 'ROLLBACK') {
            client.unlockWindow?.()
            client.unlockWindow = null
          }
          return { rows: [] }
        }

        if (sql.includes('FROM staff') && sql.includes("role = 'cashier'")
          && sql.includes('FOR UPDATE')) {
          const cashier = this.staff.find(({ id }) => id === values[0])
          return { rows: cashier ? [{ ...cashier }] : [] }
        }
        if (sql.includes('FROM cashier_windows') && sql.includes('FOR UPDATE')) {
          const previous = this.windowLock
          let unlock
          this.windowLock = new Promise((resolve) => { unlock = resolve })
          await previous
          client.unlockWindow = unlock
          const ids = values[0]
          return {
            rows: this.windows.filter(({ id }) => ids.includes(id)).map((window) => ({
              ...window,
            })),
          }
        }
        if (sql.includes('FROM staff') && sql.includes('assigned_window_id = $1')) {
          const assigned = this.staff.find((cashier) => (
            cashier.role === 'cashier'
            && cashier.is_active
            && cashier.assigned_window_id === values[0]
            && cashier.id !== values[1]
          ))
          return { rows: assigned ? [{ id: assigned.id }] : [] }
        }
        if (sql.includes('FROM queue_tickets') && sql.includes("status = 'serving'")) {
          return {
            rows: this.tickets
              .filter((ticket) => ticket.window_id === values[0] && ticket.status === 'serving')
              .map(({ id }) => ({ id })),
          }
        }
        if (sql.includes('UPDATE staff') && sql.includes('SET assigned_window_id = $2')) {
          const cashier = this.staff.find(({ id }) => id === values[0])
          cashier.assigned_window_id = values[1]
          return { rows: [] }
        }
        throw new Error(`Unexpected database query: ${sql}`)
      },
    }
    return client
  }
}

function cashier(id, assignedWindowId = null, isActive = true) {
  return {
    id,
    username: id,
    role: 'cashier',
    is_active: isActive,
    assigned_window_id: assignedWindowId,
  }
}

test('cashier can select an available window through a locked backend transaction', async () => {
  const staffId = randomUUID()
  const database = new AssignmentDatabase({
    staff: [cashier(staffId)],
    windows: [makeWindow(1)],
  })

  assert.deepEqual(await listAvailableWindows({ database }), [{
    id: 'window-1',
    number: 1,
    name: 'Window 1',
  }])
  const result = await setCashierWindowAssignment({
    database,
    staffId,
    windowId: 'window-1',
  })

  assert.deepEqual(result, { assignedWindowId: 'window-1' })
  assert.equal(database.staff[0].assigned_window_id, 'window-1')
})

test('two cashiers competing for the same window cannot both receive it', async () => {
  const firstId = randomUUID()
  const secondId = randomUUID()
  const database = new AssignmentDatabase({
    staff: [cashier(firstId), cashier(secondId)],
    windows: [makeWindow(1)],
  })

  const results = await Promise.allSettled([
    setCashierWindowAssignment({ database, staffId: firstId, windowId: 'window-1' }),
    setCashierWindowAssignment({ database, staffId: secondId, windowId: 'window-1' }),
  ])

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1)
  const rejected = results.find(({ status }) => status === 'rejected')
  assert.equal(rejected.reason.status, 409)
  assert.equal(database.staff.filter(({ assigned_window_id }) => assigned_window_id).length, 1)
})

test('cashier selection rejects unavailable and occupied windows', async () => {
  const staffId = randomUUID()
  const occupantId = randomUUID()
  const unavailableDatabase = new AssignmentDatabase({
    staff: [cashier(staffId)],
    windows: [makeWindow(1, { availability_status: 'unavailable' })],
  })
  const occupiedDatabase = new AssignmentDatabase({
    staff: [cashier(staffId), cashier(occupantId, 'window-1')],
    windows: [makeWindow(1)],
  })

  for (const database of [unavailableDatabase, occupiedDatabase]) {
    await assert.rejects(
      setCashierWindowAssignment({ database, staffId, windowId: 'window-1' }),
      (error) => error.status === 409,
    )
    assert.equal(database.staff.find(({ id }) => id === staffId).assigned_window_id, null)
  }
})

test('cashier can switch and release windows only when no ticket is being served', async () => {
  const staffId = randomUUID()
  const database = new AssignmentDatabase({
    staff: [cashier(staffId, 'window-1')],
    windows: [makeWindow(1), makeWindow(2)],
  })

  await setCashierWindowAssignment({ database, staffId, windowId: 'window-2' })
  assert.equal(database.staff[0].assigned_window_id, 'window-2')
  assert.deepEqual(await listAvailableWindows({ database }), [{
    id: 'window-1',
    number: 1,
    name: 'Window 1',
  }])

  await setCashierWindowAssignment({ database, staffId, windowId: null })
  assert.equal(database.staff[0].assigned_window_id, null)
  assert.equal((await listAvailableWindows({ database })).length, 2)

  database.staff[0].assigned_window_id = 'window-1'
  database.tickets.push({
    id: 'serving-ticket',
    window_id: 'window-1',
    status: 'serving',
  })
  await assert.rejects(
    setCashierWindowAssignment({ database, staffId, windowId: null }),
    (error) => error.status === 409
      && error.message.includes('ticket is being served'),
  )
  assert.equal(database.staff[0].assigned_window_id, 'window-1')
  assert.equal(database.tickets[0].status, 'serving')
})
