import assert from 'node:assert/strict'
import test from 'node:test'
import {
  claimAlertOnce,
  getTicketView,
  hasReachedNearTurn,
  isCalledTransition,
  isTerminalStatus,
  parseTicketAlertEvent,
  triggerAlertOnce,
} from './queue-alerts.mjs'

test('near-turn threshold uses actual waiting position and configured offset', () => {
  assert.equal(hasReachedNearTurn({
    status: 'waiting',
    queuePosition: 6,
    nearTurnOffset: 5,
  }), false)
  assert.equal(hasReachedNearTurn({
    status: 'waiting',
    queuePosition: 5,
    nearTurnOffset: 5,
  }), true)
  assert.equal(hasReachedNearTurn({
    status: 'waiting',
    queuePosition: 2,
    nearTurnOffset: 5,
  }), true)
})

test('near-turn alerts are not shown for non-waiting or invalid position data', () => {
  for (const ticket of [
    { status: 'serving', queuePosition: 1, nearTurnOffset: 5 },
    { status: 'completed', queuePosition: 1, nearTurnOffset: 5 },
    { status: 'skipped', queuePosition: 1, nearTurnOffset: 5 },
    { status: 'waiting', queuePosition: 0, nearTurnOffset: 5 },
    { status: 'waiting', queuePosition: 1, nearTurnOffset: null },
  ]) {
    assert.equal(hasReachedNearTurn(ticket), false)
  }
})

test('called alerts are triggered only on transition into serving', () => {
  assert.equal(isCalledTransition('waiting', 'serving'), true)
  assert.equal(isCalledTransition('serving', 'serving'), false)
  assert.equal(isCalledTransition('waiting', 'completed'), false)
})

test('each alert event is claimed once per ticket and event type', () => {
  const alertedEvents = new Set()
  assert.equal(claimAlertOnce(alertedEvents, 'ticket-a', 'near-turn'), true)
  assert.equal(claimAlertOnce(alertedEvents, 'ticket-a', 'near-turn'), false)
  assert.equal(claimAlertOnce(alertedEvents, 'ticket-a', 'called'), true)
  assert.equal(claimAlertOnce(alertedEvents, 'ticket-b', 'near-turn'), true)
})

test('near-turn and called effects each play sound and vibrate only once', () => {
  const alertedEvents = new Set()
  const effects = { sound: 0, vibration: 0 }

  for (const eventType of ['near-turn', 'called']) {
    const eventEffects = {
      playSound: () => { effects.sound += 1 },
      vibrate: () => { effects.vibration += 1 },
    }
    assert.equal(
      triggerAlertOnce(alertedEvents, 'ticket-a', eventType, eventEffects),
      true,
    )
    assert.equal(
      triggerAlertOnce(alertedEvents, 'ticket-a', eventType, eventEffects),
      false,
    )
  }

  assert.deepEqual(effects, { sound: 2, vibration: 2 })
})

test('push alert payloads are normalized and invalid or unrelated events are ignored', () => {
  assert.deepEqual(parseTicketAlertEvent({
    ticketId: 'ticket-1',
    eventType: 'near_turn',
  }), {
    ticketId: 'ticket-1',
    eventType: 'near-turn',
  })
  assert.deepEqual(parseTicketAlertEvent({
    ticketId: 'ticket-2',
    eventType: 'called',
  }), {
    ticketId: 'ticket-2',
    eventType: 'called',
  })
  assert.equal(parseTicketAlertEvent({ ticketId: 'ticket-1', eventType: 'other' }), null)
  assert.equal(parseTicketAlertEvent({ eventType: 'called' }), null)
})

test('ticket views and polling terminal states follow backend statuses', () => {
  assert.equal(getTicketView('waiting'), 'ticket')
  assert.equal(getTicketView('serving'), 'called')
  assert.equal(getTicketView('completed'), 'completed')
  assert.equal(getTicketView('skipped'), 'skipped')
  assert.equal(isTerminalStatus('completed'), true)
  assert.equal(isTerminalStatus('skipped'), true)
  assert.equal(isTerminalStatus('expired'), true)
  assert.equal(isTerminalStatus('serving'), false)
})
