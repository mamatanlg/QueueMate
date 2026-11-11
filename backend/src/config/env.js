import 'dotenv/config'
import { z } from 'zod'

const emptyToUndefined = (value) => (
  typeof value === 'string' && value.trim() === '' ? undefined : value
)

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url()
      .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol))
      .optional(),
  ),
  SESSION_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32).optional(),
  ),
  CLIENT_ORIGINS: z.string().optional().default(''),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) {
    context.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL is required in production',
    })
  }

  if (env.NODE_ENV === 'production' && !env.SESSION_SECRET) {
    context.addIssue({
      code: 'custom',
      path: ['SESSION_SECRET'],
      message: 'SESSION_SECRET must contain at least 32 characters in production',
    })
  }
})

const parsedEnv = envSchema.safeParse(process.env)

if (!parsedEnv.success) {
  const invalidVariables = parsedEnv.error.issues
    .map((issue) => issue.path.join('.'))
    .join(', ')

  throw new Error(`Invalid backend environment configuration: ${invalidVariables}`)
}

const env = parsedEnv.data
const defaultDevelopmentOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:3002',
  'http://127.0.0.1:3002',
]

export const config = Object.freeze({
  nodeEnv: env.NODE_ENV,
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET,
  clientOrigins: Object.freeze(
    env.CLIENT_ORIGINS
      ? env.CLIENT_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)
      : env.NODE_ENV === 'development' ? defaultDevelopmentOrigins : [],
  ),
  isProduction: env.NODE_ENV === 'production',
})
