import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import test from 'node:test'
import bcrypt from 'bcrypt'
import { createApp } from '../src/app.js'

const execFileAsync = promisify(execFile)
const sessionSecret = 'isolated-http-test-secret-at-least-32-bytes'
const testPassword = 'http-test-password-12'
const passwordHash = await bcrypt.hash(testPassword, 4)

class AuthHttpDatabase {
  constructor({ role = 'cashier', isActive = true } = {}) {
    this.staff = {
      id: randomUUID(),
      username: role === 'admin' ? 'admin1' : 'cashier2',
      password_hash: passwordHash,
      display_name: role === 'admin' ? 'Admin One' : 'Cashier Two',
      role,
      is_active: isActive,
      assigned_window_id: role === 'admin' ? null : 'window-2',
      window_number: role === 'admin' ? null : 2,
      window_name: role === 'admin' ? null : 'Window 2',
    }
    this.sessions = new Map()
    this.calls = []
    this.client = { query: (sql, values) => this.query(sql, values) }
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values })

    if (sql.includes('FROM staff s') && sql.includes('LEFT JOIN cashier_windows')) {
      return {
        rows: this.staff.is_active && values[0] === this.staff.username
          ? [{ ...this.staff }]
          : [],
      }
    }

    if (sql.includes('INSERT INTO auth_sessions')) {
      this.sessions.set(values[0], {
        staffId: values[1],
        expiresAt: values[2],
        revoked: false,
      })
      return { rows: [] }
    }

    if (sql.includes('FROM auth_sessions a')) {
      const session = this.sessions.get(values[0])
      return {
        rows: session
          && session.staffId === values[1]
          && !session.revoked
          && session.expiresAt > new Date()
          && this.staff.is_active
          ? [{
            staff_id: this.staff.id,
            username: this.staff.username,
            display_name: this.staff.display_name,
            role: this.staff.role,
            assigned_window_id: this.staff.assigned_window_id,
            window_number: this.staff.window_number,
            window_name: this.staff.window_name,
            availability_status: 'available',
          }]
          : [],
      }
    }

    if (sql.includes('UPDATE auth_sessions')) {
      const session = this.sessions.get(values[0])
      if (session) session.revoked = true
      return { rows: [] }
    }

    if (sql.includes('WHERE w.id = $1 AND w.is_active = true')) {
      return values[0] === this.staff.assigned_window_id
        ? {
          rows: [{
            window_number: this.staff.window_number,
            window_name: this.staff.window_name,
            availability_status: 'available',
            business_date: '2026-11-13',
            current_ticket_business_date: null,
            current_queue_number: null,
            current_transaction_type: null,
          }],
        }
        : { rows: [] }
    }

    throw new Error(`Unexpected database query: ${sql}`)
  }

  async connect() {
    return {
      query: async (sql, values = []) => {
        this.calls.push({ sql, values })
        if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] }

        if (sql.includes('FROM cashier_windows') && sql.includes('FOR UPDATE')) {
          return values[0] === this.staff.assigned_window_id
            ? {
              rows: [{
                id: this.staff.assigned_window_id,
                window_number: this.staff.window_number,
                availability_status: 'available',
              }],
            }
            : { rows: [] }
        }
        if (sql.includes("FROM queue_tickets") && sql.includes("status = 'serving'")) {
          return { rows: [] }
        }
        if (sql.includes('FOR UPDATE OF q')) {
          return {
            rows: [{
              id: 'ticket-1',
              business_date: '2026-11-13',
              queue_number: 1,
              status: 'waiting',
              transaction_type: 'SOA',
            }],
          }
        }
        if (sql.includes("SET status = 'serving'")) return { rows: [] }
        if (sql.includes("VALUES ($1, $2, $3, 'called'")) return { rows: [] }
        if (sql.includes("VALUES ($1, 'called')")) {
          return { rows: [{ id: 'notification-1' }] }
        }
        if (sql.includes('WHERE business_date = $1 AND queue_number = $2')) {
          return { rows: [] }
        }

        throw new Error(`Unexpected transaction query: ${sql}`)
      },
      release() {},
    }
  }
}

async function startTestServer(database) {
  const server = createServer(createApp({ database, sessionSecret }))
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    }),
  }
}

async function requestJson(origin, path, { method = 'GET', token, body } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

  return {
    status: response.status,
    body: response.status === 204 ? undefined : await response.json(),
  }
}

test('HTTP login returns cashier identity, window, and a bearer session', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const response = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.tokenType, 'Bearer')
  assert.equal(response.body.expiresIn, 8 * 60 * 60)
  assert.match(response.body.accessToken, /^[^.]+\.[^.]+\.[^.]+$/)
  assert.deepEqual(response.body.cashier, {
    username: 'cashier2',
    displayName: 'Cashier Two',
    window: { number: 2, name: 'Window 2' },
  })
})

test('HTTP login rejects invalid credentials and malformed input', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const invalidCredentials = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: 'wrong-password-12' },
  })
  assert.equal(invalidCredentials.status, 401)
  assert.deepEqual(invalidCredentials.body.error, {
    status: 401,
    message: 'Invalid username or password',
  })

  const invalidInput = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: '', password: testPassword },
  })
  assert.equal(invalidInput.status, 400)
  assert.deepEqual(invalidInput.body.error, {
    status: 400,
    message: 'Request validation failed',
  })
})

test('HTTP login authenticates admins without a window and allows admin logout', async (t) => {
  const database = new AuthHttpDatabase({ role: 'admin' })
  const server = await startTestServer(database)
  t.after(() => server.close())

  const login = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'admin1', password: testPassword },
  })

  assert.equal(login.status, 200)
  assert.equal(login.body.role, 'admin')
  assert.deepEqual(login.body.admin, {
    username: 'admin1',
    displayName: 'Admin One',
  })
  assert.equal('cashier' in login.body, false)

  const cashierOperation = await requestJson(
    server.origin,
    '/api/v1/cashier/me',
    { token: login.body.accessToken },
  )
  assert.equal(cashierOperation.status, 403)

  const logout = await requestJson(server.origin, '/api/v1/auth/logout', {
    method: 'POST',
    token: login.body.accessToken,
  })
  assert.equal(logout.status, 204)
  assert.ok([...database.sessions.values()][0].revoked)
})

test('HTTP login rejects inactive staff accounts', async (t) => {
  const database = new AuthHttpDatabase({ isActive: false })
  const server = await startTestServer(database)
  t.after(() => server.close())

  const response = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })

  assert.equal(response.status, 401)
  assert.equal(response.body.error.message, 'Invalid username or password')
})

test('HTTP authentication rejects a session after its account is deactivated', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const login = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })
  assert.equal(login.status, 200)

  database.staff.is_active = false
  const response = await requestJson(server.origin, '/api/v1/cashier/me', {
    token: login.body.accessToken,
  })
  assert.equal(response.status, 401)
})

test('protected HTTP routes require a token and use session-bound cashier identity and window', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const unauthorized = await requestJson(server.origin, '/api/v1/cashier/me')
  assert.equal(unauthorized.status, 401)
  assert.deepEqual(unauthorized.body.error, {
    status: 401,
    message: 'Authentication required',
  })

  const login = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })
  assert.equal(login.status, 200)
  const token = login.body.accessToken

  const me = await requestJson(server.origin, '/api/v1/cashier/me?windowId=window-1', {
    token,
  })
  assert.equal(me.status, 200)
  assert.deepEqual(me.body, {
    cashier: { username: 'cashier2', displayName: 'Cashier Two' },
    window: {
      number: 2,
      name: 'Window 2',
      status: 'available',
      businessDate: '2026-11-13',
      currentTicketNumber: null,
      currentTicketBusinessDate: null,
      currentTransactionType: null,
    },
  })
  assert.ok(database.calls.some(({ sql, values }) => (
    sql.includes('WHERE w.id = $1 AND w.is_active = true')
    && values[0] === 'window-2'
  )))

  const nextTicket = await requestJson(server.origin, '/api/v1/cashier/queue/next', {
    method: 'POST',
    token,
    body: { windowId: 'window-1', assigned_window_id: 'window-1' },
  })
  assert.equal(nextTicket.status, 200)
  assert.equal(nextTicket.body.windowNumber, 2)
  assert.ok(database.calls.some(({ sql, values }) => (
    sql.includes('FROM cashier_windows')
    && sql.includes('FOR UPDATE')
    && values[0] === 'window-2'
  )))
  assert.ok(database.calls.some(({ sql, values }) => (
    sql.includes("SET status = 'serving'")
    && values[1] === 'window-2'
  )))
  assert.ok(database.calls.some(({ sql, values }) => (
    sql.includes('INSERT INTO queue_history')
    && values[1] === database.staff.id
    && values[2] === 'window-2'
  )))
})

test('HTTP logout revokes the session and prevents further protected access', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const login = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })
  assert.equal(login.status, 200)
  const token = login.body.accessToken

  const beforeLogout = await requestJson(server.origin, '/api/v1/cashier/me', { token })
  assert.equal(beforeLogout.status, 200)

  const logout = await requestJson(server.origin, '/api/v1/auth/logout', {
    method: 'POST',
    token,
  })
  assert.equal(logout.status, 204)
  assert.equal(logout.body, undefined)

  const afterLogout = await requestJson(server.origin, '/api/v1/cashier/me', { token })
  assert.equal(afterLogout.status, 401)
  assert.deepEqual(afterLogout.body.error, {
    status: 401,
    message: 'Invalid or expired access token',
  })
})

test('HTTP authentication rejects an expired database session', async (t) => {
  const database = new AuthHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const login = await requestJson(server.origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: testPassword },
  })
  assert.equal(login.status, 200)

  const sessionId = database.calls.find(({ sql }) => (
    sql.includes('INSERT INTO auth_sessions')
  )).values[0]
  database.sessions.get(sessionId).expiresAt = new Date(Date.now() - 1000)

  const response = await requestJson(server.origin, '/api/v1/cashier/me', {
    token: login.body.accessToken,
  })
  assert.equal(response.status, 401)
})

test('isolated HTTP login limiter allows ten requests and rejects the eleventh', async (t) => {
  const appUrl = new URL('../src/app.js', import.meta.url).href
  const script = `
    import { createServer } from 'node:http';
    import { createApp } from ${JSON.stringify(appUrl)};
    const server = createServer(createApp({
      database: { async query() { throw new Error('invalid request reached database'); } },
      sessionSecret: ${JSON.stringify(sessionSecret)},
    }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await fetch('http://127.0.0.1:' + address.port + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      statuses.push(response.status);
    }
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    console.log(JSON.stringify(statuses));
  `
  const { stdout } = await execFileAsync(process.execPath, [
    '--input-type=module',
    '-e',
    script,
  ], { timeout: 15_000 })
  const statuses = JSON.parse(stdout.trim())
  assert.deepEqual(statuses, [
    400, 400, 400, 400, 400, 400, 400, 400, 400, 400, 429,
  ])
})
