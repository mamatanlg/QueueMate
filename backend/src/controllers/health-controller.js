import { checkDatabaseConnection } from '../db/pool.js'

export function getHealth(_request, response) {
  response.status(200).json({
    status: 'ok',
    service: 'QueueMate backend',
  })
}

export async function getDatabaseHealth(_request, response) {
  try {
    await checkDatabaseConnection()
    response.status(200).json({
      status: 'ok',
      database: 'connected',
    })
  } catch (error) {
    const notConfigured = error.code === 'DATABASE_NOT_CONFIGURED'
    if (!notConfigured) {
      console.error('PostgreSQL health check failed', error.code ?? 'unknown')
    }

    response.status(503).json({
      status: 'error',
      database: 'unavailable',
      message: notConfigured
        ? 'Database connection is not configured'
        : 'Database connection is unavailable',
    })
  }
}
