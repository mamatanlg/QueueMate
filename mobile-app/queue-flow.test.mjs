import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createInitialQueueFlow,
  getTerminalTicketPresentation,
  queueFlowReducer,
  shouldMonitorTicket,
  stopQueueMonitoring,
} from './queue-flow.mjs'

function issueTicket(state, ticket) {
  return queueFlowReducer(state, { type: 'ticket-issued', ticket })
}

test('completed and skipped tickets show their required message and DONE action', () => {
  for (const status of ['completed', 'skipped']) {
    const ticket = {
      ticketId: `ticket-${status}`,
      ticketNumber: '015',
      status,
    }
    const presentation = getTerminalTicketPresentation(ticket)

    assert.equal(presentation.actionLabel, 'DONE')
    if (status === 'completed') {
      assert.equal(presentation.title, 'Transaction completed successfully!')
      assert.match(presentation.description, /015/)
    } else {
      assert.equal(presentation.title, 'Your number was skipped.')
      assert.match(
        presentation.description,
        /Please approach the Business Office staff for assistance\./,
      )
    }
  }
})

test('DONE from completed or skipped returns to QR entry and permits a new ticket', () => {
  for (const status of ['completed', 'skipped']) {
    const firstTicket = {
      ticketId: `old-${status}`,
      ticketNumber: '015',
      status,
    }
    let state = issueTicket(createInitialQueueFlow(), firstTicket)
    assert.equal(shouldMonitorTicket(state.ticket, 'ticket'), false)

    state = queueFlowReducer(state, { type: 'done' })
    assert.deepEqual(state, createInitialQueueFlow())
    assert.equal(shouldMonitorTicket(state.ticket, state.screen), false)

    state = queueFlowReducer(state, { type: 'qr-accepted' })
    state = queueFlowReducer(state, { type: 'open-selection' })
    state = queueFlowReducer(state, {
      type: 'select-transaction',
      transaction: 'SOA',
    })
    assert.equal(state.screen, 'selection')
    assert.equal(state.selectedTransaction, 'SOA')

    const secondTicket = {
      ticketId: `new-${status}`,
      ticketNumber: '016',
      status: 'waiting',
    }
    state = issueTicket(state, secondTicket)
    assert.equal(shouldMonitorTicket(state.ticket, state.screen), true)

    const latestState = queueFlowReducer(state, {
      type: 'ticket-updated',
      ticketId: firstTicket.ticketId,
      ticket: { status: 'skipped' },
    })
    assert.equal(latestState, state)
    assert.equal(latestState.ticket.ticketId, secondTicket.ticketId)
    assert.equal(latestState.ticket.status, 'waiting')
  }
})

test('live queue responses are scoped to the currently active ticket', () => {
  const state = issueTicket(createInitialQueueFlow(), {
    ticketId: 'current-ticket',
    status: 'waiting',
  })
  const updated = queueFlowReducer(state, {
    type: 'queue-updated',
    ticketId: 'stale-ticket',
    queue: { windows: [] },
  })

  assert.equal(updated, state)
})

test('a ticket opened from a notification restores into the monitor screen', () => {
  const ticket = {
    ticketId: 'restored-ticket',
    ticketNumber: '023',
    status: 'serving',
    windowNumber: 2,
  }
  const state = queueFlowReducer(createInitialQueueFlow(), {
    type: 'ticket-restored',
    ticket,
  })

  assert.equal(state.screen, 'ticket')
  assert.deepEqual(state.ticket, ticket)
  assert.equal(shouldMonitorTicket(state.ticket, state.screen), true)
})

test('ticket monitoring cleanup stops polling and removes old listeners', () => {
  const cleaned = []
  stopQueueMonitoring({
    interval: 'old-ticket-poll',
    appStateSubscription: {
      remove() {
        cleaned.push('app-state-listener')
      },
    },
    socket: {
      disconnect() {
        cleaned.push('socket-listener')
      },
    },
    clearIntervalFn(interval) {
      cleaned.push(interval)
    },
  })

  assert.deepEqual(cleaned, [
    'old-ticket-poll',
    'app-state-listener',
    'socket-listener',
  ])
})

