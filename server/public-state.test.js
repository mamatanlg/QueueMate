import assert from 'node:assert/strict'
import test from 'node:test'
import { getPublicState } from './public-state.js'

test('public state omits the ElevenLabs API key without mutating server settings', () => {
  const apiKey = 'private-test-api-key'
  const state = {
    settings: { elevenLabsApiKey: apiKey, ttsProvider: 'elevenlabs' },
    counters: [],
    categories: [],
    tickets: [],
    nextTicketNumber: 1,
    announcements: [],
    branches: [],
    activeBranch: 'main',
    auditLog: [],
    shifts: [],
    roles: { adminPassword: 'configured', operatorPassword: '' },
  }

  const publicState = getPublicState(state, true)

  assert.equal(publicState.settings.ttsProvider, 'elevenlabs')
  assert.equal(Object.hasOwn(publicState.settings, 'elevenLabsApiKey'), false)
  assert.equal(state.settings.elevenLabsApiKey, apiKey)
  assert.equal(JSON.stringify(publicState).includes(apiKey), false)
})
