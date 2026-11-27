import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'
import { createApp } from './app.js'
import { config } from './config/env.js'
import { pool } from './db/pool.js'
import { createSocketServer } from './sockets/create-socket-server.js'
import { startExpoPushWorker } from './services/push-notification-service.js'

export function createBackendServer() {
  const app = createApp()
  const httpServer = createServer(app)
  const io = createSocketServer(httpServer)
  app.set('io', io)

  return { httpServer, io }
}

export async function startServer() {
  const { httpServer, io } = createBackendServer()
  const stopPushWorker = config.databaseUrl && config.expoPushTokenEncryptionKey
    ? startExpoPushWorker(pool)
    : () => {}

  httpServer.on('error', (error) => {
    console.error('Backend server failed to start', error.code ?? 'unknown')
    process.exitCode = 1
  })

  httpServer.listen(config.port, '0.0.0.0', () => {
    console.log(`QueueMate backend listening on port ${config.port}`)
  })

  let shuttingDown = false
  const shutdown = (signal) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`${signal} received; shutting down backend`)
    stopPushWorker()

    io.close(() => {
      httpServer.close(async () => {
        await pool?.end()
        process.exitCode = 0
      })
    })
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  return { httpServer, io }
}

const isMainModule = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMainModule) {
  await startServer()
}
