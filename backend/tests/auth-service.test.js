import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { login, logout } from '../src/services/auth-service.js'
import {
  authenticateAdmin,
  authenticateCashier,
} from '../src/middleware/authenticate-cashier.js'

const sessionSecret = 'test-session-secret-with-more-than-32-bytes'

function middlewareFixture(role) {
  const staffId = randomUUID()
  const sessionId = randomUUID()
  const assignedWindowId = role === 'cashier' ? randomUUID() : null
  const token = jwt.sign(
    { sid: sessionId },
    sessionSecret,
    {
      algorithm: 'HS256',
      audience: 'queuemate-cashier',
      issuer: 'queuemate-backend',
      subject: staffId,
      expiresIn: '1h',
    },
  )

  return {
    middlewareOptions: {
      sessionSecret,
      database: {
        async query() {
          return {
            rows: [{
              staff_id: staffId,
              role,
              assigned_window_id: assignedWindowId,
              window_number: role === 'cashier' ? 2 : null,
            }],
          }
        },
      },
    },
    request: { get: () => `Bearer ${token}` },
    assignedWindowId,
  }
}

async function runMiddleware(middleware, request) {
  let error
  await middleware(request, {}, (nextError) => { error = nextError })
  return error
}

test('cashier login verifies a bcrypt hash and creates a revocable JWT session', async () => {
  const staffId = randomUUID()
  const windowId = randomUUID()
  const passwordHash = await bcrypt.hash('test-password-12', 4)
  const calls = []
  const database = {
    async query(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('FROM staff s')) {
        return {
          rows: [{
            id: staffId,
            username: 'cashier1',
            password_hash: passwordHash,
            display_name: 'Cashier 1',
            role: 'cashier',
            assigned_window_id: windowId,
            window_number: 1,
            window_name: 'Window 1',
          }],
        }
      }
      return { rows: [] }
    },
  }

  const result = await login({
    database,
    username: 'cashier1',
    password: 'test-password-12',
    sessionSecret,
  })

  const claims = jwt.verify(result.accessToken, sessionSecret, {
    algorithms: ['HS256'],
    audience: 'queuemate-cashier',
    issuer: 'queuemate-backend',
  })
  assert.equal(claims.sub, staffId)
  assert.equal(claims.sid, calls[1].values[0])
  assert.equal(result.role, 'cashier')
  assert.equal(result.cashier.window.number, 1)
  assert.match(calls[1].sql, /INSERT INTO auth_sessions/)

  await logout({ database, sessionId: claims.sid })
  assert.match(calls[2].sql, /SET revoked_at = NOW\(\)/)
  assert.deepEqual(calls[2].values, [claims.sid])
})

test('admin login succeeds without an assigned window', async () => {
  const staffId = randomUUID()
  const passwordHash = await bcrypt.hash('test-password-12', 4)
  const calls = []
  const database = {
    async query(sql, values) {
      calls.push({ sql, values })
      if (sql.includes('FROM staff s')) {
        return {
          rows: [{
            id: staffId,
            username: 'admin1',
            password_hash: passwordHash,
            display_name: 'Admin One',
            role: 'admin',
            assigned_window_id: null,
            window_number: null,
            window_name: null,
          }],
        }
      }
      return { rows: [] }
    },
  }

  const result = await login({
    database,
    username: 'admin1',
    password: 'test-password-12',
    sessionSecret,
  })

  assert.equal(result.role, 'admin')
  assert.deepEqual(result.admin, {
    username: 'admin1',
    displayName: 'Admin One',
  })
  assert.equal('cashier' in result, false)
  assert.match(calls[1].sql, /INSERT INTO auth_sessions/)
})

test('cashier login rejects incorrect passwords without disclosing account state', async () => {
  const database = {
    async query() {
      return {
        rows: [{
          id: randomUUID(),
          password_hash: await bcrypt.hash('correct-password', 4),
          role: 'cashier',
          assigned_window_id: randomUUID(),
        }],
      }
    },
  }

  await assert.rejects(
    login({
      database,
      username: 'cashier1',
      password: 'incorrect-password',
      sessionSecret,
    }),
    (error) => error.status === 401
      && error.message === 'Invalid username or password',
  )
})

test('login rejects an unknown username without disclosing account state', async () => {
  const database = { async query() { return { rows: [] } } }

  await assert.rejects(
    login({
      database,
      username: 'unknown',
      password: 'incorrect-password',
      sessionSecret,
    }),
    (error) => error.status === 401
      && error.message === 'Invalid username or password',
  )
})

test('cashier authentication derives window identity from the active session', async () => {
  const staffId = randomUUID()
  const assignedWindowId = randomUUID()
  const sessionId = randomUUID()
  const token = jwt.sign(
    { sid: sessionId },
    sessionSecret,
    {
      algorithm: 'HS256',
      audience: 'queuemate-cashier',
      issuer: 'queuemate-backend',
      subject: staffId,
      expiresIn: '1h',
    },
  )
  let queryValues
  const middleware = authenticateCashier({
    sessionSecret,
    database: {
      async query(_sql, values) {
        queryValues = values
        return {
          rows: [{
            staff_id: staffId,
            role: 'cashier',
            assigned_window_id: assignedWindowId,
            window_number: 2,
          }],
        }
      },
    },
  })
  const request = {
    get: () => `Bearer ${token}`,
    body: { windowId: randomUUID() },
  }
  let nextError

  await middleware(request, {}, (error) => { nextError = error })

  assert.equal(nextError, undefined)
  assert.deepEqual(queryValues, [sessionId, staffId])
  assert.equal(request.auth.assigned_window_id, assignedWindowId)
  assert.notEqual(request.auth.assigned_window_id, request.body.windowId)
})

test('role authorization accepts the matching account role and rejects the other role', async () => {
  const adminFixture = middlewareFixture('admin')
  const cashierFixture = middlewareFixture('cashier')

  assert.equal(
    await runMiddleware(
      authenticateAdmin(adminFixture.middlewareOptions),
      adminFixture.request,
    ),
    undefined,
  )
  assert.equal(
    (await runMiddleware(
      authenticateAdmin(cashierFixture.middlewareOptions),
      cashierFixture.request,
    )).status,
    403,
  )
  assert.equal(
    await runMiddleware(
      authenticateCashier(cashierFixture.middlewareOptions),
      cashierFixture.request,
    ),
    undefined,
  )
  assert.equal(
    (await runMiddleware(
      authenticateCashier(adminFixture.middlewareOptions),
      adminFixture.request,
    )).status,
    403,
  )
})
