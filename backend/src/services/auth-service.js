import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { HttpError } from '../middleware/http-error.js'

const sessionDurationSeconds = 8 * 60 * 60
const dummyPasswordHash = bcrypt.hash(randomBytes(32).toString('hex'), 12)

export async function login({ database, username, password, sessionSecret }) {
  if (!sessionSecret) {
    throw new HttpError(503, 'Authentication is not configured')
  }

  const result = await database.query(
    `SELECT s.id, s.username, s.password_hash, s.display_name,
            s.role, s.assigned_window_id, w.window_number, w.window_name
     FROM staff s
     LEFT JOIN cashier_windows w ON w.id = s.assigned_window_id
     WHERE s.username = $1 AND s.is_active = true`,
    [username],
  )
  const staff = result.rows[0]
  const passwordHash = staff?.password_hash ?? await dummyPasswordHash
  const passwordMatches = await bcrypt.compare(password, passwordHash)

  if (!staff || !passwordMatches) {
    throw new HttpError(401, 'Invalid username or password')
  }

  if (staff.role !== 'cashier' || !staff.assigned_window_id) {
    throw new HttpError(403, 'This account cannot access cashier operations')
  }

  const sessionId = randomUUID()
  const expiresAt = new Date(Date.now() + sessionDurationSeconds * 1000)

  await database.query(
    `INSERT INTO auth_sessions (session_id, staff_id, expires_at)
     VALUES ($1, $2, $3)`,
    [sessionId, staff.id, expiresAt],
  )

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
    cashier: {
      username: staff.username,
      displayName: staff.display_name,
      window: {
        number: staff.window_number,
        name: staff.window_name,
      },
    },
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
