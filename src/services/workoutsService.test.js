import { Buffer } from 'node:buffer'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'

async function service() {
  const { outputFiles } = await build({
    entryPoints: ['src/services/workoutsService.js'],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'firestore-fixture',
        setup(build) {
          build.onResolve({ filter: /firebase\/firestore|firebase\/config$/ }, (args) => ({
            path: args.path,
            namespace: 'fixture',
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({
            contents: path.endsWith('config')
              ? 'export const db = {}'
              : `
          export const collection = (...args) => args
          export const doc = (...args) => args
          export const addDoc = async (ref, data) => ({ ref, data })
          export const updateDoc = addDoc
          export const deleteDoc = async (ref) => ref
          export const deleteField = () => 'DELETE_FIELD'
          export const query = (...args) => args
          export const orderBy = (...args) => args
          export const where = (...args) => args
          export const limit = (...args) => args
          export const startAfter = (...args) => args
          export const serverTimestamp = () => 'SERVER_TIMESTAMP'
          export const Timestamp = { fromDate: (date) => date }
          export const count = () => 'count'
          export const sum = (field) => field
          export const getAggregateFromServer = async () => ({ data: () => ({ entries: 1, sets: 3 }) })
          export const getDocs = async () => ({ docs: [{ id: 'legacy', data: () => ({ exerciseId: 'squat', weight: 30, sets: 3, reps: 12 }) }] })
        `,
          }))
        },
      },
    ],
  })
  return import(
    `data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`
  )
}

test('create and edit persist ordered numeric sets and a derived aggregate count, stripping UI and legacy fields', async () => {
  const api = await service()
  const workout = {
    exerciseId: 'squat',
    date: '2025-01-01',
    note: ' test ',
    weight: 999,
    reps: 99,
    sets: 99,
    setDetails: [
      { key: 4, weight: '30.25', reps: '8' },
      { key: 2, weight: '0', reps: '12' },
    ],
  }
  const { data } = await api.createWorkout('owner', workout)
  assert.deepEqual(data.setDetails, [
    { weight: 30.25, reps: 8 },
    { weight: 0, reps: 12 },
  ])
  assert.equal(data.sets, 2)
  assert.equal(data.note, 'test')
  assert.ok(data.date instanceof Date)
  assert.equal(data.weight, undefined)
  assert.equal(data.reps, undefined)
  const edit = await api.updateWorkout('owner', 'existing', workout)
  assert.equal(edit.data.weight, 'DELETE_FIELD')
  assert.equal(edit.data.reps, 'DELETE_FIELD')
  assert.equal(edit.data.repetitions, 'DELETE_FIELD')
  assert.deepEqual(edit.data.setDetails, data.setDetails)
  for (const setDetails of [[], [{ weight: -1, reps: 8 }], [{ weight: NaN, reps: 8 }]]) {
    assert.throws(() => api.createWorkout('owner', { ...workout, setDetails }))
    assert.throws(() => api.updateWorkout('owner', 'existing', { ...workout, setDetails }))
  }
})

test('all workout read paths normalize legacy records while retaining snapshot cursors', async () => {
  const api = await service()
  const page = await api.listWorkoutsPage('owner', { pageSize: 1 })
  assert.equal(page.nextCursor.id, 'legacy')
  assert.equal(typeof page.nextCursor.data, 'function')
  const exercise = await api.listWorkoutsForExercise('owner', 'squat')
  const dashboard = await api.listDashboardWorkouts('owner')
  for (const record of [page.items[0], exercise[0], dashboard[0]]) {
    assert.equal(record.sets, 3)
    assert.deepEqual(record.setDetails, Array(3).fill({ weight: 30, reps: 12 }))
  }
})
