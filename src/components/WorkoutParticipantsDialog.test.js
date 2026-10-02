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

// Linha de participante: username nulo (conta sem perfil público) vira "Membro", sem quebrar o modal.
test('ParticipantRow falls back to "Membro" without a username and always links to the public profile', async () => {
  const { build } = await import('esbuild')
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createRequire } = await import('node:module')
  const dir = await mkdtemp(join(tmpdir(), 'participant-row-'))
  const outfile = join(dir, 'out.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ParticipantRow } from './WorkoutParticipantsDialog.jsx'
        export const row = (participant) => renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ParticipantRow, { participant })))
      `,
      resolveDir: new URL('./', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'fixture',
        setup(b) {
          b.onResolve({ filter: /\/services\/statusesService$/ }, (a) => ({
            path: a.path,
            namespace: 'fx',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fx' }, () => ({
            contents:
              'export const listWorkoutParticipants = async () => ({ participants: [], nextCursor: null })',
          }))
        },
      },
    ],
  })
  try {
    const { row } = createRequire(import.meta.url)(outfile)
    const named = row({ userId: 'u1', username: 'ana' })
    assert.match(named, /@ana/)
    assert.match(named, /href="\/comunidades\/perfil\/u1"/)
    const ghost = row({ userId: 'u2', username: null })
    assert.match(ghost, />Membro</)
    assert.match(ghost, /href="\/comunidades\/perfil\/u2"/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
