import { Router } from 'express'
import { authenticateCashier } from '../middleware/authenticate-cashier.js'
import { validateRequest } from '../middleware/validate-request.js'
import {
  callNext,
  finishCurrentTicket,
  getCashierWindow,
  getWaitingQueue,
  setWindowAvailability,
} from '../services/queue-service.js'
import { windowAvailabilitySchema } from '../validation/schemas.js'

export function createCashierRoutes({ database, sessionSecret }) {
  const router = Router()
  router.use(authenticateCashier({ database, sessionSecret }))

  const publicEvent = (request) => (event, payload) => (
    request.app.get('io')?.emit(event, payload)
  )

  router.get('/me', async (request, response) => {
    response.status(200).json(
      await getCashierWindow({ database, auth: request.auth }),
    )
  })

  router.get('/queue', async (_request, response) => {
    response.status(200).json({ tickets: await getWaitingQueue({ database }) })
  })

  router.patch(
    '/window/status',
    validateRequest({ body: windowAvailabilitySchema.shape.body }),
    async (request, response) => {
      const result = await setWindowAvailability({
        database,
        auth: request.auth,
        availabilityStatus: request.validated.body.availabilityStatus,
        publicEvent: publicEvent(request),
      })
      response.status(200).json(result)
    },
  )

  router.post('/queue/next', async (request, response) => {
    response.status(200).json(
      await callNext({
        database,
        auth: request.auth,
        publicEvent: publicEvent(request),
      }),
    )
  })

  router.post('/current/complete', async (request, response) => {
    response.status(200).json(
      await finishCurrentTicket({
        database,
        auth: request.auth,
        action: 'completed',
        publicEvent: publicEvent(request),
      }),
    )
  })

  router.post('/current/skip', async (request, response) => {
    response.status(200).json(
      await finishCurrentTicket({
        database,
        auth: request.auth,
        action: 'skipped',
        publicEvent: publicEvent(request),
      }),
    )
  })

  return router
}
