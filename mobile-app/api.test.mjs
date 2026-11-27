import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, apiRequest, getApiOrigin, getApiUrl } from './api.mjs'

const lanBaseUrl = 'http://192.168.1.25:4000/api/v1'

test('builds API URLs from a LAN base URL and rejects missing or loopback URLs', () => {
  assert.equal(getApiUrl('/public/queue', `${lanBaseUrl}/`), `${lanBaseUrl}/public/queue`)
  assert.equal(getApiOrigin(lanBaseUrl), 'http://192.168.1.25:4000')
  assert.throws(
    () => getApiUrl('/public/queue', ''),
    /EXPO_PUBLIC_API_BASE_URL/,
  )
  assert.throws(
    () => getApiUrl('/public/queue', 'http://localhost:4000/api/v1'),
    /not localhost/,
  )
})

test('sends ticket issuance requests to the configured backend', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify({ ticketNumber: '001' }),
    }
  }

  const response = await apiRequest('/public/tickets', {
    method: 'POST',
    body: { transactionType: 'Other Transactions' },
    baseUrl: lanBaseUrl,
  })

  assert.equal(request.url, `${lanBaseUrl}/public/tickets`)
  assert.equal(request.options.method, 'POST')
  assert.equal(request.options.headers['x-ticket-token'], undefined)
  assert.deepEqual(JSON.parse(request.options.body), {
    transactionType: 'Other Transactions',
  })
  assert.deepEqual(response, { ticketNumber: '001' })
})

test('sends the ticket access token when fetching private ticket status', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  let request
  globalThis.fetch = async (url, options) => {
    request = { url, options }
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ status: 'waiting' }),
    }
  }

  await apiRequest('/public/tickets/ticket-id', {
    ticketToken: 'ticket-token',
    baseUrl: lanBaseUrl,
  })

  assert.equal(request.url, `${lanBaseUrl}/public/tickets/ticket-id`)
  assert.equal(request.options.headers['x-ticket-token'], 'ticket-token')
})

test('surfaces backend errors and network failures without substituting data', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () => ({
    ok: false,
    status: 503,
    text: async () => JSON.stringify({
      error: { message: 'Database is not configured' },
    }),
  })

  await assert.rejects(
    apiRequest('/public/queue', { baseUrl: lanBaseUrl }),
    (error) => error instanceof ApiError
      && error.status === 503
      && error.message === 'Database is not configured',
  )

  globalThis.fetch = async () => {
    throw new TypeError('Network request failed')
  }
  await assert.rejects(
    apiRequest('/public/queue', { baseUrl: lanBaseUrl }),
    /Cannot reach the QueueMate backend/,
  )
})
