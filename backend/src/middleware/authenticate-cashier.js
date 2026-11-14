import jwt from 'jsonwebtoken'
import { HttpError } from './http-error.js'

export function authenticateUser({ database, sessionSecret }) {
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
         LEFT JOIN cashier_windows w ON w.id = s.assigned_window_id
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

      const validCashier = staff.role === 'cashier' && Boolean(staff.assigned_window_id)
      const validAdmin = staff.role === 'admin' && staff.assigned_window_id === null
      if (!validCashier && !validAdmin) {
        next(new HttpError(403, 'Account role or window assignment is invalid'))
        return
      }

      request.auth = { ...staff, sessionId: claims.sid }
      next()
    } catch (error) {
      next(error)
    }
  }
}

function authorizeRole(role) {
  return (request, _response, next) => {
    if (request.auth?.role !== role) {
      next(new HttpError(403, role === 'admin'
        ? 'Administrator access required'
        : 'Cashier access required'))
      return
    }

    next()
  }
}

function authenticateRole(options, role) {
  const authenticate = authenticateUser(options)
  const authorize = authorizeRole(role)

  return (request, response, next) => {
    authenticate(request, response, (error) => {
      if (error) {
        next(error)
        return
      }

      authorize(request, response, next)
    })
  }
}

export function authenticateCashier(options) {
  return authenticateRole(options, 'cashier')
}

export function authenticateAdmin(options) {
  return authenticateRole(options, 'admin')
}
