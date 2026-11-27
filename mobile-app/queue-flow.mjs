export function createInitialQueueFlow() {
  return {
    screen: 'welcome',
    accessGranted: false,
    confirmedCode: '',
    selectedTransaction: '',
    ticket: null,
    queue: null,
    ticketError: '',
    queueError: '',
    message: '',
    isIssuingTicket: false,
  }
}

export function getTerminalTicketPresentation(ticket) {
  if (ticket?.status === 'completed') {
    return {
      status: 'completed',
      title: 'Transaction completed successfully!',
      description: `Ticket ${ticket.ticketNumber} has been completed by the cashier.`,
      actionLabel: 'DONE',
    }
  }

  if (ticket?.status === 'skipped') {
    return {
      status: 'skipped',
      title: 'Your number was skipped.',
      description: `Ticket ${ticket.ticketNumber} was skipped. Please approach the Business Office staff for assistance.`,
      actionLabel: 'DONE',
    }
  }

  return null
}

export function shouldMonitorTicket(ticket, screen) {
  return Boolean(
    ticket?.ticketId
    && !['completed', 'skipped', 'expired'].includes(ticket.status)
    && ['ticket', 'monitoring'].includes(screen),
  )
}

export function stopQueueMonitoring({
  interval,
  appStateSubscription,
  socket,
  clearIntervalFn = clearInterval,
}) {
  clearIntervalFn(interval)
  appStateSubscription.remove()
  socket?.disconnect()
}

export function queueFlowReducer(state, action) {
  switch (action.type) {
    case 'qr-accepted':
      return {
        ...state,
        screen: 'verified',
        accessGranted: true,
        confirmedCode: 'Verified',
        message: '',
      }
    case 'open-selection':
      return { ...state, screen: 'selection', message: '' }
    case 'open-verified':
      return { ...state, screen: 'verified', message: '' }
    case 'select-transaction':
      return { ...state, selectedTransaction: action.transaction, message: '' }
    case 'open-ticket':
      return { ...state, screen: 'ticket' }
    case 'open-monitoring':
      return { ...state, screen: 'monitoring' }
    case 'issue-started':
      return { ...state, isIssuingTicket: true, message: '' }
    case 'ticket-issued':
      return {
        ...state,
        screen: 'ticket',
        ticket: action.ticket,
        queue: null,
        ticketError: '',
        queueError: '',
        message: '',
        isIssuingTicket: false,
      }
    case 'ticket-restored':
      return {
        ...state,
        screen: 'ticket',
        ticket: action.ticket,
        queue: null,
        ticketError: '',
        queueError: '',
        message: '',
        isIssuingTicket: false,
      }
    case 'issue-failed':
      return {
        ...state,
        message: action.message,
        isIssuingTicket: false,
      }
    case 'ticket-updated':
      if (state.ticket?.ticketId !== action.ticketId) return state
      return {
        ...state,
        ticket: { ...state.ticket, ...action.ticket },
        ticketError: '',
      }
    case 'queue-updated':
      if (state.ticket?.ticketId !== action.ticketId) return state
      return { ...state, queue: action.queue, queueError: '' }
    case 'tracking-error':
      if (state.ticket?.ticketId !== action.ticketId) return state
      return action.source === 'ticket'
        ? { ...state, ticketError: action.message }
        : { ...state, queueError: action.message }
    case 'message':
      return { ...state, message: action.message }
    case 'return-to-welcome':
    case 'done':
      return createInitialQueueFlow()
    default:
      return state
  }
}
