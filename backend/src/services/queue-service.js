import { createHash, randomBytes } from 'node:crypto'
import { HttpError } from '../middleware/http-error.js'
import { withTransaction } from '../db/transaction.js'

const ticketTokenBytes = 32

function formatQueueNumber(number) {
  return String(number).padStart(3, '0')
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('hex')
}

function emit(publicEvent, name, payload) {
  publicEvent?.(name, payload)
}

export async function issueTicket({ database, transactionType, publicEvent }) {
  const accessToken = randomBytes(ticketTokenBytes).toString('base64url')

  const issued = await withTransaction(database, async (client) => {
    const typeResult = await client.query(
      `SELECT id, name FROM transaction_types
       WHERE name = $1 AND is_active = true`,
      [transactionType],
    )
    const type = typeResult.rows[0]
    if (!type) throw new HttpError(400, 'Transaction type is unavailable')

    const dateResult = await client.query(
      `SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS business_date`,
    )
    const businessDate = dateResult.rows[0].business_date
    const counterResult = await client.query(
      `INSERT INTO daily_queue_counters (business_date, last_number)
       VALUES ($1, 1)
       ON CONFLICT (business_date)
       DO UPDATE SET last_number = daily_queue_counters.last_number + 1,
                     updated_at = NOW()
       RETURNING last_number`,
      [businessDate],
    )
    const queueNumber = counterResult.rows[0].last_number
    const ticketResult = await client.query(
      `INSERT INTO queue_tickets
         (business_date, queue_number, transaction_type_id, ticket_token_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING id, business_date, queue_number, issued_at, status`,
      [businessDate, queueNumber, type.id, tokenHash(accessToken)],
    )
    const ticket = ticketResult.rows[0]

    await client.query(
      `INSERT INTO queue_history
         (ticket_id, action, new_status, details)
       VALUES ($1, 'issued', 'waiting', $2::jsonb)`,
      [ticket.id, JSON.stringify({ queueNumber, transactionType: type.name })],
    )

    return { ...ticket, transactionType: type.name }
  })

  const response = {
    ticketId: issued.id,
    ticketNumber: formatQueueNumber(issued.queue_number),
    transactionType: issued.transactionType,
    businessDate: issued.business_date,
    status: issued.status,
    issuedAt: issued.issued_at,
    ticketAccessToken: accessToken,
  }
  emit(publicEvent, 'ticket:issued', {
    ticketNumber: response.ticketNumber,
    transactionType: response.transactionType,
    businessDate: response.businessDate,
    status: response.status,
  })

  return response
}

export async function getPublicQueue({ database }) {
  const result = await database.query(`
    WITH business_day AS (
      SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS day
    )
    SELECT
      (SELECT day FROM business_day) AS business_date,
      COALESCE((
        SELECT last_number FROM daily_queue_counters
        WHERE business_date = (SELECT day FROM business_day)
      ), 0) AS latest_number,
      (
        SELECT COUNT(*)::integer FROM queue_tickets
        WHERE status = 'waiting'
          AND business_date = (SELECT day FROM business_day)
      ) AS waiting_count,
      COALESCE((
        SELECT json_agg(json_build_object(
          'windowNumber', w.window_number,
          'status', CASE WHEN w.is_active
            THEN w.availability_status ELSE 'unavailable' END,
          'currentTicketNumber', CASE WHEN q.id IS NULL
            THEN NULL ELSE LPAD(q.queue_number::text, 3, '0') END
        ) ORDER BY w.window_number)
        FROM cashier_windows w
        LEFT JOIN queue_tickets q
          ON q.window_id = w.id
         AND q.status = 'serving'
         AND q.business_date = (SELECT day FROM business_day)
        WHERE w.window_number BETWEEN 1 AND 4
      ), '[]'::json) AS windows
  `)
  const queue = result.rows[0]

  return {
    businessDate: queue.business_date,
    latestIssuedQueueNumber: formatQueueNumber(queue.latest_number),
    waitingCount: queue.waiting_count,
    windows: queue.windows,
  }
}

export async function getTicketStatus({ database, ticketId, accessToken }) {
  const result = await database.query(
    `SELECT q.business_date, q.queue_number, q.status, q.issued_at,
            q.called_at, q.completed_at, q.skipped_at,
            t.name AS transaction_type,
            CASE WHEN q.window_id IS NOT NULL THEN w.window_number END AS window_number
     FROM queue_tickets q
     JOIN transaction_types t ON t.id = q.transaction_type_id
     LEFT JOIN cashier_windows w ON w.id = q.window_id
     WHERE q.id = $1 AND q.ticket_token_hash = $2`,
    [ticketId, tokenHash(accessToken)],
  )
  const ticket = result.rows[0]
  if (!ticket) throw new HttpError(404, 'Ticket not found')

  return {
    ticketNumber: formatQueueNumber(ticket.queue_number),
    transactionType: ticket.transaction_type,
    businessDate: ticket.business_date,
    status: ticket.status,
    issuedAt: ticket.issued_at,
    calledAt: ticket.called_at,
    completedAt: ticket.completed_at,
    skippedAt: ticket.skipped_at,
    ...(ticket.window_number === null
      ? {}
      : { windowNumber: ticket.window_number }),
  }
}

export async function getCashierWindow({ database, auth }) {
  const result = await database.query(
    `WITH business_day AS (
       SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS day
     )
     SELECT (SELECT day FROM business_day) AS business_date,
            w.window_number, w.window_name, w.availability_status,
            q.queue_number AS current_queue_number,
            q.business_date AS current_ticket_business_date,
            t.name AS current_transaction_type
     FROM cashier_windows w
     LEFT JOIN queue_tickets q
       ON q.window_id = w.id AND q.status = 'serving'
     LEFT JOIN transaction_types t ON t.id = q.transaction_type_id
     WHERE w.id = $1 AND w.is_active = true`,
    [auth.assigned_window_id],
  )
  const window = result.rows[0]
  if (!window) throw new HttpError(404, 'Assigned window not found')

  return {
    cashier: {
      username: auth.username,
      displayName: auth.display_name,
    },
    window: {
      number: window.window_number,
      name: window.window_name,
      status: window.availability_status,
      businessDate: window.business_date,
      currentTicketNumber: window.current_queue_number === null
        ? null
        : formatQueueNumber(window.current_queue_number),
      currentTicketBusinessDate: window.current_ticket_business_date,
      currentTransactionType: window.current_transaction_type,
    },
  }
}

export async function getWaitingQueue({ database }) {
  const result = await database.query(`
    WITH business_day AS (
      SELECT (NOW() AT TIME ZONE 'Asia/Manila')::date AS day
    )
    SELECT q.business_date, q.queue_number, t.name AS transaction_type,
           q.issued_at
    FROM queue_tickets q
    JOIN transaction_types t ON t.id = q.transaction_type_id
    WHERE q.status = 'waiting'
      AND q.business_date = (SELECT day FROM business_day)
    ORDER BY q.queue_number
  `)

  return result.rows.map((ticket) => ({
    ticketNumber: formatQueueNumber(ticket.queue_number),
    transactionType: ticket.transaction_type,
    businessDate: ticket.business_date,
    issuedAt: ticket.issued_at,
  }))
}

export async function setWindowAvailability({
  database,
  auth,
  availabilityStatus,
  publicEvent,
}) {
  const result = await withTransaction(database, async (client) => {
    const result = await client.query(
      `SELECT id, window_number, availability_status
       FROM cashier_windows
       WHERE id = $1 AND is_active = true
       FOR UPDATE`,
      [auth.assigned_window_id],
    )
    const current = result.rows[0]
    if (!current) throw new HttpError(404, 'Assigned window not found')

    if (current.availability_status !== availabilityStatus) {
      const updated = await client.query(
        `UPDATE cashier_windows
         SET availability_status = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING window_number, availability_status`,
        [current.id, availabilityStatus],
      )
      return { window: updated.rows[0], changed: true }
    }

    return { window: current, changed: false }
  })

  if (result.changed) {
    emit(publicEvent, 'window:updated', {
      windowNumber: result.window.window_number,
      status: result.window.availability_status,
    })
  }
  return {
    windowNumber: result.window.window_number,
    status: result.window.availability_status,
  }
}

export async function callNext({ database, auth, publicEvent }) {
  const call = await withTransaction(database, async (client) => {
    const windowResult = await client.query(
      `SELECT id, window_number, availability_status
       FROM cashier_windows
       WHERE id = $1 AND is_active = true
       FOR UPDATE`,
      [auth.assigned_window_id],
    )
    const window = windowResult.rows[0]
    if (!window) throw new HttpError(404, 'Assigned window not found')
    if (window.availability_status !== 'available') {
      throw new HttpError(409, 'Window is unavailable')
    }

    const currentResult = await client.query(
      `SELECT id FROM queue_tickets
       WHERE window_id = $1 AND status = 'serving'
       FOR UPDATE`,
      [window.id],
    )
    if (currentResult.rows.length > 0) {
      throw new HttpError(409, 'Complete or skip the current ticket first')
    }

    const nextResult = await client.query(
      `SELECT q.id, q.business_date, q.queue_number, q.status,
              t.name AS transaction_type
       FROM queue_tickets q
       JOIN transaction_types t ON t.id = q.transaction_type_id
       WHERE q.status = 'waiting'
         AND q.business_date = (NOW() AT TIME ZONE 'Asia/Manila')::date
       ORDER BY q.queue_number
       LIMIT 1
       FOR UPDATE OF q`,
    )
    const ticket = nextResult.rows[0]
    if (!ticket) throw new HttpError(409, 'There are no waiting tickets')

    await client.query(
      `UPDATE queue_tickets
       SET status = 'serving', window_id = $2, called_at = NOW()
       WHERE id = $1`,
      [ticket.id, window.id],
    )
    await client.query(
      `INSERT INTO queue_history
         (ticket_id, staff_id, window_id, action, previous_status, new_status, details)
       VALUES ($1, $2, $3, 'called', 'waiting', 'serving', $4::jsonb)`,
      [
        ticket.id,
        auth.staff_id,
        window.id,
        JSON.stringify({ queueNumber: ticket.queue_number }),
      ],
    )

    const notifications = []
    const calledNotification = await client.query(
      `INSERT INTO notifications (ticket_id, alert_type)
       VALUES ($1, 'called')
       ON CONFLICT (ticket_id, alert_type) DO NOTHING
       RETURNING id`,
      [ticket.id],
    )
    if (calledNotification.rows.length > 0) {
      notifications.push({
        ticketNumber: formatQueueNumber(ticket.queue_number),
        alertType: 'called',
      })
    }

    const nearTurnResult = await client.query(
      `SELECT id, queue_number
       FROM queue_tickets
       WHERE business_date = $1 AND queue_number = $2
         AND status = 'waiting'
       FOR UPDATE`,
      [ticket.business_date, ticket.queue_number + 5],
    )
    const nearTurnTicket = nearTurnResult.rows[0]
    if (nearTurnTicket) {
      const nearTurnNotification = await client.query(
        `INSERT INTO notifications (ticket_id, alert_type)
         VALUES ($1, 'near_turn')
         ON CONFLICT (ticket_id, alert_type) DO NOTHING
         RETURNING id`,
        [nearTurnTicket.id],
      )
      if (nearTurnNotification.rows.length > 0) {
        notifications.push({
          ticketNumber: formatQueueNumber(nearTurnTicket.queue_number),
          alertType: 'near_turn',
        })
      }
    }

    return {
      ticketNumber: formatQueueNumber(ticket.queue_number),
      transactionType: ticket.transaction_type,
      businessDate: ticket.business_date,
      status: 'serving',
      windowNumber: window.window_number,
      notifications,
    }
  })

  emit(publicEvent, 'ticket:called', {
    ticketNumber: call.ticketNumber,
    businessDate: call.businessDate,
    status: call.status,
    windowNumber: call.windowNumber,
  })
  for (const notification of call.notifications) {
    emit(publicEvent, 'notification:created', notification)
  }

  return {
    ticketNumber: call.ticketNumber,
    transactionType: call.transactionType,
    businessDate: call.businessDate,
    status: call.status,
    windowNumber: call.windowNumber,
  }
}

export async function finishCurrentTicket({
  database,
  auth,
  action,
  publicEvent,
}) {
  const ticket = await withTransaction(database, async (client) => {
    const windowResult = await client.query(
      `SELECT id, window_number
       FROM cashier_windows
       WHERE id = $1 AND is_active = true
       FOR UPDATE`,
      [auth.assigned_window_id],
    )
    const window = windowResult.rows[0]
    if (!window) throw new HttpError(404, 'Assigned window not found')

    const currentResult = await client.query(
      `SELECT id, business_date, queue_number,
              (NOW() AT TIME ZONE 'Asia/Manila')::date AS current_business_date
       FROM queue_tickets
       WHERE window_id = $1 AND status = 'serving'
       FOR UPDATE`,
      [window.id],
    )
    const current = currentResult.rows[0]
    if (!current) throw new HttpError(409, 'There is no current ticket')
    if (String(current.business_date) !== String(current.current_business_date)) {
      throw new HttpError(
        409,
        'Previous-business-date tickets require administrative resolution',
      )
    }

    const status = action === 'completed' ? 'completed' : 'skipped'
    const timestamp = action === 'completed' ? 'completed_at' : 'skipped_at'
    await client.query(
      `UPDATE queue_tickets
       SET status = $2, ${timestamp} = NOW()
       WHERE id = $1`,
      [current.id, status],
    )
    await client.query(
      `INSERT INTO queue_history
         (ticket_id, staff_id, window_id, action, previous_status, new_status, details)
       VALUES ($1, $2, $3, $4, 'serving', $4, $5::jsonb)`,
      [
        current.id,
        auth.staff_id,
        window.id,
        status,
        JSON.stringify({ queueNumber: current.queue_number }),
      ],
    )
    return {
      ticketNumber: formatQueueNumber(current.queue_number),
      businessDate: current.business_date,
      status,
      windowNumber: window.window_number,
    }
  })

  emit(publicEvent, `ticket:${ticket.status}`, {
    ticketNumber: ticket.ticketNumber,
    businessDate: ticket.businessDate,
    status: ticket.status,
    windowNumber: ticket.windowNumber,
  })
  return ticket
}
