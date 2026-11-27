import { createHash } from 'node:crypto'

export function hashTicketAccessToken(token) {
  return createHash('sha256').update(token).digest('hex')
}
