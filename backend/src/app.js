import cors from 'cors'
import express from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { createCorsOrigin } from './config/cors.js'
import { config } from './config/env.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { pool } from './db/pool.js'
import { createApiRoutes } from './routes/index.js'

export function createApp({
  database = pool,
  sessionSecret = config.sessionSecret,
} = {}) {
  const app = express()

  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({
    origin: createCorsOrigin(config.clientOrigins),
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
  }))
  app.use(express.json({ limit: '100kb' }))
  app.use('/api', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  }))
  app.use('/api/v1', createApiRoutes({ database, sessionSecret }))
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}
