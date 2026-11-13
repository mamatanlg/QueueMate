import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { login, logout } from '../services/auth-service.js'
import { authenticateCashier } from '../middleware/authenticate-cashier.js'
import { validateRequest } from '../middleware/validate-request.js'
import { loginSchema } from '../validation/schemas.js'

const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: { status: 429, message: 'Too many authentication attempts' },
    })
  },
})

export function createAuthRoutes({ database, sessionSecret }) {
  const router = Router()
  const requireCashier = authenticateCashier({ database, sessionSecret })

  router.post(
    '/login',
    authRateLimit,
    validateRequest({ body: loginSchema.shape.body }),
    async (request, response) => {
      const result = await login({
        database,
        sessionSecret,
        ...request.validated.body,
      })
      response.status(200).json(result)
    },
  )

  router.post('/logout', requireCashier, async (request, response) => {
    await logout({ database, sessionId: request.auth.sessionId })
    response.status(204).end()
  })

  return router
}
