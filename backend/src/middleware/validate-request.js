import { ZodError } from 'zod'
import { HttpError } from './http-error.js'

export function validateRequest(schemas) {
  return (request, response, next) => {
    const validated = {}

    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(request[part])

      if (!result.success) {
        next(new HttpError(400, 'Request validation failed'))
        return
      }

      validated[part] = result.data
    }

    request.validated = validated
    next()
  }
}

export function isValidationError(error) {
  return error instanceof ZodError
}
