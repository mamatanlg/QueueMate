import { ZodError } from 'zod'
import { HttpError } from './http-error.js'

export function validateRequest(schemas) {
  return (request, response, next) => {
    const validated = {}

    for (const [part, schema] of Object.entries(schemas)) {
      const result = schema.safeParse(request[part])

      if (!result.success) {
        const fields = [...new Set(result.error.issues
          .flatMap((issue) => issue.path)
          .filter((field) => typeof field === 'string'))]
        const message = fields.length > 0
          ? `Request validation failed: ${fields.join(', ')}`
          : 'Request validation failed'
        next(new HttpError(400, message))
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
