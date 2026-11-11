import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { config } from '../config/env.js'

const { Pool } = pg
const supabaseCaPath = fileURLToPath(
  new URL('../../certs/prod-ca-2021.crt', import.meta.url),
)

function isLocalDatabase(databaseUrl) {
  const hostname = new URL(databaseUrl).hostname.replace(/^\[|\]$/g, '')
  return ['localhost', '127.0.0.1', '::1'].includes(hostname)
}

export const pool = config.databaseUrl
  ? new Pool({
      connectionString: config.databaseUrl,
      ssl: isLocalDatabase(config.databaseUrl)
        ? false
        : {
            ca: readFileSync(supabaseCaPath, 'utf8'),
            rejectUnauthorized: true,
          },
    })
  : null

pool?.on('error', (error) => {
  console.error('Unexpected PostgreSQL pool error', error.code ?? 'unknown')
})

export async function checkDatabaseConnection() {
  if (!pool) {
    const error = new Error('Database is not configured')
    error.code = 'DATABASE_NOT_CONFIGURED'
    throw error
  }

  await pool.query('SELECT 1')
}
