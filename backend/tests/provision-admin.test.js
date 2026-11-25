import assert from 'node:assert/strict'
import test from 'node:test'
import bcrypt from 'bcrypt'
import {
  getDatabaseTargetIdentifier,
  provisionFirstAdmin,
} from '../scripts/provision-admin.js'

const databaseUrl = 'postgresql://postgres:private@localhost:5432/queuemate_test'
const target = 'postgres:localhost:5432/queuemate_test'

function createDatabase({ staff = [], failVerification = false } = {}) {
  const state = {
    staff: staff.map((account) => ({ ...account })),
    queries: [],
    rollbacks: 0,
    commits: 0,
    connections: 0,
  }
  let snapshot

  const client = {
    async query(sql, values = []) {
      state.queries.push(sql)
      if (sql === 'BEGIN') {
        snapshot = structuredClone(state.staff)
        return { rows: [] }
      }
      if (sql === 'COMMIT') {
        snapshot = undefined
        state.commits += 1
        return { rows: [] }
      }
      if (sql === 'ROLLBACK') {
        state.staff = snapshot
        snapshot = undefined
        state.rollbacks += 1
        return { rows: [] }
      }
      if (sql.includes('pg_advisory_xact_lock') || sql.startsWith('LOCK TABLE')) {
        return { rows: [] }
      }
      if (sql.includes('WHERE role = $1')) {
        return { rows: state.staff.filter(({ role }) => role === values[0]).slice(0, 1) }
      }
      if (sql.includes('lower(username)')) {
        const username = values[0].toLowerCase()
        return { rows: state.staff.filter(({ username: existing }) => existing.toLowerCase() === username) }
      }
      if (sql.includes('INSERT INTO public.staff')) {
        const [username, passwordHash, displayName, role] = values
        const id = `staff-${username}`
        state.staff.push({
          id,
          username,
          password_hash: passwordHash,
          display_name: displayName,
          role,
          is_active: true,
          assigned_window_id: null,
        })
        return { rows: [{ id }] }
      }
      if (sql.includes('WHERE id = $1')) {
        if (failVerification) return { rows: [] }
        const account = state.staff.find(({ id }) => id === values[0])
        return { rows: account ? [{
          username: account.username,
          display_name: account.display_name,
          role: account.role,
          is_active: account.is_active,
          assigned_window_id: account.assigned_window_id,
        }] : [] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
    release() {},
  }

  return {
    state,
    database: {
      async connect() {
        state.connections += 1
        return client
      },
    },
  }
}

function validOptions(database, overrides = {}) {
  return {
    database,
    databaseUrl,
    expectedTarget: target,
    confirmTarget: async (value) => value,
    prompt: async (message) => message.includes('username') ? 'NewAdmin' : 'New Administrator',
    passwordReader: async () => 'valid-admin-password',
    hashPassword: async (password, rounds) => {
      assert.equal(password, 'valid-admin-password')
      assert.equal(rounds, 12)
      return 'bcrypt-hash-for-test'
    },
    ...overrides,
  }
}

test('derives Supabase targets only from project-specific connection metadata', () => {
  assert.equal(
    getDatabaseTargetIdentifier('postgresql://postgres:private@db.project123.supabase.co:5432/postgres'),
    'supabase:project123',
  )
  assert.equal(
    getDatabaseTargetIdentifier('postgresql://postgres.project123:private@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres'),
    'supabase:project123',
  )
  assert.throws(
    () => getDatabaseTargetIdentifier('postgresql://postgres:private@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres'),
    /Cannot verify the Supabase project/,
  )
})

test('rejects a missing target without connecting to the database', async () => {
  const { database, state } = createDatabase()
  await assert.rejects(
    provisionFirstAdmin(validOptions(database, { expectedTarget: '' })),
    /ADMIN_PROVISION_TARGET is required/,
  )
  assert.equal(state.connections, 0)

  await assert.rejects(
    provisionFirstAdmin(validOptions(database, { databaseUrl: null })),
    /DATABASE_URL is not configured/,
  )
  assert.equal(state.connections, 0)
})

test('rejects a mismatched target without connecting to the database', async () => {
  const { database, state } = createDatabase()
  await assert.rejects(
    provisionFirstAdmin(validOptions(database, { expectedTarget: 'postgres:other:5432/queuemate_test' })),
    /does not match the configured database/,
  )
  assert.equal(state.connections, 0)
})

test('requires exact interactive confirmation before connecting', async () => {
  const { database, state } = createDatabase()
  await assert.rejects(
    provisionFirstAdmin(validOptions(database, { confirmTarget: async () => '' })),
    /confirmation did not match/,
  )
  assert.equal(state.connections, 0)
})

test('refuses to create an admin if any admin already exists', async () => {
  const existingAdmin = {
    id: 'existing-admin',
    username: 'oldadmin',
    password_hash: 'unchanged-hash',
    display_name: 'Existing Admin',
    role: 'admin',
    is_active: false,
    assigned_window_id: null,
  }
  const { database, state } = createDatabase({ staff: [existingAdmin] })
  const before = structuredClone(state.staff)

  await assert.rejects(
    provisionFirstAdmin(validOptions(database)),
    /An admin account already exists/,
  )
  assert.deepEqual(state.staff, before)
  assert.equal(state.rollbacks, 1)
})

test('rejects a conflicting username without changing existing accounts', async () => {
  const existing = {
    id: 'cashier-1',
    username: 'newadmin',
    password_hash: 'existing-hash',
    display_name: 'Existing Cashier',
    role: 'cashier',
    is_active: true,
    assigned_window_id: 'window-1',
  }
  const { database, state } = createDatabase({ staff: [existing] })
  const before = structuredClone(state.staff)

  await assert.rejects(
    provisionFirstAdmin(validOptions(database)),
    /That username already exists/,
  )
  assert.deepEqual(state.staff, before)
  assert.equal(state.rollbacks, 1)
})

test('rejects invalid passwords before connecting or hashing', async () => {
  const { database, state } = createDatabase()
  let hashCalled = false
  await assert.rejects(
    provisionFirstAdmin(validOptions(database, {
      passwordReader: async () => 'short',
      hashPassword: async () => {
        hashCalled = true
        return 'hash'
      },
    })),
    /Password must be 12-72 UTF-8 bytes/,
  )
  assert.equal(hashCalled, false)
  assert.equal(state.connections, 0)
})

test('creates and verifies an active admin with no window using bcrypt cost 12', async () => {
  const existingCashier = {
    id: 'cashier-1',
    username: 'cashier1',
    password_hash: 'existing-hash',
    display_name: 'Cashier One',
    role: 'cashier',
    is_active: true,
    assigned_window_id: 'window-1',
  }
  const { database, state } = createDatabase({ staff: [existingCashier] })
  const before = structuredClone(existingCashier)
  const account = await provisionFirstAdmin(validOptions(database))

  assert.deepEqual(account, {
    username: 'newadmin',
    displayName: 'New Administrator',
    role: 'admin',
    isActive: true,
    hasCashierWindow: false,
  })

  test('provisions a System Admin separately without changing an existing Admin', async () => {
    const existingAdmin = {
      id: 'existing-admin',
      username: 'legacyadmin',
      password_hash: 'unchanged-hash',
      display_name: 'Legacy Admin',
      role: 'admin',
      is_active: true,
      assigned_window_id: null,
    }
    const { database, state } = createDatabase({ staff: [existingAdmin] })
    const existingBefore = structuredClone(existingAdmin)

    const account = await provisionFirstAdmin(validOptions(database, {
      role: 'system_admin',
      expectedTarget: target,
    }))

    assert.equal(account.role, 'system_admin')
    assert.equal(state.staff.length, 2)
    assert.deepEqual(state.staff[0], existingBefore)
    assert.equal(state.staff[1].role, 'system_admin')
  })
  assert.equal(state.staff.length, 2)
  assert.deepEqual(state.staff[0], before)
  assert.equal(state.staff[1].password_hash, 'bcrypt-hash-for-test')
  assert.equal(state.commits, 1)
  assert.equal(state.rollbacks, 0)
  assert.equal(
    state.queries.some((sql) => /^\s*(UPDATE|DELETE)\b/i.test(sql)),
    false,
  )
  assert.equal(
    state.queries.some((sql) => /^\s*SELECT\b[\s\S]*password_hash/i.test(sql)),
    false,
  )
  assert.equal(JSON.stringify(account).includes('bcrypt-hash-for-test'), false)
})

test('stores a bcrypt hash that verifies the entered password at cost 12', async () => {
  const { database, state } = createDatabase()
  await provisionFirstAdmin(validOptions(database, {
    hashPassword: bcrypt.hash,
  }))
  const storedHash = state.staff[0].password_hash

  assert.notEqual(storedHash, 'valid-admin-password')
  assert.equal(await bcrypt.getRounds(storedHash), 12)
  assert.equal(await bcrypt.compare('valid-admin-password', storedHash), true)
})

test('rolls back the inserted account if post-insert verification fails', async () => {
  const { database, state } = createDatabase({ failVerification: true })
  await assert.rejects(
    provisionFirstAdmin(validOptions(database)),
    /could not be verified/,
  )
  assert.deepEqual(state.staff, [])
  assert.equal(state.commits, 0)
  assert.equal(state.rollbacks, 1)
})
