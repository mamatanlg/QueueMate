import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { randomUUID, createHash } from 'node:crypto'
import test from 'node:test'
import bcrypt from 'bcrypt'
import { createApp } from '../src/app.js'

const sessionSecret = 'isolated-queue-http-test-secret-at-least-32-bytes'
const cashierPassword = 'queue-http-password-12'
const cashierPasswordHash = await bcrypt.hash(cashierPassword, 4)
const businessDate = '2026-11-13'

class QueueHttpDatabase {
  constructor({ tickets = [], availabilityStatus = 'available' } = {}) {
    this.staff = {
      id: randomUUID(),
      username: 'cashier2',
      password_hash: cashierPasswordHash,
      display_name: 'Cashier Two',
      role: 'cashier',
      is_active: true,
      assigned_window_id: 'window-2',
      window_number: 2,
      window_name: 'Window 2',
    }
    this.window = {
      id: 'window-2',
      window_number: 2,
      window_name: 'Window 2',
      is_active: true,
      availability_status: availabilityStatus,
    }
    this.sessions = new Map()
    this.ticketCounter = 0
    this.tickets = tickets.map((ticket) => ({ ...ticket }))
    this.notifications = []
    this.calls = []
  }

  async query(sql, values = []) {
    this.calls.push({ sql, values })

    if (sql.includes('FROM staff s') && sql.includes('LEFT JOIN cashier_windows')) {
      return {
        rows: this.staff.is_active && values[0] === this.staff.username
          ? [{ ...this.staff }]
          : [],
      }
    }
    if (sql.includes('INSERT INTO auth_sessions')) {
      this.sessions.set(values[0], {
        staffId: values[1],
        expiresAt: values[2],
        revoked: false,
      })
      return { rows: [] }
    }
    if (sql.includes('FROM auth_sessions a')) {
      const session = this.sessions.get(values[0])
      return {
        rows: session
          && session.staffId === values[1]
          && !session.revoked
          && session.expiresAt > new Date()
          && this.staff.is_active
          ? [{
            staff_id: this.staff.id,
            username: this.staff.username,
            display_name: this.staff.display_name,
            role: this.staff.role,
            assigned_window_id: this.staff.assigned_window_id,
            window_number: this.staff.window_number,
            window_name: this.staff.window_name,
            availability_status: this.window.availability_status,
          }]
          : [],
      }
    }
    if (sql.includes('WHERE q.id = $1 AND q.ticket_token_hash = $2')) {
      const ticket = this.tickets.find((item) => (
        item.id === values[0] && item.ticket_token_hash === values[1]
      ))
      return {
        rows: ticket
          ? [{
            business_date: ticket.business_date,
            queue_number: ticket.queue_number,
            status: ticket.status,
            issued_at: ticket.issued_at,
            called_at: ticket.called_at ?? null,
            completed_at: ticket.completed_at ?? null,
            skipped_at: ticket.skipped_at ?? null,
            transaction_type: ticket.transaction_type,
            window_number: ticket.window_id ? this.window.window_number : null,
          }]
          : [],
      }
    }

    throw new Error(`Unexpected database query: ${sql}`)
  }

  async connect() {
    return {
      query: async (sql, values = []) => this.runTransactionQuery(sql, values),
      release() {},
    }
  }

  async runTransactionQuery(sql, values = []) {
    this.calls.push({ sql, values })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] }

    if (sql.includes('FROM transaction_types')) {
      const knownTypes = new Map([
        ['SOA', 'type-soa'],
        ['Payment', 'type-payment'],
        ['Other Transactions', 'type-other'],
      ])
      const name = values[0]
      return knownTypes.has(name)
        ? { rows: [{ id: knownTypes.get(name), name }] }
        : { rows: [] }
    }
    if (sql.trim().startsWith('SELECT (NOW() AT TIME ZONE')) {
      return { rows: [{ business_date: businessDate }] }
    }
    if (sql.includes('INSERT INTO daily_queue_counters')) {
      this.ticketCounter += 1
      return { rows: [{ last_number: this.ticketCounter }] }
    }
    if (sql.includes('INSERT INTO queue_tickets')) {
      const [date, number, _typeId, tokenHash] = values
      const typeById = new Map([
        ['type-soa', 'SOA'],
        ['type-payment', 'Payment'],
        ['type-other', 'Other Transactions'],
      ])
      const ticket = {
        id: randomUUID(),
        business_date: date,
        queue_number: number,
        transaction_type: typeById.get(_typeId),
        ticket_token_hash: tokenHash,
        issued_at: new Date().toISOString(),
        status: 'waiting',
        window_id: null,
      }
      this.tickets.push(ticket)
      return {
        rows: [{
          id: ticket.id,
          business_date: ticket.business_date,
          queue_number: ticket.queue_number,
          issued_at: ticket.issued_at,
          status: ticket.status,
        }],
      }
    }
    if (sql.includes('INSERT INTO queue_history')) return { rows: [] }

    if (sql.includes('FROM cashier_windows') && sql.includes('FOR UPDATE')) {
      return values[0] === this.window.id && this.window.is_active
        ? {
          rows: [{
            id: this.window.id,
            window_number: this.window.window_number,
            availability_status: this.window.availability_status,
          }],
        }
        : { rows: [] }
    }
    if (sql.includes('SELECT id FROM queue_tickets')
      && sql.includes("status = 'serving'")) {
      return {
        rows: this.tickets
          .filter((ticket) => (
            ticket.window_id === values[0] && ticket.status === 'serving'
          ))
          .map(({ id }) => ({ id })),
      }
    }
    if (sql.includes('FOR UPDATE OF q')) {
      const ticket = this.tickets
        .filter((ticket) => (
          ticket.status === 'waiting' && ticket.business_date === businessDate
        ))
        .sort((left, right) => left.queue_number - right.queue_number)[0]
      return {
        rows: ticket
          ? [{
            id: ticket.id,
            business_date: ticket.business_date,
            queue_number: ticket.queue_number,
            status: ticket.status,
            transaction_type: ticket.transaction_type,
          }]
          : [],
      }
    }
    if (sql.includes("SET status = 'serving'")) {
      const ticket = this.tickets.find(({ id }) => id === values[0])
      Object.assign(ticket, {
        status: 'serving',
        window_id: values[1],
        called_at: new Date().toISOString(),
      })
      return { rows: [] }
    }
    if (sql.includes("VALUES ($1, 'called')")) {
      const notification = { ticket_id: values[0], alert_type: 'called' }
      this.notifications.push(notification)
      return { rows: [{ id: randomUUID() }] }
    }
    if (sql.includes('WHERE business_date = $1 AND queue_number = $2')) {
      const ticket = this.tickets.find((item) => (
        item.business_date === values[0]
        && item.queue_number === values[1]
        && item.status === 'waiting'
      ))
      return { rows: ticket ? [{ id: ticket.id, queue_number: ticket.queue_number }] : [] }
    }
    if (sql.includes("VALUES ($1, 'near_turn')")) {
      const notification = { ticket_id: values[0], alert_type: 'near_turn' }
      this.notifications.push(notification)
      return { rows: [{ id: randomUUID() }] }
    }
    if (sql.includes('SELECT id, business_date, queue_number')
      && sql.includes("status = 'serving'")) {
      const ticket = this.tickets.find((item) => (
        item.window_id === values[0] && item.status === 'serving'
      ))
      return {
        rows: ticket
          ? [{
            id: ticket.id,
            business_date: ticket.business_date,
            queue_number: ticket.queue_number,
            current_business_date: businessDate,
          }]
          : [],
      }
    }
    if (/SET status = \$2, (?:completed_at|skipped_at) = NOW\(\)/.test(sql)) {
      const ticket = this.tickets.find(({ id }) => id === values[0])
      Object.assign(ticket, {
        status: values[1],
        [values[1] === 'completed' ? 'completed_at' : 'skipped_at']: new Date().toISOString(),
      })
      return { rows: [] }
    }

    throw new Error(`Unexpected transaction query: ${sql}`)
  }
}

async function createHttpFixture(t, database) {
  const app = createApp({ database, sessionSecret })
  const events = []
  app.set('io', {
    emit: (event, payload) => events.push({ event, payload }),
  })
  const server = createServer(app)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  }))

  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    events,
  }
}

async function requestJson(origin, path, { method = 'GET', token, body, ticketToken } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(ticketToken ? { 'x-ticket-token': ticketToken } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  return {
    status: response.status,
    body: response.status === 204 ? undefined : await response.json(),
  }
}

async function loginCashier(origin) {
  const response = await requestJson(origin, '/api/v1/auth/login', {
    method: 'POST',
    body: { username: 'cashier2', password: cashierPassword },
  })
  assert.equal(response.status, 200)
  return response.body.accessToken
}

function makeTicket(number, {
  date = businessDate,
  status = 'waiting',
  windowId = null,
  transactionType = 'SOA',
} = {}) {
  return {
    id: `ticket-${date}-${number}`,
    business_date: date,
    queue_number: number,
    transaction_type: transactionType,
    ticket_token_hash: createHash('sha256').update(`access-${number}`).digest('hex'),
    issued_at: `${date}T00:00:00.000Z`,
    status,
    window_id: windowId,
  }
}

test('public HTTP ticket issuance numbers tickets sequentially and tracking requires its access token', async (t) => {
  const database = new QueueHttpDatabase()
  const { origin, events } = await createHttpFixture(t, database)

  const first = await requestJson(origin, '/api/v1/public/tickets', {
    method: 'POST',
    body: { transactionType: 'SOA' },
  })
  const second = await requestJson(origin, '/api/v1/public/tickets', {
    method: 'POST',
    body: { transactionType: 'Payment' },
  })

  assert.equal(first.status, 201)
  assert.equal(second.status, 201)
  assert.equal(first.body.ticketNumber, '001')
  assert.equal(second.body.ticketNumber, '002')
  assert.equal(first.body.businessDate, businessDate)
  assert.match(first.body.ticketAccessToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(database.tickets[0].ticket_token_hash, createHash('sha256')
    .update(first.body.ticketAccessToken)
    .digest('hex'))
  assert.notEqual(database.tickets[0].ticket_token_hash, first.body.ticketAccessToken)

  const tracking = await requestJson(
    origin,
    `/api/v1/public/tickets/${first.body.ticketId}`,
    { ticketToken: first.body.ticketAccessToken },
  )
  assert.equal(tracking.status, 200)
  assert.deepEqual(tracking.body, {
    ticketNumber: '001',
    transactionType: 'SOA',
    businessDate,
    status: 'waiting',
    issuedAt: database.tickets[0].issued_at,
    calledAt: null,
    completedAt: null,
    skippedAt: null,
  })

  const wrongToken = await requestJson(
    origin,
    `/api/v1/public/tickets/${first.body.ticketId}`,
    { ticketToken: 'x'.repeat(43) },
  )
  assert.equal(wrongToken.status, 404)

  assert.deepEqual(events.map(({ event }) => event), ['ticket:issued', 'ticket:issued'])
  assert.equal('ticketAccessToken' in events[0].payload, false)
})

test('cashier HTTP queue operations call the oldest ticket, alert N-5, complete and skip, and emit events', async (t) => {
  const database = new QueueHttpDatabase({
    tickets: [
      makeTicket(6),
      makeTicket(4),
      makeTicket(9),
    ],
  })
  const { origin, events } = await createHttpFixture(t, database)
  const token = await loginCashier(origin)

  const next = await requestJson(origin, '/api/v1/cashier/queue/next', {
    method: 'POST',
    token,
    body: { windowId: 'window-other' },
  })
  assert.equal(next.status, 200)
  assert.deepEqual(next.body, {
    ticketNumber: '004',
    transactionType: 'SOA',
    businessDate,
    status: 'serving',
    windowNumber: 2,
  })
  assert.equal(database.tickets.find(({ queue_number }) => queue_number === 4).status, 'serving')
  assert.equal(database.tickets.find(({ queue_number }) => queue_number === 6).status, 'waiting')
  assert.deepEqual(database.notifications.map(({ alert_type }) => alert_type), [
    'called',
    'near_turn',
  ])
  assert.deepEqual(events.slice(0, 3), [
    {
      event: 'ticket:called',
      payload: {
        ticketNumber: '004',
        businessDate,
        status: 'serving',
        windowNumber: 2,
      },
    },
    {
      event: 'notification:created',
      payload: { ticketNumber: '004', alertType: 'called' },
    },
    {
      event: 'notification:created',
      payload: { ticketNumber: '009', alertType: 'near_turn' },
    },
  ])

  const completed = await requestJson(origin, '/api/v1/cashier/current/complete', {
    method: 'POST',
    token,
  })
  assert.equal(completed.status, 200)
  assert.equal(completed.body.status, 'completed')
  assert.equal(database.tickets.find(({ queue_number }) => queue_number === 4).status, 'completed')
  assert.deepEqual(events.at(-1), {
    event: 'ticket:completed',
    payload: {
      ticketNumber: '004',
      businessDate,
      status: 'completed',
      windowNumber: 2,
    },
  })

  const skipTarget = database.tickets.find(({ queue_number }) => queue_number === 6)
  Object.assign(skipTarget, { status: 'serving', window_id: database.window.id })
  const skipped = await requestJson(origin, '/api/v1/cashier/current/skip', {
    method: 'POST',
    token,
  })
  assert.equal(skipped.status, 200)
  assert.equal(skipped.body.status, 'skipped')
  assert.equal(skipTarget.status, 'skipped')
  assert.deepEqual(events.at(-1), {
    event: 'ticket:skipped',
    payload: {
      ticketNumber: '006',
      businessDate,
      status: 'skipped',
      windowNumber: 2,
    },
  })
})

test('HTTP Call Next selects today and leaves yesterday waiting tickets untouched', async (t) => {
  const yesterday = makeTicket(99, { date: '2026-11-12' })
  const today = makeTicket(1)
  const database = new QueueHttpDatabase({ tickets: [yesterday, today] })
  const { origin } = await createHttpFixture(t, database)
  const token = await loginCashier(origin)

  const response = await requestJson(origin, '/api/v1/cashier/queue/next', {
    method: 'POST',
    token,
  })

  assert.equal(response.status, 200)
  assert.equal(response.body.ticketNumber, '001')
  assert.equal(response.body.businessDate, businessDate)
  assert.equal(yesterday.status, 'waiting')
})

test('HTTP Call Next rejects an unavailable window without claiming a ticket', async (t) => {
  const database = new QueueHttpDatabase({
    tickets: [makeTicket(1)],
    availabilityStatus: 'unavailable',
  })
  const { origin } = await createHttpFixture(t, database)
  const token = await loginCashier(origin)

  const response = await requestJson(origin, '/api/v1/cashier/queue/next', {
    method: 'POST',
    token,
  })

  assert.equal(response.status, 409)
  assert.deepEqual(response.body.error, {
    status: 409,
    message: 'Window is unavailable',
  })
  assert.equal(database.tickets[0].status, 'waiting')
})
