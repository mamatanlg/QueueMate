export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function getApiUrl(path, baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL) {
  const configuredUrl = baseUrl?.trim().replace(/\/+$/, '')
  if (!configuredUrl) {
    throw new ApiError(
      'QueueMate API is not configured. Set EXPO_PUBLIC_API_BASE_URL to http://<computer-LAN-IP>:4000/api/v1 and restart Expo.',
    )
  }

  let parsedUrl
  try {
    parsedUrl = new URL(configuredUrl)
  } catch {
    throw new ApiError(
      'QueueMate API URL is invalid. Use the computer LAN IP and include /api/v1.',
    )
  }

  if (
    !['http:', 'https:'].includes(parsedUrl.protocol)
    || parsedUrl.username
    || parsedUrl.password
    || parsedUrl.search
    || parsedUrl.hash
    || parsedUrl.pathname.replace(/\/+$/, '') !== '/api/v1'
    || parsedUrl.hostname === 'localhost'
    || /^127(?:\.\d{1,3}){3}$/.test(parsedUrl.hostname)
    || parsedUrl.hostname === '[::1]'
  ) {
    throw new ApiError(
      'QueueMate API URL must be a backend URL ending in /api/v1, not localhost. Use the computer LAN IP when testing on a phone.',
    )
  }

  return `${configuredUrl}${path}`
}

export function getApiOrigin(baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL) {
  return new URL(getApiUrl('', baseUrl)).origin
}

export async function apiRequest(
  path,
  {
    method = 'GET',
    body,
    ticketToken,
    baseUrl,
  } = {},
) {
  const url = getApiUrl(path, baseUrl)
  const headers = { accept: 'application/json' }
  if (ticketToken) headers['x-ticket-token'] = ticketToken
  if (body !== undefined) headers['content-type'] = 'application/json'

  let response
  try {
    response = await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      throw new ApiError(
        'Cannot reach the QueueMate backend. Check that it is running, your phone and computer are on the same network, and the computer firewall allows port 4000.',
      )
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
