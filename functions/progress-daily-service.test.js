import test from 'node:test'
import assert from 'node:assert/strict'
import { createProgressDailyService, affectedWorkoutDays } from './progress-daily-service.js'

const Timestamp = { fromDate: (date) => date }
const FieldValue = { serverTimestamp: () => 'server-time' }

function createFakeDb() {
  const state = { userExists: true, deleting: false, workouts: [], summaries: new Map() }
  let tail = Promise.resolve()
  let pauseNextQuery = null
  const db = {
    state,
    doc: (path) => ({ path }),
    collection: (path) => {
      const query = {
        path,
        constraints: [],
        where(field, operator, value) {
          this.constraints.push({ field, operator, value })
          return this
        },
      }
      return query
    },
    pauseNextQuery() {
      let release
      const started = new Promise((resolve) => {
        pauseNextQuery = { started: resolve, wait: new Promise((done) => (release = done)) }
      })
      return { started, release }
    },
    runTransaction(callback) {
      const execution = tail.then(() =>
        callback({
          getAll: async (...refs) => [
            {
              exists: state.userExists,
              data: () => ({ accountStatus: state.deleting ? 'deleting' : 'active' }),
            },
            {
              exists: state.summaries.has(refs[1].path),
              data: () => state.summaries.get(refs[1].path),
            },
          ],
          get: async (query) => {
            const constraints = query.constraints
            const start = constraints.find((item) => item.operator === '>=')?.value
            const end = constraints.find((item) => item.operator === '<')?.value
            const captured = state.workouts.filter(
              (workout) => workout.date >= start && workout.date < end
            )
            if (pauseNextQuery) {
              const pause = pauseNextQuery
              pauseNextQuery = null
              pause.started()
              await pause.wait
            }
            return {
              empty: captured.length === 0,
              docs: captured.map((data) => ({ data: () => data })),
            }
          },
          set: (ref, value) => state.summaries.set(ref.path, structuredClone(value)),
          delete: (ref) => state.summaries.delete(ref.path),
        })
      )
      tail = execution.catch(() => {})
      return execution
    },
  }
  return db
}

function strength(id, weight = 10, reps = 10) {
  return {
    exerciseId: id,
    type: 'strength',
    date: new Date('2026-09-16T15:00:00Z'),
    setDetails: [{ weight, reps }],
  }
}

test('concurrent creates converge even when the first query captured an older state', async () => {
  const db = createFakeDb()
  const rebuild = createProgressDailyService({ db, Timestamp, FieldValue })
  db.state.workouts.push(strength('a'))
  const gate = db.pauseNextQuery()
  const first = rebuild('owner', '2026-09-16')
  await gate.started
  db.state.workouts.push(strength('b', 20, 5))
  const second = rebuild('owner', '2026-09-16')
  gate.release()
  await Promise.all([first, second])
  const summary = db.state.summaries.get('users/owner/progressDaily/2026-09-16')
  assert.equal(summary.workoutCount, 2)
  assert.equal(summary.strengthVolumeKg, 200)
  assert.equal(summary.strengthSets, 2)
  assert.equal(summary.strengthReps, 15)
  assert.equal(summary.active, true)
})

test('update, retry, out-of-order event and delete always reflect current workouts', async () => {
  const db = createFakeDb()
  const rebuild = createProgressDailyService({ db, Timestamp, FieldValue })
  db.state.workouts = [
    strength('a', 10, 10),
    { ...strength('b'), type: 'cardio', setDetails: undefined, durationMinutes: 20, distanceKm: 3 },
  ]
  await rebuild('owner', '2026-09-16')
  db.state.workouts[0] = strength('a', 20, 10)
  await Promise.all([rebuild('owner', '2026-09-16'), rebuild('owner', '2026-09-16')])
  let summary = db.state.summaries.get('users/owner/progressDaily/2026-09-16')
  assert.equal(summary.strengthVolumeKg, 200)
  assert.equal(summary.cardioMinutes, 20)
  assert.equal(summary.cardioDistanceKm, 3)

  db.state.workouts = []
  await rebuild('owner', '2026-09-16')
  assert.equal(db.state.summaries.has('users/owner/progressDaily/2026-09-16'), false)
})

test('date changes rebuild both days once and account deletion cannot recreate summaries', async () => {
  const before = { date: new Date('2026-09-15T15:00:00Z') }
  const after = { date: new Date('2026-09-16T15:00:00Z') }
  assert.deepEqual(affectedWorkoutDays(before, after), ['2026-09-15', '2026-09-16'])
  const db = createFakeDb()
  db.state.deleting = true
  db.state.summaries.set('users/owner/progressDaily/2026-09-16', { active: true })
  const rebuild = createProgressDailyService({ db, Timestamp, FieldValue })
  await rebuild('owner', '2026-09-16')
  assert.equal(db.state.summaries.size, 0)
})
