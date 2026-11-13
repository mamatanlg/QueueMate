import jwt from 'jsonwebtoken'
import { HttpError } from './http-error.js'

export function authenticateCashier({ database, sessionSecret }) {
  return async (request, _response, next) => {
    const authorization = request.get('authorization')
    const match = authorization?.match(/^Bearer ([^\s]+)$/i)

    if (!match || !sessionSecret) {
      next(new HttpError(sessionSecret ? 401 : 503, sessionSecret
        ? 'Authentication required'
        : 'Authentication is not configured'))
      return
    }

    let claims
    try {
      claims = jwt.verify(match[1], sessionSecret, {
        algorithms: ['HS256'],
        audience: 'queuemate-cashier',
        issuer: 'queuemate-backend',
      })
    } catch {
      next(new HttpError(401, 'Invalid or expired access token'))
      return
    }

    if (typeof claims === 'string' || typeof claims.sid !== 'string'
      || typeof claims.sub !== 'string') {
      next(new HttpError(401, 'Invalid or expired access token'))
      return
    }

    try {
      const result = await database.query(
        `SELECT s.id AS staff_id, s.username, s.display_name, s.role,
                s.assigned_window_id, w.window_number, w.window_name,
                w.availability_status
         FROM auth_sessions a
         JOIN staff s ON s.id = a.staff_id
         JOIN cashier_windows w ON w.id = s.assigned_window_id
         WHERE a.session_id = $1 AND a.staff_id = $2
           AND a.revoked_at IS NULL AND a.expires_at > NOW()
           AND s.is_active = true`,
        [claims.sid, claims.sub],
      )
      const staff = result.rows[0]

      if (!staff) {
        next(new HttpError(401, 'Invalid or expired access token'))
        return
      }

      if (staff.role !== 'cashier') {
        next(new HttpError(403, 'Cashier access required'))
        return
      }

      request.auth = { ...staff, sessionId: claims.sid }
      next()
    } catch (error) {
      next(error)
    }
  }
}
