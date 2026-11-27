const terminalStatuses = new Set(['completed', 'skipped', 'expired'])

export function hasReachedNearTurn(ticket) {
  const position = ticket?.queuePosition
  const offset = ticket?.nearTurnOffset

  return ticket?.status === 'waiting'
    && Number.isInteger(position)
    && position > 0
    && Number.isInteger(offset)
    && offset > 0
    && position <= offset
}

export function isCalledTransition(previousStatus, currentStatus) {
  return previousStatus !== 'serving' && currentStatus === 'serving'
}

export function isTerminalStatus(status) {
  return terminalStatuses.has(status)
}

export function parseTicketAlertEvent(data) {
  const eventType = data?.eventType === 'near_turn'
    ? 'near-turn'
    : data?.eventType === 'called'
      ? 'called'
      : null
  if (typeof data?.ticketId !== 'string' || !eventType) return null
  return { ticketId: data.ticketId, eventType }
}

export function getTicketView(status) {
  if (status === 'serving') return 'called'
  if (status === 'completed') return 'completed'
  if (status === 'skipped') return 'skipped'
  if (status === 'expired') return 'expired'
  return 'ticket'
}

export function claimAlertOnce(alertedEvents, ticketId, eventType) {
  const eventKey = `${ticketId}:${eventType}`
  if (alertedEvents.has(eventKey)) return false
  alertedEvents.add(eventKey)
  return true
}

export function triggerAlertOnce(alertedEvents, ticketId, eventType, effects) {
  if (!claimAlertOnce(alertedEvents, ticketId, eventType)) return false
  effects.playSound()
  effects.vibrate()
  return true
}
