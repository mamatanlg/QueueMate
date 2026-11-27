import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { HttpError } from '../middleware/http-error.js'
import { writeAuditLog } from './audit-service.js'

const sessionDurationSeconds = 8 * 60 * 60
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), 12)

export async function login({ database, username, password, sessionSecret }) {
  if (!sessionSecret) {
    throw new HttpError(503, 'Authentication is not configured')
  }

  const normalizedUsername = username.trim().toLowerCase()
  const result = await database.query(
    `SELECT s.id, s.username, s.password_hash, s.display_name,
            s.role, s.assigned_window_id, w.window_number, w.window_name
     FROM staff s
     LEFT JOIN cashier_windows w ON w.id = s.assigned_window_id
     WHERE s.username = $1 AND s.is_active = true`,
    [normalizedUsername],
  )
  const staff = result.rows[0]
  const passwordHash = staff?.password_hash ?? await dummyPasswordHash
  const passwordMatches = await bcrypt.compare(password, passwordHash)

  if (!staff || !passwordMatches) {
    await writeAuditLog(database, {
      actor: staff ? {
        id: staff.id,
        username: staff.username,
        role: staff.role,
      } : null,
      action: 'auth.login.failed',
      affectedTable: staff ? 'staff' : null,
      affectedRecordId: staff?.id ?? null,
      details: {
        username: normalizedUsername,
        reason: 'invalid_credentials',
      },
    })
    throw new HttpError(401, 'Invalid username or password')
  }

  const isCashier = staff.role === 'cashier'
  const isAdmin = staff.role === 'admin' && staff.assigned_window_id === null
  const isSystemAdmin = staff.role === 'system_admin'
    && staff.assigned_window_id === null
  if (!isCashier && !isAdmin && !isSystemAdmin) {
    throw new HttpError(403, 'Account role or window assignment is invalid')
  }

  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000)

  await database.query(
    `INSERT INTO auth_sessions (session_id, staff_id, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, staff.id, expiresAt],
  )
  await writeAuditLog(database, {
    actor: staff,
    action: 'auth.login.succeeded',
    affectedTable: 'staff',
    affectedRecordId: staff.id,
    details: { username: staff.username },
  })

  const token = jwt.sign(
    { sid: sessionId },
    sessionSecret,
    {
      algorithm: 'HS256',
      audience: 'queuemate-cashier',
      expiresIn: sessionDurationSeconds,
      issuer: 'queuemate-backend',
      subject: staff.id,
    },
  )

  return {
    accessToken: token,
    tokenType: 'Bearer',
    expiresIn: sessionDurationSeconds,
    role: staff.role,
    ...(isCashier
      ? {
          cashier: {
            username: staff.username,
            displayName: staff.display_name,
            window: staff.assigned_window_id
              ? {
                  number: staff.window_number,
                  name: staff.window_name,
                }
              : null,
          },
        }
      : {
          admin: {
            username: staff.username,
            displayName: staff.display_name,
          },
        }),
  }
}

export async function logout({ database, sessionId }) {
  await database.query(
    `UPDATE auth_sessions
     SET revoked_at = NOW()
     WHERE session_id = $1 AND revoked_at IS NULL`,
    [sessionId],
  )
}
