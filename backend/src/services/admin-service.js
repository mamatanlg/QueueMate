import bcrypt from 'bcrypt'
import { HttpError } from '../middleware/http-error.js'
import { withTransaction } from '../db/transaction.js'
import {
  assertNoServingTicket,
  lockAssignableWindow,
  setCashierWindowInTransaction,
} from './window-assignment-service.js'

const passwordRounds = 12

const cashierSelect = `
  SELECT s.id, s.username, s.display_name, s.is_active,
         s.assigned_window_id, s.created_at, s.updated_at,
         w.window_number, w.window_name, w.is_active AS window_is_active
  FROM staff s
  LEFT JOIN cashier_windows w ON w.id = s.assigned_window_id
  WHERE s.role = 'cashier'
`

function mapCashier(row) {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    isActive: row.is_active,
    assignedWindow: row.assigned_window_id
      ? {
          id: row.assigned_window_id,
          number: row.window_number,
          name: row.window_name,
          isActive: row.window_is_active,
        }
      : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function mapWindow(row) {
  return {
    id: row.id,
    number: row.window_number,
    name: row.window_name,
    isActive: row.is_active,
    availabilityStatus: row.availability_status,
    assignedCashier: row.cashier_id
      ? {
          id: row.cashier_id,
          username: row.cashier_username,
          displayName: row.cashier_display_name,
        }
      : null,
  }
}

async function findCashier(database, staffId) {
  const result = await database.query(
    `${cashierSelect}
     AND s.id = $1`,
    [staffId],
  )
  const row = result.rows[0]
  if (!row) throw new HttpError(404, 'Cashier not found')
  return mapCashier(row)
}

async function lockCashier(client, staffId) {
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

async function ensureUsernameAvailable(client, username, staffId = null) {
  const result = await client.query(
    `SELECT id
     FROM staff
     WHERE lower(username) = lower($1)
       AND ($2::uuid IS NULL OR id <> $2)
     LIMIT 1`,
    [username, staffId],
  )
  if (result.rows.length > 0) {
    throw new HttpError(409, 'Username is already in use')
  }
}

function mapCashierWriteError(error, conflictMessage) {
  if (error?.code === '23505') {
    if (error.constraint === 'staff_username_key') {
      throw new HttpError(409, 'Username is already in use')
    }
    throw new HttpError(409, conflictMessage)
  }
  if (error?.code === '23514' && error.constraint === 'staff_window_role_check') {
    console.error('Cashier assignment schema blocks an unassigned account', {
      code: error.code,
      constraint: error.constraint,
    })
    throw new HttpError(
      503,
      'The database does not yet support cashiers without a window. Apply migrations 002 and 003, in order.',
    )
  }
  throw error
}

export async function listCashiers({ database }) {
  const result = await database.query(
    `${cashierSelect}
     ORDER BY lower(s.username), s.id`,
  )
  return result.rows.map(mapCashier)
}

export async function listStaff({ database }) {
  const result = await database.query(`
    SELECT s.id, s.username, s.display_name, s.role, s.is_active,
           s.assigned_window_id, s.created_at, s.updated_at,
           w.window_number, w.window_name, w.is_active AS window_is_active
    FROM staff s
    LEFT JOIN cashier_windows w ON w.id = s.assigned_window_id
    ORDER BY s.role, lower(s.username), s.id
  `)
  return result.rows.map((row) => ({
    ...mapCashier(row),
    role: row.role,
  }))
}

export async function getCashier({ database, staffId }) {
  return findCashier(database, staffId)
}

export async function createCashier({
  database,
  username,
  displayName,
  password,
  windowId,
}) {
  const normalizedUsername = username.trim().toLowerCase()
  const passwordHash = await bcrypt.hash(password, passwordRounds)

  try {
    return await withTransaction(database, async (client) => {
      if (windowId) await lockAssignableWindow(client, windowId)
      await ensureUsernameAvailable(client, normalizedUsername)

      const result = await client.query(
        `INSERT INTO staff
           (username, password_hash, display_name, role, assigned_window_id, is_active)
         VALUES ($1, $2, $3, 'cashier', $4, true)
         RETURNING id`,
        [normalizedUsername, passwordHash, displayName.trim(), windowId ?? null],
      )
      return findCashier(client, result.rows[0].id)
    })
  } catch (error) {
    mapCashierWriteError(
      error,
      'Cashier window assignment conflicts with an existing account',
    )
  }
}

export async function updateCashier({
  database,
  staffId,
  username,
  displayName,
  password,
  windowId,
}) {
  const normalizedUsername = username?.trim().toLowerCase()
  const passwordHash = password === undefined
    ? undefined
    : await bcrypt.hash(password, passwordRounds)

  try {
    return await withTransaction(database, async (client) => {
      const cashier = await lockCashier(client, staffId)
      if (normalizedUsername !== undefined) {
        await ensureUsernameAvailable(client, normalizedUsername, staffId)
      }
      const windowChanged = windowId !== undefined
        && windowId !== cashier.assigned_window_id
      if (windowChanged) {
        await setCashierWindowInTransaction(client, cashier, windowId)
      }

      const updates = []
      const values = []
      if (normalizedUsername !== undefined) {
        values.push(normalizedUsername)
        updates.push(`username = $${values.length}`)
      }
      if (displayName !== undefined) {
        values.push(displayName.trim())
        updates.push(`display_name = $${values.length}`)
      }
      if (passwordHash !== undefined) {
        values.push(passwordHash)
        updates.push(`password_hash = $${values.length}`)
      }
      updates.push('updated_at = NOW()')
      values.push(staffId)

      await client.query(
        `UPDATE staff
         SET ${updates.join(', ')}
         WHERE id = $${values.length} AND role = 'cashier'`,
        values,
      )

      if (normalizedUsername !== undefined
        || passwordHash !== undefined
        || windowChanged) {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = NOW()
           WHERE staff_id = $1 AND revoked_at IS NULL`,
          [staffId],
        )
      }

      return findCashier(client, staffId)
    })
  } catch (error) {
    mapCashierWriteError(error, 'Cashier details conflict with an existing account')
  }
}

export async function setCashierActive({
  database,
  staffId,
  actorStaffId,
  isActive,
}) {
  if (!isActive && staffId === actorStaffId) {
    throw new HttpError(409, 'Administrators cannot deactivate their own account')
  }

  try {
    return await withTransaction(database, async (client) => {
      const cashier = await lockCashier(client, staffId)

      if (isActive && cashier.assigned_window_id) {
        await lockAssignableWindow(client, cashier.assigned_window_id, staffId)
      } else if (!isActive && cashier.assigned_window_id) {
        await assertNoServingTicket(client, cashier.assigned_window_id)
      }

      const updated = await client.query(
        `UPDATE staff
         SET is_active = $2, updated_at = NOW()
         WHERE id = $1 AND role = 'cashier'
         RETURNING id`,
        [staffId, isActive],
      )

      if (!isActive || !cashier.is_active) {
        await client.query(
          `UPDATE auth_sessions
           SET revoked_at = NOW()
           WHERE staff_id = $1 AND revoked_at IS NULL`,
          [staffId],
        )
      }

      return findCashier(client, updated.rows[0].id)
    })
  } catch (error) {
    mapCashierWriteError(
      error,
      'Cashier window assignment conflicts with an active account',
    )
  }
}

export async function listWindows({ database }) {
  const result = await database.query(`
    SELECT w.id, w.window_number, w.window_name, w.is_active,
           w.availability_status,
           s.id AS cashier_id, s.username AS cashier_username,
           s.display_name AS cashier_display_name
    FROM cashier_windows w
    LEFT JOIN staff s
      ON s.assigned_window_id = w.id
     AND s.role = 'cashier'
     AND s.is_active = true
    WHERE w.window_number BETWEEN 1 AND 4
    ORDER BY w.window_number
  `)
  if (result.rows.length !== 4) {
    throw new HttpError(503, 'All four cashier windows must be configured')
  }
  return result.rows.map(mapWindow)
}

export async function setAdminWindowAvailability({
  database,
  windowId,
  availabilityStatus,
}) {
  return withTransaction(database, async (client) => {
    const result = await client.query(
      `SELECT id, window_number, availability_status
       FROM cashier_windows
       WHERE id = $1 AND window_number BETWEEN 1 AND 4
       FOR UPDATE`,
      [windowId],
    )
    const current = result.rows[0]
    if (!current) throw new HttpError(404, 'Window not found')
    if (current.availability_status === availabilityStatus) {
      return {
        windowNumber: current.window_number,
        status: current.availability_status,
        changed: false,
      }
    }

    const updated = await client.query(
      `UPDATE cashier_windows
       SET availability_status = $2, updated_at = NOW()
       WHERE id = $1
       RETURNING window_number, availability_status`,
      [windowId, availabilityStatus],
    )
    return {
      windowNumber: updated.rows[0].window_number,
      status: updated.rows[0].availability_status,
      changed: true,
    }
  })
}
