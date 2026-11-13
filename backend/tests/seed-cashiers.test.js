import assert from 'node:assert/strict'
import test from 'node:test'
import { seedCashiers } from '../scripts/seed-cashiers.js'

function createDatabase({ windows, staff = [], failInsertFor } = {}) {
  const state = {
    windows: windows ?? Array.from({ length: 4 }, (_, index) => ({
      id: `window-${index + 1}`,
      window_number: index + 1,
      is_active: true,
    })),
    staff: staff.map((account) => ({ ...account })),
  }
  let snapshot

  const client = {
    async query(sql, values = []) {
      if (sql === 'BEGIN') {
        snapshot = state.staff.map((account) => ({ ...account }))
        return { rows: [] }
      }
      if (sql === 'COMMIT') {
        snapshot = undefined
        return { rows: [] }
      }
      if (sql === 'ROLLBACK') {
        state.staff = snapshot
        snapshot = undefined
        return { rows: [] }
      }
      if (sql.includes('pg_advisory_xact_lock')) return { rows: [] }
      if (sql.includes('FROM staff')) {
        const usernames = new Set(values[0])
        const windowIds = new Set(state.windows.map(({ id }) => id))
        return {
          rows: state.staff
            .filter((account) => usernames.has(account.username.toLowerCase())
              || windowIds.has(account.assigned_window_id))
            .map((account) => ({ ...account })),
        }
      }
      if (sql.includes('FROM cashier_windows')) {
        return { rows: state.windows.map((window) => ({ ...window })) }
      }
      if (sql.includes('INSERT INTO staff')) {
        const [username, passwordHash, displayName, assignedWindowId] = values
        if (username === failInsertFor) {
          const error = new Error('unique constraint')
          error.code = '23505'
          throw error
        }
        state.staff.push({
          id: `staff-${username}`,
          username,
          password_hash: passwordHash,
          display_name: displayName,
          role: 'cashier',
          is_active: true,
          assigned_window_id: assignedWindowId,
        })
        return { rows: [{ id: `staff-${username}` }] }
      }
      throw new Error(`Unexpected query: ${sql}`)
    },
    release() {},
  }

  return {
    state,
    database: {
      async connect() {
        return client
      },
    },
  }
}

function correctAccount(username, windowNumber) {
  return {
    id: `staff-${username}`,
    username,
    role: 'cashier',
    is_active: true,
    assigned_window_id: `window-${windowNumber}`,
    password_hash: 'existing-hash',
    display_name: `Existing ${username}`,
  }
}

function fakeHash(password, cost) {
  assert.equal(cost, 12)
  return Promise.resolve(`hash:${password}`)
}

async function captureOutput(operation) {
  const originalLog = console.log
  const output = []
  console.log = (message) => output.push(message)
  try {
    await operation()
    return output.join('\n')
  } finally {
    console.log = originalLog
  }
}

test('asks once and reuses the bcrypt hash for all four new cashiers', async () => {
  const { database, state } = createDatabase()
  const prompts = []
  let hashCalls = 0

  const output = await captureOutput(() => seedCashiers({
    database,
    passwordReader: async (prompt) => {
      prompts.push(prompt)
      return 'one-shared-test-password'
    },
    hashPassword: async (password, cost) => {
      hashCalls += 1
      return fakeHash(password, cost)
    },
  }))

  assert.match(output, /Created 4; cashier1 -> Window 1/)
  assert.doesNotMatch(output, /one-shared-test-password|hash:/)
  assert.deepEqual(prompts, ['Shared password for new cashier accounts: '])
  assert.equal(hashCalls, 1)
  assert.equal(state.staff.length, 4)
  assert.deepEqual(
    state.staff.map(({ password_hash }) => password_hash),
    Array(4).fill('hash:one-shared-test-password'),
  )
  assert.deepEqual(
    state.staff.map(({ username, assigned_window_id, is_active }) => ({
      username,
      assigned_window_id,
      is_active,
    })),
    [1, 2, 3, 4].map((number) => ({
      username: `cashier${number}`,
      assigned_window_id: `window-${number}`,
      is_active: true,
    })),
  )
})

test('leaves already-correct accounts unchanged and does not prompt for passwords', async () => {
  const accounts = [1, 2, 3, 4].map((number) => correctAccount(`cashier${number}`, number))
  const { database, state } = createDatabase({ staff: accounts })
  const before = structuredClone(state.staff)

  await captureOutput(() => seedCashiers({
    database,
    passwordReader: async () => assert.fail('should not prompt'),
    hashPassword: async () => assert.fail('should not hash'),
  }))

  assert.deepEqual(state.staff, before)
})

test('creates only missing accounts when existing accounts are correct', async () => {
  const existing = correctAccount('cashier2', 2)
  const { database, state } = createDatabase({ staff: [existing] })
  const prompts = []

  await captureOutput(() => seedCashiers({
    database,
    passwordReader: async (prompt) => {
      prompts.push(prompt)
      return 'one-shared-test-password'
    },
    hashPassword: fakeHash,
  }))

  assert.deepEqual(prompts, ['Shared password for new cashier accounts: '])
  assert.equal(state.staff.length, 4)
  assert.deepEqual(state.staff.find(({ username }) => username === 'cashier2'), existing)
  assert.deepEqual(
    state.staff.filter(({ username }) => username !== 'cashier2')
      .map(({ password_hash }) => password_hash),
    Array(3).fill('hash:one-shared-test-password'),
  )
})

test('rejects passwords outside the 12-72 UTF-8 byte range before inserting', async (t) => {
  for (const password of ['short-pass', 'x'.repeat(73), 'é'.repeat(37)]) {
    await t.test(`${Buffer.byteLength(password, 'utf8')} bytes`, async () => {
      const { database, state } = createDatabase()
      let hashCalled = false

      await assert.rejects(
        seedCashiers({
          database,
          passwordReader: async () => password,
          hashPassword: async () => {
            hashCalled = true
            return 'hash'
          },
        }),
        /Cashier passwords must be 12-72 UTF-8 bytes/,
      )
      assert.equal(hashCalled, false)
      assert.deepEqual(state.staff, [])
    })
  }
})

test('rejects an expected username with the wrong window before prompting or inserting', async () => {
  const conflicting = correctAccount('cashier1', 2)
  const { database, state } = createDatabase({ staff: [conflicting] })

  await assert.rejects(
    seedCashiers({
      database,
      passwordReader: async () => assert.fail('should not prompt'),
      hashPassword: fakeHash,
    }),
    /Cashier account "cashier1" is not assigned to Window 1/,
  )
  assert.deepEqual(state.staff, [conflicting])
})

test('rolls back all inserted accounts when a unique constraint fails', async () => {
  const { database, state } = createDatabase({ failInsertFor: 'cashier3' })

  await assert.rejects(
    seedCashiers({
      database,
      passwordReader: async () => 'one-shared-test-password',
      hashPassword: fakeHash,
    }),
    /Cannot create "cashier3".*unique constraint/,
  )
  assert.deepEqual(state.staff, [])
})

test('rejects a missing or inactive expected window without inserting accounts', async () => {
  const { database, state } = createDatabase({
    windows: [
      { id: 'window-1', window_number: 1, is_active: true },
      { id: 'window-2', window_number: 2, is_active: false },
      { id: 'window-3', window_number: 3, is_active: true },
      { id: 'window-4', window_number: 4, is_active: true },
    ],
  })

  await assert.rejects(
    seedCashiers({
      database,
      passwordReader: async () => assert.fail('should not prompt'),
      hashPassword: fakeHash,
    }),
    /Cashier Window 2 exists but is inactive/,
  )
  assert.deepEqual(state.staff, [])
})
