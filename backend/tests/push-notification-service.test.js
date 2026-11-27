import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  buildExpoPushMessage,
  dispatchExpoPushNotification,
  isExpoPushToken,
  processPendingExpoPushNotifications,
  processExpoPushReceipts,
  registerTicketPushToken,
} from '../src/services/push-notification-service.js'

const encryptionKey = Buffer.alloc(32, 7).toString('base64')
const expoPushToken = 'ExponentPushToken[abc123_XYZ]'
const ticketAccessToken = 'a'.repeat(43)

function createDatabase({ transactionQuery, query }) {
  const calls = []
  return {
    calls,
    async connect() {
      return {
        async query(sql, values = []) {
          calls.push({ sql, values, transaction: true })
          if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [] }
          return transactionQuery(sql, values)
        },
        release() {},
      }
    },
    async query(sql, values = []) {
      calls.push({ sql, values, transaction: false })
      return query(sql, values)
    },
  }
}

test('push tokens are validated and called messages contain only the ticket ID', () => {
  assert.equal(isExpoPushToken(expoPushToken), true)
  assert.equal(isExpoPushToken('not-a-push-token'), false)

  const message = buildExpoPushMessage({
    ticketId: 'ticket-1',
    alertType: 'called',
    windowNumber: 2,
  }, expoPushToken)

  assert.equal(message.to, expoPushToken)
  assert.equal(message.channelId, 'queuemate-called-v1')
  assert.equal(message.sound, 'called.wav')
  assert.deepEqual(message.data, {
    ticketId: 'ticket-1',
    eventType: 'called',
  })
  assert.equal(JSON.stringify(message).includes(ticketAccessToken), false)
})

test('registration authenticates the ticket and dispatches its encrypted token to Expo', async () => {
  let encryptedToken
  const database = createDatabase({
    transactionQuery(sql, values) {
      if (sql.includes('FROM queue_tickets')) {
        assert.deepEqual(values, [
          'ticket-1',
          createHash('sha256').update(ticketAccessToken).digest('hex'),
        ])
        return { rows: [{ id: 'ticket-1', status: 'waiting' }] }
      }
      if (sql.includes('INSERT INTO ticket_push_subscriptions')) {
        assert.equal(values[0], 'ticket-1')
        assert.equal(values[1], createHash('sha256').update(expoPushToken).digest('hex'))
        assert.notEqual(values[2], expoPushToken)
        encryptedToken = {
          expo_push_token_ciphertext: values[2],
          expo_push_token_iv: values[3],
          expo_push_token_auth_tag: values[4],
        }
        return { rows: [] }
      }
      if (sql.includes("delivery_status = 'pending'")) return { rows: [] }
      throw new Error(`Unexpected transaction query: ${sql}`)
    },
    query() {
      throw new Error('No direct query expected during registration')
    },
  })

  const registered = await registerTicketPushToken({
    database,
    ticketId: 'ticket-1',
    accessToken: ticketAccessToken,
    expoPushToken,
    tokenEncryptionKey: encryptionKey,
  })
  assert.deepEqual(registered, { registered: true })

  let expoRequest
  const notificationDatabase = createDatabase({
    transactionQuery(sql, values) {
      if (sql.includes('SELECT n.id, n.ticket_id')) {
        assert.deepEqual(values, ['notification-1'])
        return {
          rows: [{
            id: 'notification-1',
            ticket_id: 'ticket-1',
            alert_type: 'called',
            queue_number: 1,
            status: 'serving',
            window_number: 2,
          }],
        }
      }
      if (sql.includes("SET delivery_status = 'pending'")) {
        assert.deepEqual(values, ['notification-1', 10 * 60 * 1000])
        return { rows: [] }
      }
      if (sql.includes('SELECT id') && sql.includes('ticket_push_subscriptions')) {
        assert.deepEqual(values, ['ticket-1'])
        return { rows: [{ id: 'subscription-1' }] }
      }
      if (sql.includes('INSERT INTO notification_push_deliveries')) {
        assert.deepEqual(values, ['notification-1', 'subscription-1'])
        return { rows: [] }
      }
      if (sql.includes('WITH claimable AS')) {
        assert.deepEqual(values, ['notification-1'])
        return { rows: [{ id: 'delivery-1' }] }
      }
      if (sql.includes('SELECT delivery.id, subscription.id')) {
        return {
          rows: [{
            id: 'delivery-1',
            subscription_id: 'subscription-1',
            expo_push_token_hash: createHash('sha256').update(expoPushToken).digest('hex'),
            ...encryptedToken,
          }],
        }
      }
      throw new Error(`Unexpected transaction query: ${sql}`)
    },
    query(sql, values) {
      if (sql.includes("SET delivery_status = 'accepted'")) {
        assert.deepEqual(values, ['delivery-1', 'expo-ticket-1'])
        return { rows: [] }
      }
      if (sql.includes('UPDATE notifications')) {
        assert.deepEqual(values, ['notification-1'])
        return { rows: [] }
      }
      throw new Error(`Unexpected direct query: ${sql}`)
    },
  })

  await dispatchExpoPushNotification({
    database: notificationDatabase,
    notificationId: 'notification-1',
    tokenEncryptionKey: encryptionKey,
    fetchImpl: async (url, options) => {
      expoRequest = { url, options }
      return {
        ok: true,
        async json() {
          return { data: [{ status: 'ok', id: 'expo-ticket-1' }] }
        },
      }
    },
    logger: { warn() {}, error() {} },
  })

  const message = JSON.parse(expoRequest.options.body)[0]
  assert.equal(expoRequest.url, 'https://exp.host/--/api/v2/push/send')
  assert.equal(message.to, expoPushToken)
  assert.equal(message.channelId, 'queuemate-called-v1')
  assert.deepEqual(message.data, {
    ticketId: 'ticket-1',
    eventType: 'called',
  })
  assert.equal(JSON.stringify(message).includes(ticketAccessToken), false)
  assert.equal(
    notificationDatabase.calls.some(({ sql }) => sql.includes('SKIP LOCKED')),
    true,
  )
})

test('terminal tickets are not sent push alerts', async () => {
  let fetchCalled = false
  let markedFailed = false
  const database = createDatabase({
    transactionQuery(sql) {
      if (sql.includes('SELECT n.id, n.ticket_id')) {
        return {
          rows: [{
            id: 'notification-1',
            ticket_id: 'ticket-1',
            alert_type: 'called',
            queue_number: 1,
            status: 'completed',
            window_number: 2,
          }],
        }
      }
      if (sql.includes('UPDATE notifications')) {
        markedFailed = true
        return { rows: [] }
      }
      throw new Error(`Unexpected transaction query: ${sql}`)
    },
    query() {
      throw new Error('No direct query expected for an ineligible ticket')
    },
  })

  await dispatchExpoPushNotification({
    database,
    notificationId: 'notification-1',
    tokenEncryptionKey: encryptionKey,
    fetchImpl: async () => {
      fetchCalled = true
      throw new Error('Unexpected Expo request')
    },
  })

  assert.equal(fetchCalled, false)
  assert.equal(markedFailed, true)
})

test('push outbox scans only pending notifications with active ticket registrations', async () => {
  let query
  const database = {
    async query(sql) {
      query = sql
      return { rows: [] }
    },
  }

  await processPendingExpoPushNotifications({ database })

  assert.match(query, /notification\.delivery_status = 'pending'/)
  assert.match(query, /subscription\.ticket_id = notification\.ticket_id/)
  assert.match(query, /subscription\.is_active = true/)
})

test('Expo device-not-registered receipts deactivate that push token', async () => {
  const calls = []
  const database = {
    async query(sql, values = []) {
      calls.push({ sql, values })
      if (sql.includes('SELECT delivery.id, delivery.notification_id')) {
        assert.deepEqual(values, [15 * 60 * 1000])
        return {
          rows: [{
            id: 'delivery-1',
            notification_id: 'notification-1',
            expo_ticket_id: 'expo-ticket-1',
            expo_push_token_hash: 'b'.repeat(64),
          }],
        }
      }
      return { rows: [] }
    },
  }

  await processExpoPushReceipts({
    database,
    fetchImpl: async (_url, options) => {
      assert.deepEqual(JSON.parse(options.body), { ids: ['expo-ticket-1'] })
      return {
        ok: true,
        async json() {
          return {
            data: {
              'expo-ticket-1': {
                status: 'error',
                details: { error: 'DeviceNotRegistered' },
              },
            },
          }
        },
      }
    },
    logger: { warn() {}, error() {} },
  })

  assert.equal(calls.some(({ sql }) => sql.includes('SET is_active = false')), true)
  assert.equal(calls.some(({ sql }) => sql.includes('SET delivery_status = $2')), true)
  assert.equal(calls.some(({ sql }) => sql.includes('UPDATE notifications')), true)
})
