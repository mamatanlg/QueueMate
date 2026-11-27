import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { config } from '../config/env.js'
import { HttpError } from '../middleware/http-error.js'
import { withTransaction } from '../db/transaction.js'
import { hashTicketAccessToken } from './ticket-token.js'

const expoPushUrl = 'https://exp.host/--/api/v2/push/send'
const expoReceiptsUrl = 'https://exp.host/--/api/v2/push/getReceipts'
const receiptDelayMs = 15 * 60 * 1000
const receiptPollIntervalMs = 5 * 60 * 1000
const outboxPollIntervalMs = 30 * 1000
const staleDeliveryLeaseMs = 10 * 60 * 1000
const expoRequestTimeoutMs = 15 * 1000
const maxPushBatchSize = 100

const alertSettings = {
  near_turn: {
    channelId: 'queuemate-near-turn-v1',
    sound: 'near-turn.wav',
    title: 'QueueMate - Your Turn Is Approaching',
    body: 'Your turn is approaching. Please get ready.',
  },
  called: {
    channelId: 'queuemate-called-v1',
    sound: 'called.wav',
    title: 'QueueMate - Your Number Is Being Called!',
  },
}

export function isExpoPushToken(token) {
  return typeof token === 'string'
    && token.length <= 200
    && /^(?:Exponent|Expo)PushToken\[[A-Za-z0-9_-]+\]$/.test(token)
}

export function buildExpoPushMessage(notification, expoPushToken) {
  const alert = alertSettings[notification.alertType]
  if (!alert) throw new Error('Unsupported QueueMate push notification type')
  if (notification.alertType === 'called' && !Number.isInteger(notification.windowNumber)) {
    throw new Error('Called notification is missing its assigned window')
  }

  return {
    to: expoPushToken,
    title: alert.title,
    body: notification.alertType === 'called'
      ? `Please proceed to Window ${notification.windowNumber}. Your number is now being served.`
      : alert.body,
    sound: alert.sound,
    channelId: alert.channelId,
    priority: 'high',
    data: {
      ticketId: notification.ticketId,
      eventType: notification.alertType,
    },
  }
}

function hashExpoPushToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

function parseEncryptionKey(value) {
  if (!value) {
    throw new HttpError(503, 'Expo push token encryption is not configured')
  }
  const key = Buffer.from(value, 'base64')
  if (key.length !== 32 || key.toString('base64') !== value) {
    throw new HttpError(503, 'Expo push token encryption key is invalid')
  }
  return key
}

function encryptExpoPushToken(token, key) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([
    cipher.update(token, 'utf8'),
    cipher.final(),
  ])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  }
}

function decryptExpoPushToken(subscription, key) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(subscription.expo_push_token_iv, 'base64'),
  )
  decipher.setAuthTag(Buffer.from(subscription.expo_push_token_auth_tag, 'base64'))
  return Buffer.concat([
    decipher.update(
      Buffer.from(subscription.expo_push_token_ciphertext, 'base64'),
    ),
    decipher.final(),
  ]).toString('utf8')
}

export async function registerTicketPushToken({
  database,
  ticketId,
  accessToken,
  expoPushToken,
  tokenEncryptionKey = config.expoPushTokenEncryptionKey,
}) {
  if (!isExpoPushToken(expoPushToken)) {
    throw new HttpError(400, 'Invalid Expo push token')
  }
  const key = parseEncryptionKey(tokenEncryptionKey)
  const tokenHash = hashExpoPushToken(expoPushToken)
  const encryptedToken = encryptExpoPushToken(expoPushToken, key)

  const pendingNotifications = await withTransaction(database, async (client) => {
    const ticketResult = await client.query(
      `SELECT id, status
       FROM queue_tickets
       WHERE id = $1 AND ticket_token_hash = $2
       FOR UPDATE`,
      [ticketId, hashTicketAccessToken(accessToken)],
    )
    const ticket = ticketResult.rows[0]
    if (!ticket) throw new HttpError(404, 'Ticket not found')
    if (!['waiting', 'serving'].includes(ticket.status)) {
      throw new HttpError(409, 'Ticket is no longer active')
    }

    await client.query(
      `INSERT INTO ticket_push_subscriptions
         (ticket_id, expo_push_token_hash, expo_push_token_ciphertext,
          expo_push_token_iv, expo_push_token_auth_tag, is_active, updated_at)
       VALUES ($1, $2, $3, $4, $5, true, NOW())
       ON CONFLICT (ticket_id, expo_push_token_hash)
       DO UPDATE SET expo_push_token_ciphertext = EXCLUDED.expo_push_token_ciphertext,
                     expo_push_token_iv = EXCLUDED.expo_push_token_iv,
                     expo_push_token_auth_tag = EXCLUDED.expo_push_token_auth_tag,
                     is_active = true,
                     updated_at = NOW()`,
      [
        ticketId,
        tokenHash,
        encryptedToken.ciphertext,
        encryptedToken.iv,
        encryptedToken.authTag,
      ],
    )

    const notifications = await client.query(
      `SELECT id
       FROM notifications
       WHERE ticket_id = $1 AND delivery_status = 'pending'
       ORDER BY created_at`,
      [ticketId],
    )
    return notifications.rows
  })

  for (const notification of pendingNotifications) {
    scheduleExpoPushNotification({ database, notificationId: notification.id })
  }
  return { registered: true }
}

function addAuthorizationHeader(headers, accessToken) {
  if (accessToken) headers.authorization = `Bearer ${accessToken}`
  return headers
}

async function postExpoMessages(messages, fetchImpl, accessToken) {
  const response = await fetchImpl(expoPushUrl, {
    method: 'POST',
    headers: addAuthorizationHeader({
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    }, accessToken),
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(expoRequestTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Expo Push Service returned HTTP ${response.status}`)
  }
  const result = await response.json()
  if (!Array.isArray(result.data) || result.data.length !== messages.length) {
    throw new Error('Expo Push Service returned an invalid ticket response')
  }
  return result.data
}

async function claimPendingDeliveries(database, notificationId) {
  return withTransaction(database, async (client) => {
    const notificationResult = await client.query(
      `SELECT n.id, n.ticket_id, n.alert_type, q.queue_number,
              q.status, w.window_number
       FROM notifications n
       JOIN queue_tickets q ON q.id = n.ticket_id
       LEFT JOIN cashier_windows w ON w.id = q.window_id
       WHERE n.id = $1 AND n.delivery_status = 'pending'
       FOR SHARE OF n, q`,
      [notificationId],
    )
    const notification = notificationResult.rows[0]
    if (!notification) return null

    const eligibleStatus = notification.alert_type === 'near_turn'
      ? notification.status === 'waiting'
      : notification.status === 'serving'
    if (!eligibleStatus) {
      await client.query(
        `UPDATE notifications
         SET delivery_status = 'failed'
         WHERE id = $1 AND delivery_status = 'pending'`,
        [notificationId],
      )
      return null
    }

    await client.query(
      `UPDATE notification_push_deliveries
       SET delivery_status = 'pending', updated_at = NOW()
       WHERE notification_id = $1
         AND delivery_status = 'sending'
         AND updated_at <= NOW() - ($2::double precision * INTERVAL '1 millisecond')`,
      [notificationId, staleDeliveryLeaseMs],
    )

    const subscriptionResult = await client.query(
      `SELECT id
       FROM ticket_push_subscriptions
       WHERE ticket_id = $1 AND is_active = true`,
      [notification.ticket_id],
    )
    if (subscriptionResult.rows.length === 0) return null

    for (const subscription of subscriptionResult.rows) {
      await client.query(
        `INSERT INTO notification_push_deliveries
           (notification_id, subscription_id)
         VALUES ($1, $2)
         ON CONFLICT (notification_id, subscription_id) DO NOTHING`,
        [notificationId, subscription.id],
      )
    }

    const claimedResult = await client.query(
      `WITH claimable AS (
         SELECT delivery.id
         FROM notification_push_deliveries delivery
         JOIN ticket_push_subscriptions subscription
           ON subscription.id = delivery.subscription_id
         WHERE delivery.notification_id = $1
           AND delivery.delivery_status = 'pending'
           AND subscription.is_active = true
         ORDER BY delivery.created_at
         FOR UPDATE OF delivery SKIP LOCKED
       )
       UPDATE notification_push_deliveries delivery
       SET delivery_status = 'sending', updated_at = NOW()
       FROM claimable
       WHERE delivery.id = claimable.id
       RETURNING delivery.id`,
      [notificationId],
    )
    if (claimedResult.rows.length === 0) {
      const outstandingResult = await client.query(
        `SELECT EXISTS (
           SELECT 1 FROM notification_push_deliveries
           WHERE notification_id = $1
             AND delivery_status IN ('pending', 'sending')
         ) AS has_outstanding`,
        [notificationId],
      )
      if (!outstandingResult.rows[0]?.has_outstanding) {
        await client.query(
          `UPDATE notifications
           SET delivery_status = CASE WHEN EXISTS (
             SELECT 1 FROM notification_push_deliveries
             WHERE notification_id = $1
               AND delivery_status IN ('accepted', 'delivered')
           ) THEN 'sent' ELSE 'failed' END
           WHERE id = $1 AND delivery_status = 'pending'`,
          [notificationId],
        )
      }
      return null
    }

    const deliveryResult = await client.query(
      `SELECT delivery.id, subscription.id AS subscription_id,
              subscription.expo_push_token_hash,
              subscription.expo_push_token_ciphertext,
              subscription.expo_push_token_iv,
              subscription.expo_push_token_auth_tag
       FROM notification_push_deliveries delivery
       JOIN ticket_push_subscriptions subscription
         ON subscription.id = delivery.subscription_id
       WHERE delivery.id = ANY($1::uuid[])
       ORDER BY delivery.created_at`,
      [claimedResult.rows.map((row) => row.id)],
    )

    return { notification, deliveries: deliveryResult.rows }
  })
}

async function updateNotificationDeliveryStatus(database, notificationId) {
  await database.query(
    `UPDATE notifications
     SET delivery_status = CASE
       WHEN EXISTS (
         SELECT 1 FROM notification_push_deliveries
         WHERE notification_id = $1
           AND delivery_status IN ('accepted', 'delivered')
       ) THEN 'sent'
       ELSE 'failed'
     END
     WHERE id = $1 AND delivery_status = 'pending'`,
    [notificationId],
  )
}

async function recordPushTicket(database, delivery, ticket, logger) {
  if (ticket?.status === 'ok' && typeof ticket.id === 'string') {
    await database.query(
      `UPDATE notification_push_deliveries
       SET delivery_status = 'accepted', expo_ticket_id = $2,
           sent_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND delivery_status = 'sending'`,
      [delivery.id, ticket.id],
    )
    return true
  }

  const errorCode = ticket?.details?.error || ticket?.message || 'ExpoPushRejected'
  await database.query(
    `UPDATE notification_push_deliveries
     SET delivery_status = 'failed', error_code = $2, updated_at = NOW()
     WHERE id = $1 AND delivery_status = 'sending'`,
    [delivery.id, String(errorCode).slice(0, 100)],
  )
  if (errorCode === 'DeviceNotRegistered') {
    await database.query(
      `UPDATE ticket_push_subscriptions
       SET is_active = false, updated_at = NOW()
       WHERE expo_push_token_hash = $1`,
      [delivery.expo_push_token_hash],
    )
  }
  logger.warn('Expo push ticket was rejected', {
    deliveryId: delivery.id,
    errorCode,
  })
  return false
}

export async function dispatchExpoPushNotification({
  database,
  notificationId,
  tokenEncryptionKey = config.expoPushTokenEncryptionKey,
  accessToken = config.expoPushAccessToken,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!tokenEncryptionKey) {
    logger.warn('Expo push delivery is disabled: token encryption is not configured')
    return
  }

  const key = parseEncryptionKey(tokenEncryptionKey)
  const claimed = await claimPendingDeliveries(database, notificationId)
  if (!claimed) return

  try {
    const deliveryWithTokens = claimed.deliveries.map((delivery) => ({
      ...delivery,
      expoPushToken: decryptExpoPushToken(delivery, key),
    }))
    for (let index = 0; index < deliveryWithTokens.length; index += maxPushBatchSize) {
      const batch = deliveryWithTokens.slice(index, index + maxPushBatchSize)
      const messages = batch.map((delivery) => buildExpoPushMessage({
        ...claimed.notification,
        ticketId: claimed.notification.ticket_id,
        alertType: claimed.notification.alert_type,
        ticketNumber: String(claimed.notification.queue_number).padStart(3, '0'),
        windowNumber: claimed.notification.window_number,
      }, delivery.expoPushToken))
      const tickets = await postExpoMessages(messages, fetchImpl, accessToken)
      for (let ticketIndex = 0; ticketIndex < tickets.length; ticketIndex += 1) {
        await recordPushTicket(database, batch[ticketIndex], tickets[ticketIndex], logger)
      }
    }
    await updateNotificationDeliveryStatus(database, notificationId)
  } catch (error) {
    await database.query(
      `UPDATE notification_push_deliveries
       SET delivery_status = 'failed', error_code = 'ExpoServiceUnavailable',
           updated_at = NOW()
       WHERE notification_id = $1 AND delivery_status = 'sending'`,
      [notificationId],
    )
    await updateNotificationDeliveryStatus(database, notificationId)
    logger.error('Expo push delivery failed', {
      notificationId,
      message: error instanceof Error ? error.message : 'Unknown Expo push error',
    })
  }
}

export function scheduleExpoPushNotification({ database, notificationId }) {
  if (!config.expoPushTokenEncryptionKey) return
  void dispatchExpoPushNotification({ database, notificationId }).catch((error) => {
    console.error('Unable to queue Expo push delivery', {
      notificationId,
      message: error instanceof Error ? error.message : 'Unknown push delivery error',
    })
  })
}

async function postReceiptRequest(ids, fetchImpl, accessToken) {
  const response = await fetchImpl(expoReceiptsUrl, {
    method: 'POST',
    headers: addAuthorizationHeader({
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate',
      'content-type': 'application/json',
    }, accessToken),
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(expoRequestTimeoutMs),
  })
  if (!response.ok) {
    throw new Error(`Expo Push Service returned HTTP ${response.status} for receipts`)
  }
  const result = await response.json()
  if (!result.data || typeof result.data !== 'object') {
    throw new Error('Expo Push Service returned an invalid receipt response')
  }
  return result.data
}

export async function processExpoPushReceipts({
  database,
  accessToken = config.expoPushAccessToken,
  fetchImpl = fetch,
  logger = console,
}) {
  const result = await database.query(
    `SELECT delivery.id, delivery.notification_id, delivery.expo_ticket_id,
            subscription.expo_push_token_hash
     FROM notification_push_deliveries delivery
     JOIN ticket_push_subscriptions subscription
       ON subscription.id = delivery.subscription_id
     WHERE delivery.delivery_status = 'accepted'
       AND delivery.receipt_checked_at IS NULL
       AND delivery.created_at <= NOW() - ($1::double precision * INTERVAL '1 millisecond')
     ORDER BY delivery.created_at
     LIMIT 1000`,
    [receiptDelayMs],
  )
  if (result.rows.length === 0) return

  for (let index = 0; index < result.rows.length; index += 1000) {
    const batch = result.rows.slice(index, index + 1000)
    let receipts
    try {
      receipts = await postReceiptRequest(
        batch.map((row) => row.expo_ticket_id),
        fetchImpl,
        accessToken,
      )
    } catch (error) {
      logger.error('Unable to fetch Expo push receipts', {
        message: error instanceof Error ? error.message : 'Unknown receipt error',
      })
      continue
    }

    for (const delivery of batch) {
      const receipt = receipts[delivery.expo_ticket_id]
      if (!receipt) continue
      const errorCode = receipt.details?.error
      const delivered = receipt.status === 'ok'
      await database.query(
        `UPDATE notification_push_deliveries
         SET delivery_status = $2, error_code = $3,
             receipt_checked_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND delivery_status = 'accepted'`,
        [
          delivery.id,
          delivered ? 'delivered' : 'failed',
          delivered ? null : String(errorCode || receipt.message || 'ExpoReceiptFailed').slice(0, 100),
        ],
      )
      const remainingReceipts = await database.query(
        `SELECT EXISTS (
           SELECT 1 FROM notification_push_deliveries
           WHERE notification_id = $1
             AND delivery_status IN ('accepted', 'pending', 'sending')
         ) AS has_outstanding`,
        [delivery.notification_id],
      )
      if (!remainingReceipts.rows[0]?.has_outstanding) {
        await database.query(
          `UPDATE notifications
           SET delivery_status = CASE WHEN EXISTS (
             SELECT 1 FROM notification_push_deliveries
             WHERE notification_id = $1
               AND delivery_status = 'delivered'
           ) THEN 'sent' ELSE 'failed' END
           WHERE id = $1 AND delivery_status = 'sent'`,
          [delivery.notification_id],
        )
      }
      if (errorCode === 'DeviceNotRegistered') {
        await database.query(
          `UPDATE ticket_push_subscriptions
           SET is_active = false, updated_at = NOW()
           WHERE expo_push_token_hash = $1`,
          [delivery.expo_push_token_hash],
        )
      } else if (!delivered) {
        logger.warn('Expo push receipt reported an error', {
          deliveryId: delivery.id,
          errorCode: errorCode || 'ExpoReceiptFailed',
        })
      }
    }
  }
}

export async function processPendingExpoPushNotifications({
  database,
  ...dispatchOptions
}) {
  const pending = await database.query(
    `SELECT notification.id
     FROM notifications notification
     WHERE notification.delivery_status = 'pending'
       AND EXISTS (
         SELECT 1
         FROM ticket_push_subscriptions subscription
         WHERE subscription.ticket_id = notification.ticket_id
           AND subscription.is_active = true
       )
     ORDER BY notification.created_at
     LIMIT 25`,
  )

  for (const notification of pending.rows) {
    await dispatchExpoPushNotification({
      database,
      notificationId: notification.id,
      ...dispatchOptions,
    })
  }
}

export function startExpoPushWorker(database, options = {}) {
  let receiptWorkerRunning = false
  let outboxWorkerRunning = false
  const receiptTimer = setInterval(() => {
    if (receiptWorkerRunning) return
    receiptWorkerRunning = true
    void processExpoPushReceipts({ database, ...options })
      .catch((error) => {
        console.error('Expo push receipt worker failed', {
          message: error instanceof Error ? error.message : 'Unknown receipt worker error',
        })
      })
      .finally(() => {
        receiptWorkerRunning = false
      })
  }, receiptPollIntervalMs)
  const outboxTimer = setInterval(() => {
    if (outboxWorkerRunning) return
    outboxWorkerRunning = true
    void processPendingExpoPushNotifications({ database, ...options })
      .catch((error) => {
        console.error('Expo push outbox worker failed', {
          message: error instanceof Error ? error.message : 'Unknown push outbox error',
        })
      })
      .finally(() => {
        outboxWorkerRunning = false
      })
  }, outboxPollIntervalMs)
  receiptTimer.unref()
  outboxTimer.unref()
  return () => {
    clearInterval(receiptTimer)
    clearInterval(outboxTimer)
  }
}
