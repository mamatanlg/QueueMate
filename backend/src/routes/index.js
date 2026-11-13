import { Router } from 'express'
import healthRoutes from './health-routes.js'
import { createAuthRoutes } from './auth-routes.js'
import { createCashierRoutes } from './cashier-routes.js'
import { createPublicRoutes } from './public-routes.js'
import { HttpError } from '../middleware/http-error.js'

export function createApiRoutes({ database, sessionSecret }) {
  const router = Router()

  router.use('/health', healthRoutes)
  if (!database) {
    const databaseUnavailable = (_request, _response, next) => {
      next(new HttpError(503, 'Database is not configured'))
    }
    router.use('/auth', databaseUnavailable)
    router.use('/public', databaseUnavailable)
    router.use('/cashier', databaseUnavailable)
    return router
  }

  router.use('/auth', createAuthRoutes({ database, sessionSecret }))
  router.use('/public', createPublicRoutes({ database }))
  router.use('/cashier', createCashierRoutes({ database, sessionSecret }))

  return router
}
