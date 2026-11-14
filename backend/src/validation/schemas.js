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

const cashierUsernameSchema = z.string()
  .trim()
  .min(3)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/)

const cashierDisplayNameSchema = z.string().trim().min(1).max(150)

const cashierPasswordSchema = z.string()
  .refine((value) => Buffer.byteLength(value, 'utf8') >= 12)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72)

export const cashierIdSchema = z.object({
  params: z.object({
    staffId: z.uuid(),
  }).strict(),
})

export const createCashierSchema = z.object({
  body: z.object({
    username: cashierUsernameSchema,
    displayName: cashierDisplayNameSchema,
    password: cashierPasswordSchema,
    windowId: z.uuid(),
  }).strict(),
})

export const updateCashierSchema = z.object({
  body: z.object({
    username: cashierUsernameSchema.optional(),
    displayName: cashierDisplayNameSchema.optional(),
    password: cashierPasswordSchema.optional(),
    windowId: z.uuid().optional(),
  }).strict().refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    { message: 'At least one cashier field must be provided' },
  ),
})

export const cashierStatusSchema = z.object({
  body: z.object({
    isActive: z.boolean(),
  }).strict(),
})
