import { HttpError } from './http-error.js'
import { isValidationError } from './validate-request.js'

export function notFoundHandler(request, response, next) {
  next(new HttpError(404, 'Route not found'))
}

export function errorHandler(error, request, response, _next) {
  const parserStatus = [400, 413].includes(error.status) ? error.status : null
  const status = error instanceof HttpError
    ? error.status
    : isValidationError(error) ? 400
      : error.code === 'CORS_ORIGIN_DENIED' ? 403
        : parserStatus ?? 500
  const safeMessages = {
    400: error.message === 'Request validation failed'
      ? error.message
      : 'Invalid request',
    403: 'Origin is not allowed by CORS',
    413: 'Request body is too large',
  }
  const message = status === 500
    ? 'An unexpected server error occurred'
    : status === 404 || error instanceof HttpError
      ? error.message
      : safeMessages[status]

  if (status === 500) {
    console.error('Unhandled API error', error.name ?? 'Error')
  }

  response.status(status).json({
    error: {
      status,
      message,
    },
  })
}
