import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRowSaver } from './rowSaver.js'

const payload = (...weights) => ({
  setDetails: weights.map((weight, index) => ({ key: index, weight, reps: '10' })),
})
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup({ create, update } = {}) {
  const calls = []
  const states = []
  const saver = createRowSaver({
    createRow:
      create ||
      (async (value, options) => (calls.push(['create', options.id, value]), { synced: true })),
    updateRow:
      update || (async (id, value) => (calls.push(['update', id, value]), { synced: true })),
    onChange: (state) => states.push(state.status),
    newId: () => 'row-1',
  })
  return { saver, calls, states }
}

test('first save creates with a client id, later saves update the same row', async () => {
  const { saver, calls, states } = setup()
  await saver.save(payload('20'))
  await saver.save(payload('20', '25'))
  assert.deepEqual(
    calls.map(([kind, id]) => [kind, id]),
    [
      ['create', 'row-1'],
      ['update', 'row-1'],
    ]
  )
  assert.deepEqual(states.at(-1), 'saved')
  assert.deepEqual(saver.getState().persisted, { 0: '20|10', 1: '25|10' })
})

test('requests made during a save are coalesced into ONE follow-up with the latest state', async () => {
  let release
  const calls = []
  const { saver } = setup({
    create: (value, options) =>
      new Promise((resolve) => {
        calls.push(['create', options.id, value])
        release = () => resolve({ synced: true })
      }),
    update: async (id, value) => (calls.push(['update', id, value]), { synced: true }),
  })
  const first = saver.save(payload('20'))
  saver.save(payload('20', '22'))
  const last = saver.save(payload('20', '22', '24'))
  await tick()
  assert.equal(calls.length, 1)
  release()
  await Promise.all([first, last])
  assert.deepEqual(
    calls.map(([kind]) => kind),
    ['create', 'update']
  )
  assert.equal(calls[1][2].setDetails.length, 3)
  assert.equal(saver.getState().status, 'saved')
})

test('a failed create is retried with the SAME id; a failure never loses the pending request', async () => {
  let attempts = 0
  const ids = []
  const { saver, states } = setup({
    create: async (value, options) => {
      ids.push(options.id)
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return { synced: true }
    },
  })
  await saver.save(payload('20'))
  assert.equal(saver.getState().status, 'error')
  assert.deepEqual(saver.getState().persisted, {})
  await saver.retry()
  assert.deepEqual(ids, ['row-1', 'row-1'])
  assert.equal(saver.getState().status, 'saved')
  assert.ok(states.includes('error'))
})

test('a newer request after a failure supersedes the failed one (nothing recorded is dropped)', async () => {
  let attempts = 0
  const sent = []
  const { saver } = setup({
    create: async (value) => {
      sent.push(value.setDetails.length)
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return { synced: true }
    },
  })
  await saver.save(payload('20'))
  await saver.save(payload('20', '25'))
  assert.deepEqual(sent, [1, 2])
  assert.deepEqual(saver.getState().persisted, { 0: '20|10', 1: '25|10' })
})

test('local-only saves are reported as pending sync', async () => {
  const { saver } = setup({ create: async () => ({ synced: false, pendingSync: true }) })
  await saver.save(payload('20'))
  assert.equal(saver.getState().pendingSync, true)
  assert.equal(saver.getState().status, 'saved')
})

test('retry without a failure does nothing', async () => {
  const { saver, calls } = setup()
  await saver.retry()
  assert.equal(calls.length, 0)
})
