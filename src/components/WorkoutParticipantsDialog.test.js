import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  initialParticipantsDialogState,
  participantsDialogReducer,
} from '../utils/workoutParticipantsState.js'

test('participant dialog starts empty and loading-safe', () => {
  assert.deepEqual(initialParticipantsDialogState(), {
    participants: [],
    cursor: null,
    loaded: false,
    loading: false,
    error: '',
  })
})

test('first page replaces data and pagination appends the next page', () => {
  const first = participantsDialogReducer(initialParticipantsDialogState(), {
    type: 'load_success',
    reset: true,
    participants: [{ userId: 'u1', username: 'ana' }],
    nextCursor: { joinedAtMs: 1, userId: 'u1' },
  })
  const second = participantsDialogReducer(first, {
    type: 'load_success',
    reset: false,
    participants: [{ userId: 'u2', username: 'bia' }],
    nextCursor: null,
  })
  assert.deepEqual(
    second.participants.map((participant) => participant.userId),
    ['u1', 'u2']
  )
  assert.equal(second.cursor, null)
  assert.equal(second.loaded, true)
})

test('loading clears stale errors and failure preserves loaded participants', () => {
  const populated = {
    participants: [{ userId: 'u1', username: 'ana' }],
    cursor: null,
    loaded: true,
    loading: false,
    error: 'falha antiga',
  }
  const loading = participantsDialogReducer(populated, { type: 'load_start' })
  assert.equal(loading.error, '')
  assert.equal(loading.loading, true)
  const failed = participantsDialogReducer(loading, { type: 'load_error', message: 'falhou' })
  assert.equal(failed.error, 'falhou')
  assert.deepEqual(failed.participants, populated.participants)
})
