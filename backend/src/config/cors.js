export function createCorsOrigin(allowedOrigins) {
  const originSet = new Set(allowedOrigins)

  return (origin, callback) => {
    if (!origin || originSet.has(origin)) {
      callback(null, true)
      return
    }

    const error = new Error('Origin is not allowed by CORS')
    error.code = 'CORS_ORIGIN_DENIED'
    callback(error)
  }
}
