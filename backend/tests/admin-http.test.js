import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { createApp } from '../src/app.js'

const sessionSecret = 'isolated-admin-http-test-secret-at-least-32-bytes'
const adminPassword = 'admin-http-password-12'
const cashierPassword = 'cashier-http-password-12'
const adminPasswordHash = await bcrypt.hash(adminPassword, 4)
const cashierPasswordHash = await bcrypt.hash(cashierPassword, 4)

function makeWindow(number) {
  return {
    id: randomUUID(),
    window_number: number,
    window_name: `Window ${number}`,
    availability_status: 'unavailable',
    is_active: true,
  }
}

function makeStaff({
  username,
  displayName,
  role,
  assignedWindowId = null,
  isActive = true,
  passwordHash = cashierPasswordHash,
}) {
  return {
    id: randomUUID(),
    username,
    password_hash: passwordHash,
    display_name: displayName,
    role,
    assigned_window_id: assignedWindowId,
    is_active: isActive,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  }
}

class AdminHttpDatabase {
  constructor() {
    this.windows = [1, 2, 3, 4].map(makeWindow)
    this.staff = [
      makeStaff({
        username: 'admin1',
        displayName: 'Admin One',
        role: 'admin',
        passwordHash: adminPasswordHash,
      }),
      makeStaff({
        username: 'cashier1',
        displayName: 'Cashier One',
        role: 'cashier',
        assignedWindowId: this.windows[0].id,
      }),
      makeStaff({
        username: 'retired1',
        displayName: 'Retired Cashier',
        role: 'cashier',
        assignedWindowId: this.windows[2].id,
        isActive: false,
      }),
    ]
    this.sessions = new Map()
    this.calls = []
    this.snapshot = null
  }

  windowRow(window) {
    return {
      id: window.id,
      window_number: window.window_number,
      window_name: window.window_name,
      is_active: window.is_active,
      availability_status: window.availability_status,
    }
  }

  cashierRow(staff) {
    const window = this.windows.find(({ id }) => id === staff.assigned_window_id)
    return {
      id: staff.id,
      username: staff.username,
      display_name: staff.display_name,
      is_active: staff.is_active,
      assigned_window_id: staff.assigned_window_id,
      created_at: staff.created_at,
      updated_at: staff.updated_at,
      window_number: window?.window_number ?? null,
      window_name: window?.window_name ?? null,
      window_is_active: window?.is_active ?? null,
    }
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values })

    if (sql.includes('FROM staff s') && sql.includes('WHERE s.username = $1')) {
      const staff = this.staff.find((account) => (
        account.is_active && account.username === values[0]
      ))
      return { rows: staff ? [{ ...staff, ...this.cashierRow(staff) }] : [] }
    }

    if (sql.includes('FROM auth_sessions a')) {
      const session = this.sessions.get(values[0])
      const staff = this.staff.find((account) => account.id === values[1])
      if (!session || session.staffId !== values[1] || session.revoked
        || session.expiresAt <= new Date() || !staff?.is_active) {
        return { rows: [] }
      }
      const window = this.windows.find(({ id }) => id === staff.assigned_window_id)
      return {
        rows: [{
          staff_id: staff.id,
          username: staff.username,
          display_name: staff.display_name,
          role: staff.role,
          assigned_window_id: staff.assigned_window_id,
          window_number: window?.window_number ?? null,
          window_name: window?.window_name ?? null,
          availability_status: window?.availability_status ?? null,
        }],
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

    if (sql.includes('UPDATE auth_sessions')) {
      if (sql.includes('WHERE session_id = $1')) {
        const session = this.sessions.get(values[0])
        if (session) session.revoked = true
      } else {
        for (const session of this.sessions.values()) {
          if (session.staffId === values[0]) session.revoked = true
        }
      }
      return { rows: [] }
    }

    if (sql.includes('FROM cashier_windows w') && sql.includes('LEFT JOIN staff s')) {
      return {
        rows: this.windows.map((window) => {
          const cashier = this.staff.find((staff) => (
            staff.role === 'cashier'
            && staff.is_active
            && staff.assigned_window_id === window.id
          ))
          return {
            ...this.windowRow(window),
            cashier_id: cashier?.id ?? null,
            cashier_username: cashier?.username ?? null,
            cashier_display_name: cashier?.display_name ?? null,
          }
        }),
      }
    }

    if (sql.includes("WHERE s.role = 'cashier'")) {
      let cashiers = this.staff.filter(({ role }) => role === 'cashier')
      if (sql.includes('AND s.id = $1')) {
        cashiers = cashiers.filter(({ id }) => id === values[0])
      } else {
        cashiers.sort((left, right) => left.username.localeCompare(right.username))
      }
      return { rows: cashiers.map((cashier) => this.cashierRow(cashier)) }
    }

    throw new Error(`Unexpected database query: ${sql}`)
  }

  async connect() {
    return {
      query: async (sql, values = []) => this.transactionQuery(sql, values),
      release() {},
    }
  }

  async transactionQuery(sql, values = []) {
    this.calls.push({ sql, values })
    if (sql === 'BEGIN') {
      this.snapshot = {
        staff: this.staff.map((staff) => ({ ...staff })),
        sessions: new Map([...this.sessions].map(([id, session]) => [
          id,
          { ...session },
        ])),
      }
      return { rows: [] }
    }
    if (sql === 'COMMIT') {
      this.snapshot = null
      return { rows: [] }
    }
    if (sql === 'ROLLBACK') {
      if (this.snapshot) {
        this.staff = this.snapshot.staff
        this.sessions = this.snapshot.sessions
      }
      this.snapshot = null
      return { rows: [] }
    }

    if (sql.includes("WHERE s.role = 'cashier'")) {
      let cashiers = this.staff.filter(({ role }) => role === 'cashier')
      if (sql.includes('AND s.id = $1')) {
        cashiers = cashiers.filter(({ id }) => id === values[0])
      }
      return { rows: cashiers.map((cashier) => this.cashierRow(cashier)) }
    }

    if (sql.includes('FROM cashier_windows') && sql.includes('FOR UPDATE')) {
      const window = this.windows.find(({ id }) => id === values[0])
      return { rows: window ? [this.windowRow(window)] : [] }
    }

    if (sql.includes('FROM staff')
      && sql.includes('lower(username) = lower($1)')) {
      const staffId = values[1]
      const duplicate = this.staff.find((staff) => (
        staff.username.toLowerCase() === values[0].toLowerCase()
        && (staffId === null || staff.id !== staffId)
      ))
      return { rows: duplicate ? [{ id: duplicate.id }] : [] }
    }

    if (sql.includes('FROM staff')
      && sql.includes("role = 'cashier'")
      && sql.includes('assigned_window_id = $1')) {
      const cashierId = values[1]
      const assigned = this.staff.find((staff) => (
        staff.role === 'cashier'
        && staff.is_active
        && staff.assigned_window_id === values[0]
        && (cashierId === null || staff.id !== cashierId)
      ))
      return { rows: assigned ? [{ id: assigned.id }] : [] }
    }

    if (sql.includes('FROM staff')
      && sql.includes("role = 'cashier'")
      && sql.includes('FOR UPDATE')) {
      const cashier = this.staff.find((staff) => (
        staff.id === values[0] && staff.role === 'cashier'
      ))
      return {
        rows: cashier
          ? [{
              id: cashier.id,
              username: cashier.username,
              is_active: cashier.is_active,
              assigned_window_id: cashier.assigned_window_id,
            }]
          : [],
      }
    }

    if (sql.includes('INSERT INTO staff')) {
      const [username, passwordHash, displayName, assignedWindowId] = values
      const cashier = makeStaff({
        username,
        passwordHash,
        displayName,
        role: 'cashier',
        assignedWindowId,
      })
      this.staff.push(cashier)
      return { rows: [{ id: cashier.id }] }
    }

    if (sql.includes('UPDATE auth_sessions')) {
      for (const session of this.sessions.values()) {
        if (session.staffId === values[0]) session.revoked = true
      }
      return { rows: [] }
    }

    if (sql.includes('UPDATE staff')) {
      const idMatch = sql.match(/WHERE id = \$(\d+)/)
      const cashier = this.staff.find((staff) => (
        staff.id === values[Number(idMatch[1]) - 1]
        && staff.role === 'cashier'
      ))
      if (!cashier) return { rows: [] }

      const setClause = sql.split('SET')[1].split('WHERE')[0]
      for (const match of setClause.matchAll(/([a-z_]+) = \$(\d+)/g)) {
        cashier[match[1]] = values[Number(match[2]) - 1]
      }
      if (setClause.includes('updated_at = NOW()')) {
        cashier.updated_at = new Date()
      }
      return { rows: sql.includes('RETURNING id') ? [{ id: cashier.id }] : [] }
    }

    throw new Error(`Unexpected transaction query: ${sql}`)
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

async function requestJson(origin, path, {
  method = 'GET',
  token,
  body,
} = {}) {
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

function sessionToken(database, username) {
  const staff = database.staff.find((account) => account.username === username)
  assert.ok(staff)
  const sessionId = randomUUID()
  database.sessions.set(sessionId, {
    staffId: staff.id,
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revoked: false,
  })
  return jwt.sign(
    { sid: sessionId },
    sessionSecret,
    {
      algorithm: 'HS256',
      audience: 'queuemate-cashier',
      issuer: 'queuemate-backend',
      subject: staff.id,
      expiresIn: '1h',
    },
  )
}

function adminToken(database) {
  return sessionToken(database, 'admin1')
}

test('admin endpoints require authentication and reject cashiers', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())

  const unauthenticated = await requestJson(server.origin, '/api/v1/admin/cashiers')
  assert.equal(unauthenticated.status, 401)

  const cashier = sessionToken(database, 'cashier1')
  const forbidden = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    token: cashier,
  })
  assert.equal(forbidden.status, 403)

  const admin = adminToken(database)
  const allowed = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    token: admin,
  })
  assert.equal(allowed.status, 200)
  assert.equal(allowed.body.cashiers.length, 2)
  assert.equal('password_hash' in allowed.body.cashiers[0], false)

  const windows = await requestJson(server.origin, '/api/v1/admin/windows', {
    token: admin,
  })
  assert.equal(windows.status, 200)
  assert.equal(windows.body.windows.length, 4)
})

test('admin can view cashier details and create a cashier without exposing secrets', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const windowId = database.windows[1].id

  const created = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'NewCashier',
      displayName: 'New Cashier',
      password: 'new-cashier-password',
      windowId,
    },
  })

  assert.equal(created.status, 201)
  assert.equal(created.body.username, 'newcashier')
  assert.equal(created.body.assignedWindow.id, windowId)
  assert.equal('password_hash' in created.body, false)
  assert.equal('password' in created.body, false)
  const stored = database.staff.find(({ id }) => id === created.body.id)
  assert.equal(stored.role, 'cashier')
  assert.equal(await bcrypt.compare('new-cashier-password', stored.password_hash), true)

  const detail = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${created.body.id}`,
    { token: admin },
  )
  assert.equal(detail.status, 200)
  assert.equal(detail.body.displayName, 'New Cashier')
  assert.equal('password_hash' in detail.body, false)
})

test('cashier creation rejects duplicate usernames, assignments, admin roles, and invalid windows', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const initialCount = database.staff.length

  const duplicateUsername = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'CASHIER1',
      displayName: 'Duplicate User',
      password: 'another-cashier-password',
      windowId: database.windows[1].id,
    },
  })
  assert.equal(duplicateUsername.status, 409)

  const occupiedWindow = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'newcashier',
      displayName: 'New Cashier',
      password: 'another-cashier-password',
      windowId: database.windows[0].id,
    },
  })
  assert.equal(occupiedWindow.status, 409)

  const adminRole = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'newadmin',
      displayName: 'Not an Admin',
      password: 'another-cashier-password',
      windowId: database.windows[1].id,
      role: 'admin',
    },
  })
  assert.equal(adminRole.status, 400)

  const invalidWindow = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'newcashier',
      displayName: 'New Cashier',
      password: 'another-cashier-password',
      windowId: 'not-a-uuid',
    },
  })
  assert.equal(invalidWindow.status, 400)

  const missingWindow = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'newcashier',
      displayName: 'New Cashier',
      password: 'another-cashier-password',
      windowId: randomUUID(),
    },
  })
  assert.equal(missingWindow.status, 404)
  assert.equal(database.staff.length, initialCount)
})

test('admin can update cashier details and reassign to an unoccupied window', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const cashier = database.staff.find(({ username }) => username === 'cashier1')
  const cashierSession = sessionToken(database, 'cashier1')

  const updated = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${cashier.id}`,
    {
      method: 'PATCH',
      token: admin,
      body: {
        displayName: 'Updated Cashier',
        windowId: database.windows[1].id,
      },
    },
  )

  assert.equal(updated.status, 200)
  assert.equal(updated.body.displayName, 'Updated Cashier')
  assert.equal(updated.body.assignedWindow.id, database.windows[1].id)

  const revokedSession = await requestJson(
    server.origin,
    '/api/v1/cashier/me',
    { token: cashierSession },
  )
  assert.equal(revokedSession.status, 401)

  const windows = await requestJson(server.origin, '/api/v1/admin/windows', {
    token: admin,
  })
  assert.equal(
    windows.body.windows.find((window) => window.id === database.windows[1].id)
      .assignedCashier.id,
    cashier.id,
  )
})

test('deactivation preserves historical assignments, revokes sessions, and permits takeover', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const cashier = database.staff.find(({ username }) => username === 'cashier1')
  const cashierSession = sessionToken(database, 'cashier1')

  const deactivated = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${cashier.id}/status`,
    {
      method: 'PATCH',
      token: admin,
      body: { isActive: false },
    },
  )
  assert.equal(deactivated.status, 200)
  assert.equal(deactivated.body.isActive, false)
  assert.equal(deactivated.body.assignedWindow.id, database.windows[0].id)

  const oldSession = await requestJson(
    server.origin,
    '/api/v1/cashier/me',
    { token: cashierSession },
  )
  assert.equal(oldSession.status, 401)

  const replacement = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'replacement',
      displayName: 'Replacement Cashier',
      password: 'replacement-password',
      windowId: database.windows[0].id,
    },
  })
  assert.equal(replacement.status, 201)

  const oldAccount = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${cashier.id}`,
    { token: admin },
  )
  assert.equal(oldAccount.body.isActive, false)
  assert.equal(oldAccount.body.assignedWindow.id, database.windows[0].id)
})

test('reactivation requires an unoccupied active window and admin accounts cannot be deactivated', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const retired = database.staff.find(({ username }) => username === 'retired1')
  retired.is_active = true
  const staleSession = sessionToken(database, 'retired1')
  retired.is_active = false

  const replacement = await requestJson(server.origin, '/api/v1/admin/cashiers', {
    method: 'POST',
    token: admin,
    body: {
      username: 'replacement',
      displayName: 'Replacement Cashier',
      password: 'replacement-password',
      windowId: database.windows[2].id,
    },
  })
  assert.equal(replacement.status, 201)

  const blockedReactivation = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${retired.id}/status`,
    {
      method: 'PATCH',
      token: admin,
      body: { isActive: true },
    },
  )
  assert.equal(blockedReactivation.status, 409)

  const releaseWindow = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${replacement.body.id}/status`,
    {
      method: 'PATCH',
      token: admin,
      body: { isActive: false },
    },
  )
  assert.equal(releaseWindow.status, 200)

  const reactivated = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${retired.id}/status`,
    {
      method: 'PATCH',
      token: admin,
      body: { isActive: true },
    },
  )
  assert.equal(reactivated.status, 200)
  assert.equal(reactivated.body.isActive, true)

  const oldSession = await requestJson(
    server.origin,
    '/api/v1/cashier/me',
    { token: staleSession },
  )
  assert.equal(oldSession.status, 401)

  const adminDeactivation = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${database.staff[0].id}/status`,
    {
      method: 'PATCH',
      token: admin,
      body: { isActive: false },
    },
  )
  assert.equal(adminDeactivation.status, 409)
  assert.equal(database.staff[0].is_active, true)
})

test('invalid cashier updates do not partially modify the account', async (t) => {
  const database = new AdminHttpDatabase()
  const server = await startTestServer(database)
  t.after(() => server.close())
  const admin = adminToken(database)
  const cashier = database.staff.find(({ username }) => username === 'cashier1')
  const originalName = cashier.display_name

  const invalid = await requestJson(
    server.origin,
    `/api/v1/admin/cashiers/${cashier.id}`,
    {
      method: 'PATCH',
      token: admin,
      body: {
        username: 'retired1',
        displayName: 'Must Not Be Applied',
      },
    },
  )
  assert.equal(invalid.status, 409)
  assert.equal(cashier.display_name, originalName)
  assert.equal(cashier.username, 'cashier1')
})
