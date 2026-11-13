import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { validateRequest } from '../middleware/validate-request.js'
import {
  getPublicQueue,
  getTicketStatus,
  issueTicket,
} from '../services/queue-service.js'
import {
  issueTicketSchema,
  ticketStatusSchema,
} from '../validation/schemas.js'

const issuanceRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_request, response) => {
    response.status(429).json({
      error: { status: 429, message: 'Too many ticket requests' },
    })
  },
})

export function createPublicRoutes({ database }) {
  const router = Router()

  router.post(
    '/tickets',
    issuanceRateLimit,
    validateRequest({ body: issueTicketSchema.shape.body }),
    async (request, response) => {
      const result = await issueTicket({
        database,
        transactionType: request.validated.body.transactionType,
        publicEvent: (event, payload) => request.app.get('io')?.emit(event, payload),
      })
      response.status(201).json(result)
    },
  )

  router.get('/queue', async (_request, response) => {
    response.status(200).json(await getPublicQueue({ database }))
  })

  router.get(
    '/tickets/:ticketId',
    validateRequest({
      params: ticketStatusSchema.shape.params,
      headers: ticketStatusSchema.shape.headers,
    }),
    async (request, response) => {
      const result = await getTicketStatus({
        database,
        ticketId: request.validated.params.ticketId,
        accessToken: request.validated.headers['x-ticket-token'],
      })
      response.status(200).json(result)
    },
  )

  return router
}
