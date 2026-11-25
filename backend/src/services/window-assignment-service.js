import { HttpError } from '../middleware/http-error.js'
import { withTransaction } from '../db/transaction.js'
import { writeAuditLog } from './audit-service.js'

export async function lockCashier(client, staffId) {
  const result = await client.query(
    `SELECT id, username, is_active, assigned_window_id
     FROM staff
     WHERE id = $1 AND role = 'cashier'
     FOR UPDATE`,
    [staffId],
  )
  const cashier = result.rows[0]
  if (!cashier) throw new HttpError(404, 'Cashier not found')
  return cashier
}

export async function assertNoServingTicket(client, windowId) {
  const result = await client.query(
    `SELECT id
     FROM queue_tickets
     WHERE window_id = $1 AND status = 'serving'
     LIMIT 1
     FOR UPDATE`,
    [windowId],
  )
  if (result.rows.length > 0) {
    throw new HttpError(409, 'Cannot change window assignment while a ticket is being served')
  }
}

async function lockWindows(client, windowIds) {
  const ids = [...new Set(windowIds.filter(Boolean))].sort()
  if (ids.length === 0) return []

  const result = await client.query(
    `SELECT id, window_number, window_name, is_active, availability_status
     FROM cashier_windows
     WHERE id = ANY($1::uuid[])
     ORDER BY id
     FOR UPDATE`,
    [ids],
  )
  return result.rows
}

async function ensureWindowUnoccupied(client, windowId, cashierId) {
  const result = await client.query(
    `SELECT id
     FROM staff
     WHERE role = 'cashier'
       AND is_active = true
       AND assigned_window_id = $1
       AND id <> $2
     LIMIT 1`,
    [windowId, cashierId],
  )
  if (result.rows.length > 0) {
    throw new HttpError(409, 'Window is assigned to another active cashier')
  }
}

export async function lockAssignableWindow(client, windowId, cashierId = null, {
  requireAvailable = false,
} = {}) {
  const windows = await lockWindows(client, [windowId])
  const window = windows[0]
  if (!window) throw new HttpError(404, 'Window not found')
  if (!window.is_active) throw new HttpError(409, 'Window is inactive')
  if (requireAvailable && window.availability_status !== 'available') {
    throw new HttpError(409, 'Window is unavailable')
  }

  if (cashierId === null) {
    const result = await client.query(
      `SELECT id
       FROM staff
       WHERE role = 'cashier'
         AND is_active = true
         AND assigned_window_id = $1
       LIMIT 1`,
      [windowId],
    )
    if (result.rows.length > 0) {
      throw new HttpError(409, 'Window is assigned to another active cashier')
    }
  } else {
    await ensureWindowUnoccupied(client, windowId, cashierId)
  }
  await assertNoServingTicket(client, windowId)
  return window
}

export async function setCashierWindowInTransaction(client, cashier, windowId, {
  requireAvailable = false,
} = {}) {
  if (windowId === cashier.assigned_window_id) return false
  if (windowId !== null && !cashier.is_active) {
    throw new HttpError(409, 'Reactivate the cashier before assigning a window')
  }

  const windows = await lockWindows(client, [
    cashier.assigned_window_id,
    windowId,
  ])
  const previousWindow = windows.find(({ id }) => id === cashier.assigned_window_id)
  const nextWindow = windowId === null
    ? null
    : windows.find(({ id }) => id === windowId)

  if (cashier.assigned_window_id && !previousWindow) {
    throw new HttpError(404, 'Assigned window not found')
  }
  if (windowId !== null && !nextWindow) throw new HttpError(404, 'Window not found')

  if (nextWindow) {
    if (!nextWindow.is_active) throw new HttpError(409, 'Window is inactive')
    if (requireAvailable && nextWindow.availability_status !== 'available') {
      throw new HttpError(409, 'Window is unavailable')
    }
    await ensureWindowUnoccupied(client, windowId, cashier.id)
    await assertNoServingTicket(client, windowId)
  }
  if (previousWindow) await assertNoServingTicket(client, previousWindow.id)

  await client.query(
    `UPDATE staff
     SET assigned_window_id = $2, updated_at = NOW()
     WHERE id = $1 AND role = 'cashier'`,
    [cashier.id, windowId],
  )
  return true
}

export async function listAvailableWindows({ database }) {
  const result = await database.query(`
    SELECT w.id, w.window_number, w.window_name
    FROM cashier_windows w
    WHERE w.is_active = true
      AND w.availability_status = 'available'
      AND NOT EXISTS (
        SELECT 1
        FROM staff s
        WHERE s.role = 'cashier'
          AND s.is_active = true
          AND s.assigned_window_id = w.id
      )
    ORDER BY w.window_number
  `)

  return result.rows.map((window) => ({
    id: window.id,
    number: window.window_number,
    name: window.window_name,
  }))
}

export async function setCashierWindowAssignment({
  database,
  actor,
  staffId,
  windowId,
}) {
  try {
    return await withTransaction(database, async (client) => {
      const cashier = await lockCashier(client, staffId)
      if (!cashier.is_active) throw new HttpError(409, 'Cashier account is inactive')
      const changed = await setCashierWindowInTransaction(client, cashier, windowId, {
        requireAvailable: windowId !== null,
      })
      if (changed) {
        await writeAuditLog(client, {
          actor,
          action: 'staff.account.updated',
          affectedTable: 'staff',
          affectedRecordId: staffId,
          details: {
            changedFields: ['assignedWindow'],
            assignedWindowId: windowId,
          },
        })
      }
      return { assignedWindowId: windowId }
    })
  } catch (error) {
    if (error?.code === '23505') {
      throw new HttpError(409, 'Window is assigned to another active cashier')
    }
    throw error
  }
}
