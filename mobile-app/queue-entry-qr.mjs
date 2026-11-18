export const QUEUE_ENTRY_QR_PAYLOAD = 'queuemate://queue-entry/v1'

export function parseQueueEntryQr(payload) {
  if (typeof payload !== 'string' || payload !== QUEUE_ENTRY_QR_PAYLOAD) {
    return null
  }

  return { flow: 'queue-entry', version: 1 }
}
