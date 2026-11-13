import bcrypt from 'bcrypt'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/transaction.js'

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

async function seedCashiers() {
  if (!pool) throw new Error('DATABASE_URL is not configured')

  const windowsResult = await pool.query(
    `SELECT window_number
     FROM cashier_windows
     WHERE is_active = true AND window_number BETWEEN 1 AND 4
     ORDER BY window_number`,
  )
  const activeWindows = new Set(
    windowsResult.rows.map((row) => row.window_number),
  )
  for (let windowNumber = 1; windowNumber <= 4; windowNumber += 1) {
    if (!activeWindows.has(windowNumber)) {
      throw new Error(`Active cashier window ${windowNumber} is missing`)
    }
  }

  const hashes = []
  const passwordSet = new Set()
  for (let windowNumber = 1; windowNumber <= 4; windowNumber += 1) {
    const password = await readHidden(`Password for Cashier ${windowNumber}: `)
    const length = Buffer.byteLength(password, 'utf8')
    if (length < 12 || length > 72) {
      throw new Error('Cashier passwords must be 12-72 UTF-8 bytes')
    }
    if (passwordSet.has(password)) {
      throw new Error('Choose a different password for each cashier')
    }
    passwordSet.add(password)
    hashes.push(await bcrypt.hash(password, 12))
  }

  const outcomes = await withTransaction(pool, async (client) => {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      ['queuemate:cashier-account-seed:v1'],
    )
    const rows = []

    for (let index = 0; index < 4; index += 1) {
      const windowNumber = index + 1
      const result = await client.query(
        `INSERT INTO staff (username, password_hash, display_name, role, assigned_window_id)
         SELECT $1, $2, $3, 'cashier', w.id
         FROM cashier_windows w
         WHERE w.window_number = $4 AND w.is_active = true
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          `cashier${windowNumber}`,
          hashes[index],
          `Cashier ${windowNumber}`,
          windowNumber,
        ],
      )
      rows.push({ windowNumber, inserted: result.rows.length > 0 })
    }

    return rows
  })

  const created = outcomes.filter((outcome) => outcome.inserted).length
  console.log(`Cashier account seed finished. Created ${created}; left existing accounts unchanged.`)
}

try {
  await seedCashiers()
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await pool?.end()
  process.stdin.pause()
}
