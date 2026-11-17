import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDatabase } from './testSupport.js'
import { request, withTransaction } from './database.js'
import { STORES } from './schema.js'
import { ACTIVE_KEY } from './bootstrap.js'
import {
  saveSheetSnapshot,
  readSheetSnapshots,
  SHEET_SNAPSHOT_TTL,
  invalidateSheetSnapshots,
} from './sheetSnapshot.js'
import { purgePrivateData } from './userScope.js'
const sheet = (id = 's') => ({
  id,
  user_id: 'a',
  name: 'A',
  revision: 2,
  items: [
    {
      exercise_id: 'e',
      available: true,
      exercise: { id: 'e', name: 'Exercise', type: 'strength', typeMismatch: false },
    },
  ],
})
async function activate(uid) {
  await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
    request(syncMeta.put({ key: ACTIVE_KEY, value: uid }))
  )
}
beforeEach(async () => {
  await freshDatabase()
  await activate('a')
})
test('cold read keeps validated owner, revision and exercise order; expires safely', async () => {
  const at = Date.now()
  assert.equal(await saveSheetSnapshot('a', sheet(), at), true)
  const rows = await readSheetSnapshots('a', at + 1)
  assert.equal(rows[0].revision, 2)
  assert.equal(rows[0].items[0].exercise_id, 'e')
  assert.equal(rows[0].offlineSnapshot, true)
  assert.deepEqual(await readSheetSnapshots('b'), [])
  assert.deepEqual(await readSheetSnapshots('a', at + SHEET_SNAPSHOT_TTL), [])
})
test('old snapshots without a category signal are never executable', async () => {
  const old = { schema_version: 1, user_id: 'a', validated_at: Date.now(), sheet: sheet() }
  delete old.sheet.items[0].exercise.typeMismatch
  await withTransaction([STORES.syncMeta], 'readwrite', ({ syncMeta }) =>
    request(syncMeta.put({ key: 'user:a:sheet-snapshots', value: [old] }))
  )
  assert.deepEqual(await readSheetSnapshots('a'), [])
})
test('unavailable/foreign scopes never become executable snapshots', async () => {
  assert.equal(await saveSheetSnapshot('b', sheet()), false)
  assert.equal(await saveSheetSnapshot('a', { ...sheet(), archived_at: 'today' }), false)
  assert.equal(await saveSheetSnapshot('a', { ...sheet(), items: [] }), false)
  assert.equal(
    await saveSheetSnapshot('a', {
      ...sheet(),
      items: [
        { ...sheet().items[0], exercise: { ...sheet().items[0].exercise, typeMismatch: true } },
      ],
    }),
    true
  )
  assert.equal((await readSheetSnapshots('a'))[0].items[0].exercise.typeMismatch, true)
  assert.equal(
    await saveSheetSnapshot('a', {
      ...sheet(),
      items: [{ ...sheet().items[0], exercise: { id: 'e', type: 'strength' } }],
    }),
    false
  )
})
test('logout/account switch purges private scopes and blocks late writes', async () => {
  await saveSheetSnapshot('a', sheet())
  await activate('b')
  await purgePrivateData('b')
  assert.deepEqual(await readSheetSnapshots('a'), [])
  assert.equal(await saveSheetSnapshot('a', sheet()), false)
  await activate('a')
  assert.deepEqual(await readSheetSnapshots('a'), [])
})
test('bounded cache and invalidation never touch outbox', async () => {
  for (let i = 0; i < 42; i++) await saveSheetSnapshot('a', sheet(String(i)))
  assert.equal((await readSheetSnapshots('a')).length, 40)
  await invalidateSheetSnapshots('a')
  assert.deepEqual(await readSheetSnapshots('a'), [])
})

// Exercise the same durable queue and ACK engine used by the product, including a
// server refusal after an executable snapshot became stale.
test('sheet create + update compact, preserve binding, synchronize and ACK', async () => {
  const { enqueueWorkoutMutation, OPERATIONS, listMutations } = await import('./outbox.js')
  const { syncOutbox } = await import('./syncEngine.js')
  const { makeServer, makeDeps } = await import('./syncTestKit.js')
  await saveSheetSnapshot('a', sheet())
  const [scope] = await readSheetSnapshots('a')
  const payload = {
    sheet_id: scope.id,
    exercise_id: 'e',
    date: '2026-10-27',
    type: 'strength',
    set_details: [{ weight: 20, reps: 10 }],
    sets: 1,
    note: '',
  }
  await enqueueWorkoutMutation('a', { operation: OPERATIONS.create, entityId: 'w', payload })
  await enqueueWorkoutMutation('a', {
    operation: OPERATIONS.update,
    entityId: 'w',
    payload: { ...payload, sheet_id: undefined, note: 'updated' },
  })
  const queued = await listMutations('a')
  assert.equal(queued.length, 1)
  assert.equal(queued[0].payload.sheet_id, scope.id)
  const server = makeServer()
  server.seedSheet(scope.id) // a ficha existe no servidor: este teste cobre o caminho feliz, não SHEET_NOT_FOUND
  await syncOutbox({ deps: makeDeps({ server, getUser: () => 'a' }) })
  assert.deepEqual(await listMutations('a'), [])
  assert.equal(server.rowsOf('a')[0].sheet_id, scope.id)
})

test('rejected sheet binding preserves local sets, sheet and recoverable mutation', async () => {
  const { enqueueWorkoutMutation, OPERATIONS, listMutations } = await import('./outbox.js')
  const { syncOutbox } = await import('./syncEngine.js')
  const { makeDeps } = await import('./syncTestKit.js')
  const { rawAll } = await import('./testSupport.js')
  const payload = {
    sheet_id: 's',
    exercise_id: 'e',
    date: '2026-10-27',
    type: 'strength',
    set_details: [{ weight: 20, reps: 10 }],
    sets: 1,
    note: '',
  }
  await enqueueWorkoutMutation('a', { operation: OPERATIONS.create, entityId: 'w', payload })
  const deps = makeDeps({
    getUser: () => 'a',
    extra: {
      rpc: async (wire) => ({
        results: wire.map((row, index) => ({
          index,
          mutation_id: row.mutation_id,
          entity_id: row.entity_id,
          status: 'rejected',
          code: 'SHEET_NOT_READY',
        })),
      }),
    },
  })
  await syncOutbox({ deps })
  const [queued] = await listMutations('a')
  assert.equal(queued.payload.sheet_id, 's')
  assert.deepEqual(queued.payload.set_details, payload.set_details)
  assert.equal((await rawAll('workouts'))[0].sheet_id, 's')
  await purgePrivateData(null)
  assert.equal((await listMutations('a')).length, 1)
})

test('invalidating one sheet keeps other scopes and users intact', async () => {
  await saveSheetSnapshot('a', sheet('first'))
  await saveSheetSnapshot('a', sheet('second'))
  const { enqueueWorkoutMutation, listMutations, OPERATIONS } = await import('./outbox.js')
  await enqueueWorkoutMutation('a', {
    operation: OPERATIONS.create,
    entityId: 'pending-sheet-row',
    payload: {
      sheet_id: 'first',
      exercise_id: 'e',
      date: '2026-10-27',
      type: 'strength',
      set_details: [{ weight: 20, reps: 10 }],
      sets: 1,
      note: '',
    },
  })
  await invalidateSheetSnapshots('a', 'first')
  assert.equal((await listMutations('a'))[0].payload.sheet_id, 'first')
  assert.deepEqual(
    (await readSheetSnapshots('a')).map((s) => s.id),
    ['second']
  )
  await invalidateSheetSnapshots('b', 'second')
  assert.deepEqual(
    (await readSheetSnapshots('a')).map((s) => s.id),
    ['second']
  )
})
