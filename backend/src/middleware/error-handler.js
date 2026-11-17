import { HttpError } from './http-error.js'
import { isValidationError } from './validate-request.js'

function isDatabaseError(error) {
  return typeof error.code === 'string'
    && (/^[0-9A-Z]{5}$/.test(error.code)
      || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(error.code))
}

function databaseErrorMetadata(error) {
  return Object.fromEntries(
    ['name', 'code', 'constraint', 'table', 'column']
      .filter((key) => typeof error[key] === 'string')
      .map((key) => [key, error[key]]),
  )
}

export function notFoundHandler(request, response, next) {
  next(new HttpError(404, 'Route not found'))
}

export function errorHandler(error, request, response, _next) {
  void _next
  const databaseError = isDatabaseError(error)
  const parserStatus = [400, 413].includes(error.status) ? error.status : null
  const status = error instanceof HttpError
    ? error.status
    : isValidationError(error) ? 400
      : error.code === 'CORS_ORIGIN_DENIED' ? 403
        : databaseError ? 503
          : parserStatus ?? 500
  const safeMessages = {
    400: error.message === 'Request validation failed'
      ? error.message
      : 'Invalid request',
    403: 'Origin is not allowed by CORS',
    413: 'Request body is too large',
  }
  const message = databaseError && !(error instanceof HttpError)
    ? 'A database operation failed. Please try again; contact an administrator if it continues.'
    : status === 500
      ? 'An unexpected server error occurred'
    : status === 404 || error instanceof HttpError
      ? error.message
      : safeMessages[status]

  if (status === 500 || databaseError) {
    console.error(
      databaseError ? 'Database operation failed' : 'Unhandled API error',
      databaseError ? databaseErrorMetadata(error) : { name: error.name ?? 'Error' },
    )
  }

  response.status(status).json({
    error: {
      status,
      message,
    },
  })
}
