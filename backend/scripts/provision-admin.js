import bcrypt from 'bcrypt'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from '../src/config/env.js'
import { pool } from '../src/db/pool.js'
import { withTransaction } from '../src/db/transaction.js'
import { createCashierSchema } from '../src/validation/schemas.js'
import { readHidden } from './seed-cashiers.js'

const adminProvisionLock = 'queuemate:first-admin-provision:v1'
const adminInputSchema = createCashierSchema.shape.body.pick({
  username: true,
  displayName: true,
  password: true,
})

class ProvisioningError extends Error {}

export function getDatabaseTargetIdentifier(databaseUrl) {
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new ProvisioningError('DATABASE_URL is missing or invalid.')
  }

  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new ProvisioningError('DATABASE_URL must use PostgreSQL.')
  }

  const host = url.hostname.toLowerCase()
  const directProject = host.match(/^db\.([a-z0-9]+)\.supabase\.(?:co|com)$/)
  if (directProject) return `supabase:${directProject[1]}`

  if (host.endsWith('.pooler.supabase.com')) {
    let username
    try {
      username = decodeURIComponent(url.username)
    } catch {
      throw new ProvisioningError('Cannot verify the Supabase project from DATABASE_URL.')
    }
    const pooledProject = username.match(/^postgres\.([a-z0-9]+)$/i)
    if (!pooledProject) {
      throw new ProvisioningError('Cannot verify the Supabase project from DATABASE_URL.')
    }
    return `supabase:${pooledProject[1].toLowerCase()}`
  }

  if (host.includes('supabase.')) {
    throw new ProvisioningError('Cannot verify the Supabase project from DATABASE_URL.')
  }

  let databaseName
  try {
    databaseName = decodeURIComponent(url.pathname.slice(1))
  } catch {
    throw new ProvisioningError('Cannot identify the PostgreSQL database target.')
  }
  if (!host || !databaseName) {
    throw new ProvisioningError('Cannot identify the PostgreSQL database target.')
  }

  return `postgres:${host}:${url.port || '5432'}/${encodeURIComponent(databaseName)}`
}

async function promptText(message) {
  if (!stdin.isTTY) {
    throw new ProvisioningError('Run this command in an interactive terminal.')
  }
  const input = createInterface({ input: stdin, output: stdout })
  try {
    return await input.question(message)
  } finally {
    input.close()
  }
}

function validateCredentials(credentials) {
  const parsed = adminInputSchema.safeParse(credentials)
  if (parsed.success) return parsed.data

  const firstIssue = parsed.error.issues[0]
  if (firstIssue?.path[0] === 'password') {
    throw new ProvisioningError('Password must be 12-72 UTF-8 bytes.')
  }
  if (firstIssue?.path[0] === 'username') {
    throw new ProvisioningError('Username must be 3-100 characters using letters, numbers, ".", "_" or "-".')
  }
  throw new ProvisioningError('Display name must be 1-150 characters.')
}

export async function provisionFirstAdmin({
  database = pool,
  databaseUrl = config.databaseUrl,
  expectedTarget = process.env.ADMIN_PROVISION_TARGET,
  confirmTarget = async (target) => promptText(`Type "${target}" to confirm the database: `),
  prompt = promptText,
  passwordReader = readHidden,
  hashPassword = bcrypt.hash,
} = {}) {
  if (!databaseUrl) throw new ProvisioningError('DATABASE_URL is not configured.')
  if (!expectedTarget?.trim()) {
    throw new ProvisioningError('ADMIN_PROVISION_TARGET is required.')
  }

  const configuredTarget = getDatabaseTargetIdentifier(databaseUrl)
  if (expectedTarget.trim() !== configuredTarget) {
    throw new ProvisioningError('ADMIN_PROVISION_TARGET does not match the configured database.')
  }
  if (!database) throw new ProvisioningError('Database connection is not configured.')

  const confirmation = await confirmTarget(configuredTarget)
  if (confirmation !== configuredTarget) {
    throw new ProvisioningError('Database target confirmation did not match; no database changes were made.')
  }

  const username = await prompt('Admin username: ')
  const displayName = await prompt('Admin display name: ')
  const password = await passwordReader('Admin password (input hidden): ')
  const passwordConfirmation = await passwordReader('Confirm admin password (input hidden): ')
  if (password !== passwordConfirmation) {
    throw new ProvisioningError('Passwords do not match.')
  }

  const credentials = validateCredentials({ username, displayName, password })
  credentials.username = credentials.username.toLowerCase()
  const passwordHash = await hashPassword(credentials.password, 12)

  try {
    return await withTransaction(database, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [adminProvisionLock])
      await client.query('LOCK TABLE public.staff IN SHARE ROW EXCLUSIVE MODE')

      const admins = await client.query(
        `SELECT id
         FROM public.staff
         WHERE role = 'admin'
         LIMIT 1
         FOR UPDATE`,
      )
      if (admins.rows.length > 0) {
        throw new ProvisioningError('An admin account already exists; no account was changed.')
      }

      const usernameMatches = await client.query(
        `SELECT id
         FROM public.staff
         WHERE lower(username) = lower($1)
         LIMIT 1
         FOR UPDATE`,
        [credentials.username],
      )
      if (usernameMatches.rows.length > 0) {
        throw new ProvisioningError('That username already exists; no account was changed.')
      }

      const inserted = await client.query(
        `INSERT INTO public.staff
           (username, password_hash, display_name, role, assigned_window_id, is_active)
         VALUES ($1, $2, $3, 'admin', NULL, true)
         RETURNING id`,
        [credentials.username, passwordHash, credentials.displayName],
      )
      const staffId = inserted.rows[0]?.id
      if (!staffId) {
        throw new ProvisioningError('Created account could not be verified; database changes were rolled back.')
      }

      const verified = await client.query(
        `SELECT username, display_name, role, is_active, assigned_window_id
         FROM public.staff
         WHERE id = $1`,
        [staffId],
      )
      const account = verified.rows[0]
      if (
        !account
        || account.username !== credentials.username
        || account.display_name !== credentials.displayName
        || account.role !== 'admin'
        || account.is_active !== true
        || account.assigned_window_id !== null
      ) {
        throw new ProvisioningError('Created account could not be verified; database changes were rolled back.')
      }

      return {
        username: account.username,
        displayName: account.display_name,
        role: account.role,
        isActive: account.is_active,
        hasCashierWindow: account.assigned_window_id !== null,
      }
    })
  } catch (error) {
    if (error instanceof ProvisioningError) throw error
    if (error?.code === '23505') {
      throw new ProvisioningError('Account creation conflicted with an existing username; database changes were rolled back.')
    }
    throw new ProvisioningError('Provisioning failed; database changes were rolled back.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const account = await provisionFirstAdmin()
    console.log(`Administrator account created and verified: ${account.username} (active, no cashier window).`)
  } catch (error) {
    console.error(error instanceof ProvisioningError ? error.message : 'Provisioning failed; no account was created.')
    process.exitCode = 1
  } finally {
    await pool?.end()
    stdin.pause()
  }
}
