import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import test from 'node:test'
import {
  callNext,
  finishCurrentTicket,
  getCashierWindow,
  getPublicQueue,
  getTicketStatus,
  getWaitingQueue,
  issueTicket,
  setWindowAvailability,
} from '../src/services/queue-service.js'

class ScriptedDatabase {
  constructor(responses) {
    this.responses = [...responses]
    this.calls = []
    this.client = {
      query: async (sql, values = []) => this.runQuery(sql, values),
      release: () => {},
    }
  }

  async runQuery(sql, values = []) {
    this.calls.push({ sql, values })
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] }
    const response = this.responses.shift()
    assert.ok(response, `Unexpected query: ${sql}`)
    if (response.match) assert.match(sql, response.match)
    if (response.values) assert.deepEqual(values, response.values)
    if (response.error) throw response.error
    return { rows: response.rows ?? [] }
  }

  async connect() {
    return this.client
  }

  assertDone() {
    assert.equal(this.responses.length, 0)
  }
}

class ConcurrentQueueDatabase {
  constructor() {
    this.windows = new Map([
      ['window-2', { id: 'window-2', window_number: 2 }],
      ['window-3', { id: 'window-3', window_number: 3 }],
    ])
    this.tickets = [
      { id: 'ticket-1', business_date: '2026-11-13', queue_number: 1, status: 'waiting' },
      { id: 'ticket-2', business_date: '2026-11-13', queue_number: 2, status: 'waiting' },
    ]
    this.queueLock = Promise.resolve()
  }

  async connect() {
    const client = {
      releaseQueueLock: null,
      release: () => {},
      query: async (sql, values = []) => {
        if (sql === 'BEGIN') return { rows: [] }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          client.releaseQueueLock?.()
          client.releaseQueueLock = null
          return { rows: [] }
        }
        if (sql.includes('FROM cashier_windows')) {
          const window = this.windows.get(values[0])
          return { rows: [{ ...window, availability_status: 'available' }] }
        }
        if (sql.includes("WHERE window_id = $1 AND status = 'serving'")) {
          return {
            rows: this.tickets
              .filter((ticket) => ticket.window_id === values[0] && ticket.status === 'serving')
              .map((ticket) => ({ id: ticket.id })),
          }
        }
        if (sql.includes('FOR UPDATE OF q')) {
          let unlock
          const previous = this.queueLock
          this.queueLock = new Promise((resolve) => { unlock = resolve })
          await previous
          client.releaseQueueLock = unlock
          const ticket = this.tickets.find((item) => (
            item.status === 'waiting' && item.business_date === '2026-11-13'
          ))
          return { rows: ticket ? [{ ...ticket, transaction_type: 'SOA' }] : [] }
        }
        if (sql.includes("SET status = 'serving'")) {
          const ticket = this.tickets.find((item) => item.id === values[0])
          Object.assign(ticket, { status: 'serving', window_id: values[1] })
          return { rows: [] }
        }
        if (sql.includes("VALUES ($1, 'called')")) {
          return { rows: [{ id: 'called-notification' }] }
        }
        if (sql.includes('queue_number = $2')) return { rows: [] }
        return { rows: [] }
      },
    }
    return client
  }
}

function cashierAuth() {
  return {
    staff_id: randomUUID(),
    assigned_window_id: randomUUID(),
  }
}

test('ticket issuance increments the Manila daily counter and stores only a token hash', async () => {
  const database = new ScriptedDatabase([
    { match: /FROM transaction_types/, rows: [{ id: randomUUID(), name: 'SOA' }] },
    { match: /Asia\/Manila/, rows: [{ business_date: '2026-11-13' }] },
    { match: /ON CONFLICT \(business_date\)/, rows: [{ last_number: 1 }] },
    {
      match: /INSERT INTO queue_tickets/,
      rows: [{
        id: randomUUID(),
        business_date: '2026-11-13',
        queue_number: 1,
        issued_at: '2026-11-13T00:00:00.000Z',
        status: 'waiting',
      }],
    },
    { match: /INSERT INTO queue_history/ },
  ])
  const events = []
  const response = await issueTicket({
    database,
    transactionType: 'SOA',
    publicEvent: (event, payload) => events.push({ event, payload }),
  })

  const ticketInsert = database.calls.find(({ sql }) => (
    sql.includes('INSERT INTO queue_tickets')
  ))
  const expectedHash = createHash('sha256')
    .update(response.ticketAccessToken)
    .digest('hex')

  assert.equal(response.ticketNumber, '001')
  assert.equal(response.transactionType, 'SOA')
  assert.match(response.ticketAccessToken, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(ticketInsert.values[3], expectedHash)
  assert.notEqual(ticketInsert.values[3], response.ticketAccessToken)
  assert.equal(events[0].event, 'ticket:issued')
  assert.equal('ticketAccessToken' in events[0].payload, false)
  assert.match(
    database.calls.find(({ sql }) => sql.includes('ON CONFLICT (business_date)')).sql,
    /last_number = daily_queue_counters\.last_number \+ 1/,
  )
  database.assertDone()
})

test('ticket status requires its access token and hides the window until called', async () => {
  const ticketId = randomUUID()
  const accessToken = 'a'.repeat(43)
  let queryValues
  const database = {
    async query(_sql, values) {
      queryValues = values
      return {
        rows: [{
          business_date: '2026-11-13',
          queue_number: 1,
          status: 'waiting',
          issued_at: '2026-11-13T00:00:00.000Z',
          called_at: null,
          completed_at: null,
          skipped_at: null,
          transaction_type: 'SOA',
          window_number: null,
        }],
      }
    },
  }
  const response = await getTicketStatus({ database, ticketId, accessToken })

  assert.equal(queryValues[0], ticketId)
  assert.equal(
    queryValues[1],
    createHash('sha256').update(accessToken).digest('hex'),
  )
  assert.equal('windowNumber' in response, false)
  assert.equal(response.ticketNumber, '001')
})

test('public waiting counts and window current tickets are scoped to the Manila business date', async () => {
  const queryCalls = []
  const database = {
    async query(sql) {
      queryCalls.push(sql)
      return {
        rows: [{
          business_date: '2026-11-13',
          latest_number: 2,
          waiting_count: 1,
          windows: [{
            windowNumber: 1,
            status: 'available',
            currentTicketNumber: null,
          }],
        }],
      }
    },
  }

  const response = await getPublicQueue({ database })

  assert.equal(response.waitingCount, 1)
  assert.equal(response.windows[0].currentTicketNumber, null)
  assert.match(queryCalls[0], /business_date = \(SELECT day FROM business_day\)/)
  assert.match(queryCalls[0], /q\.business_date = \(SELECT day FROM business_day\)/)
})

test('cashier waiting queue is scoped to the Manila business date', async () => {
  let query
  const database = {
    async query(sql) {
      query = sql
      return {
        rows: [{
          business_date: '2026-11-13',
          queue_number: 2,
          transaction_type: 'SOA',
          issued_at: '2026-11-13T00:00:00.000Z',
        }],
      }
    },
  }

  const response = await getWaitingQueue({ database })

  assert.equal(response.length, 1)
  assert.equal(response[0].ticketNumber, '002')
  assert.match(query, /business_date = \(SELECT day FROM business_day\)/)
  assert.match(query, /ORDER BY q\.queue_number/)
})

test('cashier window response includes the business dates used to identify stale current tickets', async () => {
  const auth = {
    username: 'cashier1',
    display_name: 'Cashier One',
    assigned_window_id: 'window-1',
  }
  const database = {
    async query(sql) {
      assert.match(sql, /Asia\/Manila/)
      return {
        rows: [{
          business_date: '2026-11-13',
          window_number: 1,
          window_name: 'Window 1',
          availability_status: 'available',
          current_queue_number: 3,
          current_ticket_business_date: '2026-11-12',
          current_transaction_type: 'Payment',
        }],
      }
    },
  }

  const response = await getCashierWindow({ database, auth })

  assert.equal(response.window.businessDate, '2026-11-13')
  assert.equal(response.window.currentTicketBusinessDate, '2026-11-12')
})

test('call next locks and claims the oldest waiting ticket, then alerts N-5', async () => {
  const auth = cashierAuth()
  const windowId = auth.assigned_window_id
  const ticketId = randomUUID()
  const targetTicketId = randomUUID()
  const database = new ScriptedDatabase([
    { match: /FROM cashier_windows[\s\S]*FOR UPDATE/, rows: [{
      id: windowId,
      window_number: 2,
      availability_status: 'available',
    }] },
    { match: /status = 'serving'[\s\S]*FOR UPDATE/ },
    {
      match: /business_date = \(NOW\(\) AT TIME ZONE 'Asia\/Manila'\)::date[\s\S]*ORDER BY q\.queue_number[\s\S]*FOR UPDATE OF q/,
      rows: [{
      id: ticketId,
      business_date: '2026-11-13',
      queue_number: 5,
      transaction_type: 'Payment',
      }],
    },
    { match: /SET status = 'serving'/ },
    { match: /INSERT INTO queue_history/ },
    { match: /VALUES \(\$1, 'called'\)/, rows: [{ id: randomUUID() }] },
    { match: /queue_number = \$2[\s\S]*FOR UPDATE/, rows: [{
      id: targetTicketId,
      queue_number: 10,
    }] },
    { match: /VALUES \(\$1, 'near_turn'\)/, rows: [{ id: randomUUID() }] },
  ])
  const events = []
  const response = await callNext({
    database,
    auth,
    publicEvent: (event, payload) => events.push({ event, payload }),
  })

  assert.deepEqual(response, {
    ticketNumber: '005',
    transactionType: 'Payment',
    businessDate: '2026-11-13',
    status: 'serving',
    windowNumber: 2,
  })
  const nextQuery = database.calls.find(({ sql }) => sql.includes('FOR UPDATE OF q'))
  assert.match(nextQuery.sql, /LIMIT 1\s+FOR UPDATE OF q/)
  assert.doesNotMatch(nextQuery.sql, /SKIP LOCKED/)
  assert.deepEqual(events.map(({ event }) => event), [
    'ticket:called',
    'notification:created',
    'notification:created',
  ])
  assert.deepEqual(events.slice(1).map(({ payload }) => payload), [
    { ticketNumber: '005', alertType: 'called' },
    { ticketNumber: '010', alertType: 'near_turn' },
  ])
  assert.equal(
    events.some(({ payload }) => 'ticketAccessToken' in payload),
    false,
  )
  database.assertDone()
})

test('call next selects only tickets from the current Manila business date', async () => {
  const database = new ConcurrentQueueDatabase()
  database.tickets.unshift({
    id: 'yesterday-ticket',
    business_date: '2026-11-12',
    queue_number: 99,
    status: 'waiting',
  })

  const result = await callNext({
    database,
    auth: { staff_id: 'staff-2', assigned_window_id: 'window-2' },
  })

  assert.equal(result.businessDate, '2026-11-13')
  assert.equal(result.ticketNumber, '001')
  assert.equal(
    database.tickets.find(({ id }) => id === 'yesterday-ticket').status,
    'waiting',
  )
})

test('concurrent cashiers receive distinct tickets in oldest-first order', async () => {
  const database = new ConcurrentQueueDatabase()
  const [first, second] = await Promise.all([
    callNext({
      database,
      auth: { staff_id: 'staff-2', assigned_window_id: 'window-2' },
    }),
    callNext({
      database,
      auth: { staff_id: 'staff-3', assigned_window_id: 'window-3' },
    }),
  ])

  assert.deepEqual(
    [first.ticketNumber, second.ticketNumber].sort(),
    ['001', '002'],
  )
  assert.notEqual(first.ticketNumber, second.ticketNumber)
  assert.deepEqual(
    database.tickets.map((ticket) => ticket.status),
    ['serving', 'serving'],
  )
})

test('a cashier cannot call another ticket while their window has a serving ticket', async () => {
  const auth = cashierAuth()
  const database = new ScriptedDatabase([
    { rows: [{
      id: auth.assigned_window_id,
      window_number: 1,
      availability_status: 'available',
    }] },
    { rows: [{ id: randomUUID() }] },
  ])

  await assert.rejects(
    callNext({ database, auth }),
    (error) => error.status === 409
      && error.message === 'Complete or skip the current ticket first',
  )
  assert.equal(database.calls.at(-1).sql, 'ROLLBACK')
  database.assertDone()
})

test('a prior-business-date serving ticket cannot be completed or skipped automatically', async () => {
  const auth = cashierAuth()
  const database = new ScriptedDatabase([
    { rows: [{ id: auth.assigned_window_id, window_number: 4 }] },
    { rows: [{
      id: randomUUID(),
      business_date: '2026-11-12',
      current_business_date: '2026-11-13',
      queue_number: 5,
    }] },
  ])

  await assert.rejects(
    finishCurrentTicket({ database, auth, action: 'completed' }),
    (error) => error.status === 409
      && error.message === 'Previous-business-date tickets require administrative resolution',
  )
  assert.equal(
    database.calls.some(({ sql }) => /SET status = \$2/.test(sql)),
    false,
  )
  assert.equal(database.calls.at(-1).sql, 'ROLLBACK')
  database.assertDone()
})

test('an unavailable cashier window cannot claim a waiting ticket', async () => {
  const auth = cashierAuth()
  const database = new ScriptedDatabase([
    { rows: [{
      id: auth.assigned_window_id,
      window_number: 3,
      availability_status: 'unavailable',
    }] },
  ])

  await assert.rejects(
    callNext({ database, auth }),
    (error) => error.status === 409 && error.message === 'Window is unavailable',
  )
  assert.equal(database.calls.at(-1).sql, 'ROLLBACK')
  database.assertDone()
})

test('skipping completes only the assigned window current ticket and creates no near-turn alert', async () => {
  const auth = cashierAuth()
  const ticketId = randomUUID()
  const database = new ScriptedDatabase([
    { rows: [{ id: auth.assigned_window_id, window_number: 4 }] },
    { rows: [{
      id: ticketId,
      business_date: '2026-11-13',
      queue_number: 5,
      current_business_date: '2026-11-13',
    }] },
    { match: /skipped_at = NOW\(\)/, values: [ticketId, 'skipped'] },
    { match: /'serving', \$4, \$5::jsonb/ },
  ])
  const events = []
  const response = await finishCurrentTicket({
    database,
    auth,
    action: 'skipped',
    publicEvent: (event, payload) => events.push({ event, payload }),
  })

  assert.equal(response.status, 'skipped')
  assert.equal(response.windowNumber, 4)
  assert.deepEqual(events.map(({ event }) => event), ['ticket:skipped'])
  assert.equal(database.calls.some(({ sql }) => sql.includes('INSERT INTO notifications')), false)
  assert.equal(database.calls[3].values[0], ticketId)
  assert.equal(database.calls[3].values[1], 'skipped')
  database.assertDone()
})

test('completing a current ticket records completion and emits the public event', async () => {
  const auth = cashierAuth()
  const ticketId = randomUUID()
  const database = new ScriptedDatabase([
    { rows: [{ id: auth.assigned_window_id, window_number: 1 }] },
    { rows: [{
      id: ticketId,
      business_date: '2026-11-13',
      queue_number: 2,
      current_business_date: '2026-11-13',
    }] },
    { match: /completed_at = NOW\(\)/ },
    { match: /'serving', \$4, \$5::jsonb/ },
  ])
  const events = []
  const response = await finishCurrentTicket({
    database,
    auth,
    action: 'completed',
    publicEvent: (event, payload) => events.push({ event, payload }),
  })

  assert.equal(response.status, 'completed')
  assert.equal(events[0].event, 'ticket:completed')
  database.assertDone()
})

test('window availability updates use the session-bound assigned window', async () => {
  const auth = cashierAuth()
  const database = new ScriptedDatabase([
    { rows: [{
      id: auth.assigned_window_id,
      window_number: 2,
      availability_status: 'unavailable',
    }] },
    { match: /SET availability_status = \$2/, values: [auth.assigned_window_id, 'available'], rows: [{
      window_number: 2,
      availability_status: 'available',
    }] },
  ])
  const events = []
  const response = await setWindowAvailability({
    database,
    auth,
    availabilityStatus: 'available',
    publicEvent: (event, payload) => events.push({ event, payload }),
  })

  assert.deepEqual(response, { windowNumber: 2, status: 'available' })
  assert.deepEqual(events, [{
    event: 'window:updated',
    payload: { windowNumber: 2, status: 'available' },
  }])
  database.assertDone()
})
