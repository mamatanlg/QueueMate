import { Router } from 'express'
import { authenticateAdmin } from '../middleware/authenticate-cashier.js'
import { validateRequest } from '../middleware/validate-request.js'
import {
  createCashier,
  getCashier,
  listCashiers,
  listWindows,
  setCashierActive,
  updateCashier,
} from '../services/admin-service.js'
import {
  cashierIdSchema,
  cashierStatusSchema,
  createCashierSchema,
  updateCashierSchema,
} from '../validation/schemas.js'

export function createAdminRoutes({ database, sessionSecret }) {
  const router = Router()
  router.use(authenticateAdmin({ database, sessionSecret }))

  router.get('/cashiers', async (_request, response) => {
    response.status(200).json({ cashiers: await listCashiers({ database }) })
  })

  router.get(
    '/cashiers/:staffId',
    validateRequest({ params: cashierIdSchema.shape.params }),
    async (request, response) => {
      response.status(200).json(await getCashier({
        database,
        staffId: request.validated.params.staffId,
      }))
    },
  )

  router.post(
    '/cashiers',
    validateRequest({ body: createCashierSchema.shape.body }),
    async (request, response) => {
      const cashier = await createCashier({
        database,
        ...request.validated.body,
      })
      response.status(201).json(cashier)
    },
  )

  router.patch(
    '/cashiers/:staffId',
    validateRequest({
      params: cashierIdSchema.shape.params,
      body: updateCashierSchema.shape.body,
    }),
    async (request, response) => {
      response.status(200).json(await updateCashier({
        database,
        staffId: request.validated.params.staffId,
        ...request.validated.body,
      }))
    },
  )

  router.patch(
    '/cashiers/:staffId/status',
    validateRequest({
      params: cashierIdSchema.shape.params,
      body: cashierStatusSchema.shape.body,
    }),
    async (request, response) => {
      response.status(200).json(await setCashierActive({
        database,
        staffId: request.validated.params.staffId,
        actorStaffId: request.auth.staff_id,
        isActive: request.validated.body.isActive,
      }))
    },
  )

  router.get('/windows', async (_request, response) => {
    response.status(200).json({ windows: await listWindows({ database }) })
  })

  return router
}
