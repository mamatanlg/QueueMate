import bcrypt from 'bcrypt'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/transaction.js'

const expectedCashiers = Array.from({ length: 4 }, (_, index) => ({
  username: `cashier${index + 1}`,
  displayName: `Cashier ${index + 1}`,
  windowNumber: index + 1,
}))

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Run this seed command in an interactive terminal')
  }

  return new Promise((resolve, reject) => {
    const input = process.stdin
    let value = ''
    let finished = false

    const restore = () => {
      input.removeListener('data', onData)
      input.setRawMode(false)
      input.pause()
      process.stdout.write('\n')
    }

    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') {
          finished = true
          restore()
          reject(new Error('Password entry cancelled'))
          return
        }
        if (character === '\r' || character === '\n') {
          if (finished) return
          finished = true
          restore()
          resolve(value)
          return
        }
        if (character === '\u0008' || character === '\u007f') {
          value = value.slice(0, -1)
        } else if (character >= ' ') {
          value += character
        }
      }
    }

    process.stdout.write(prompt)
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
  })
}

async function inspectConfiguration(client) {
  const windowsResult = await client.query(
    `SELECT id, window_number, is_active
     FROM cashier_windows
     WHERE window_number BETWEEN 1 AND 4
     ORDER BY window_number
     FOR UPDATE`,
  )
  const windowsByNumber = new Map()
  for (const window of windowsResult.rows) {
    if (windowsByNumber.has(window.window_number)) {
      throw new Error(`Cashier Window ${window.window_number} appears more than once`)
    }
    if (!window.is_active) {
      throw new Error(`Cashier Window ${window.window_number} exists but is inactive`)
    }
    windowsByNumber.set(window.window_number, window)
  }
  for (const cashier of expectedCashiers) {
    if (!windowsByNumber.has(cashier.windowNumber)) {
      throw new Error(`Cashier Window ${cashier.windowNumber} does not exist`)
    }
  }

  const staffResult = await client.query(
    `SELECT id, username, role, is_active, assigned_window_id
     FROM staff
     WHERE lower(username) = ANY($1::text[])
        OR assigned_window_id IN (
          SELECT id FROM cashier_windows WHERE window_number BETWEEN 1 AND 4
        )
     FOR UPDATE`,
    [expectedCashiers.map(({ username }) => username)],
  )
  const staffByUsername = new Map()
  const staffByWindow = new Map()
  const expectedUsernameSet = new Set(
    expectedCashiers.map(({ username }) => username),
  )
  const expectedWindowIds = new Set(
    expectedCashiers.map(({ windowNumber }) => windowsByNumber.get(windowNumber).id),
  )

  for (const staff of staffResult.rows) {
    const normalizedUsername = staff.username.toLowerCase()
    if (expectedUsernameSet.has(normalizedUsername)) {
      if (staff.username !== normalizedUsername) {
        throw new Error(
          `Username "${staff.username}" conflicts with expected username "${normalizedUsername}"`,
        )
      }
      if (staffByUsername.has(normalizedUsername)) {
        throw new Error(`More than one staff account matches username "${staff.username}"`)
      }
      staffByUsername.set(normalizedUsername, staff)
    }

    if (expectedWindowIds.has(staff.assigned_window_id)) {
      if (staffByWindow.has(staff.assigned_window_id)) {
        throw new Error(
          `Cashier Window ${windowsResult.rows.find((window) => window.id === staff.assigned_window_id).window_number} is assigned to multiple staff accounts`,
        )
      }
      staffByWindow.set(staff.assigned_window_id, staff)
    }
  }

  for (const cashier of expectedCashiers) {
    const expectedWindow = windowsByNumber.get(cashier.windowNumber)
    const existingAccount = staffByUsername.get(cashier.username)
    const assignedAccount = staffByWindow.get(expectedWindow.id)

    if (assignedAccount && assignedAccount.username !== cashier.username) {
      throw new Error(
        `Cashier Window ${cashier.windowNumber} is already assigned to staff account "${assignedAccount.username}"`,
      )
    }

    if (existingAccount) {
      if (existingAccount.role !== 'cashier') {
        throw new Error(
          `Username "${cashier.username}" exists with role "${existingAccount.role}", not "cashier"`,
        )
      }
      if (!existingAccount.is_active) {
        throw new Error(`Cashier account "${cashier.username}" exists but is inactive`)
      }
      if (existingAccount.assigned_window_id !== expectedWindow.id) {
        throw new Error(
          `Cashier account "${cashier.username}" is not assigned to Window ${cashier.windowNumber}`,
        )
      }
    }
  }

  return {
    windowsByNumber,
    missing: expectedCashiers.filter(
      ({ username }) => !staffByUsername.has(username),
    ),
  }
}

async function lockSeed(client) {
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    ['queuemate:cashier-account-seed:v1'],
  )
}

export async function seedCashiers({
  database = pool,
  passwordReader = readHidden,
  hashPassword = bcrypt.hash,
} = {}) {
  if (!database) throw new Error('DATABASE_URL is not configured')

  const initialConfiguration = await withTransaction(database, async (client) => {
    await lockSeed(client)
    return inspectConfiguration(client)
  })

  let passwordHash
  if (initialConfiguration.missing.length > 0) {
    const password = await passwordReader('Shared password for new cashier accounts: ')
    const length = Buffer.byteLength(password, 'utf8')
    if (length < 12 || length > 72) {
      throw new Error('Cashier passwords must be 12-72 UTF-8 bytes')
    }
    passwordHash = await hashPassword(password, 12)
  }

  const result = await withTransaction(database, async (client) => {
    await lockSeed(client)
    const configuration = await inspectConfiguration(client)
    const created = []

    for (const cashier of configuration.missing) {
      if (!passwordHash) {
        throw new Error(
          `Cashier account configuration changed while the password was being entered. Rerun the seed command to create "${cashier.username}".`,
        )
      }

      try {
        await client.query(
          `INSERT INTO staff
             (username, password_hash, display_name, role, assigned_window_id, is_active)
           VALUES ($1, $2, $3, 'cashier', $4, true)`,
          [
            cashier.username,
            passwordHash,
            cashier.displayName,
            configuration.windowsByNumber.get(cashier.windowNumber).id,
          ],
        )
      } catch (error) {
        if (error.code === '23505') {
          throw new Error(
            `Cannot create "${cashier.username}" for Window ${cashier.windowNumber}: a database unique constraint conflicts with the expected configuration. No existing staff was changed.`,
            { cause: error },
          )
        }
        throw error
      }
      created.push(cashier.username)
    }

    const verified = await inspectConfiguration(client)
    if (verified.missing.length > 0) {
      throw new Error(
        `Cashier account verification failed for: ${verified.missing.map(({ username }) => username).join(', ')}`,
      )
    }

    return { created }
  })

  const assignments = expectedCashiers
    .map(({ username, windowNumber }) => `${username} -> Window ${windowNumber}`)
    .join('; ')
  console.log(
    `Cashier account seed verified. Created ${result.created.length}; ${assignments}.`,
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await seedCashiers()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  } finally {
    await pool?.end()
    process.stdin.pause()
  }
}
