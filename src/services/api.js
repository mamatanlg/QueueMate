const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '/api/v1')
  .replace(/\/+$/, '')

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export async function apiRequest(path, { token, method = 'GET', body } = {}) {
  const headers = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method,
      headers,
      credentials: 'omit',
      cache: 'no-store',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError('Cannot reach the QueueMate backend. Check your connection and try again.')
    }
    throw error
  }

  if (response.status === 204) return null

  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      throw new ApiError('The backend returned an invalid response.', 502)
    }
  }

  if (!response.ok) {
    throw new ApiError(
      payload?.error?.message || `The request failed with status ${response.status}.`,
      response.status,
    )
  }

  return payload
}
