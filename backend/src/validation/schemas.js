import { z } from 'zod'

export const loginSchema = z.object({
  body: z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1)
      .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
  }).strict(),
})

export const issueTicketSchema = z.object({
  body: z.object({
    transactionType: z.enum(['SOA', 'Payment', 'Other Transactions']),
  }).strict(),
})

export const ticketStatusSchema = z.object({
  params: z.object({
    ticketId: z.uuid(),
  }).strict(),
  headers: z.object({
    'x-ticket-token': z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  }),
})

export const windowAvailabilitySchema = z.object({
  body: z.object({
    availabilityStatus: z.enum(['available', 'unavailable']),
  }).strict(),
})
