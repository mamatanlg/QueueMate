import assert from 'node:assert/strict'
import test from 'node:test'
import { QUEUE_ENTRY_QR_PAYLOAD, parseQueueEntryQr } from './queue-entry-qr.mjs'

test('accepts the exact Public TV queue-entry payload', () => {
  assert.deepEqual(parseQueueEntryQr(QUEUE_ENTRY_QR_PAYLOAD), {
    flow: 'queue-entry',
    version: 1,
  })
})

test('rejects malformed or altered QueueMate payloads', () => {
  for (const payload of [
    'queuemate://queue-entry',
    'queuemate://queue-entry/v2',
    'queuemate://queue-entry/v1?redirect=https://example.com',
    'queuemate://queue-entry/v1#other',
    ' queuemate://queue-entry/v1',
  ]) {
    assert.equal(parseQueueEntryQr(payload), null, payload)
  }
})

test('rejects unrelated URLs, access codes, and non-string values', () => {
  for (const payload of [
    'https://example.com/mobile',
    'QM-47K2',
    'https://example.com/?code=QM-47K2',
    null,
    42,
  ]) {
    assert.equal(parseQueueEntryQr(payload), null)
  }
})
