import test from 'node:test'
import assert from 'node:assert/strict'
import { parseBackfillArgs, runProgressDailyBackfill } from './progress-daily-backfill-core.mjs'

const workouts = [
  {
    exerciseId: 'squat',
    type: 'strength',
    date: new Date('2026-09-15T15:00:00Z'),
    setDetails: [{ weight: 50, reps: 10 }],
  },
  {
    exerciseId: 'push-up',
    type: 'strength',
    date: new Date('2026-09-16T15:00:00Z'),
    setDetails: [{ weight: 0, reps: 12 }],
  },
  {
    exerciseId: 'run',
    type: 'cardio',
    date: new Date('2026-09-16T15:00:00Z'),
    durationMinutes: 30,
    distanceKm: 5,
  },
]

function fixture() {
  const stored = new Map([['2026-01-01', { stale: true }]])
  let writeCalls = 0
  const dependencies = {
    loadUser: async (uid) => uid === 'owner01',
    loadWorkouts: async () => structuredClone(workouts),
    loadExistingDayIds: async () => [...stored.keys()],
    applyPlan: async (_uid, plan, stale) => {
      writeCalls += 1
      for (const day of stale) stored.delete(day)
      for (const day of plan) stored.set(day.dateKey, structuredClone(day))
      return { written: plan.length, deleted: stale.length, failed: 0 }
    },
  }
  return { stored, dependencies, getWriteCalls: () => writeCalls }
}

test('arguments require one explicit valid user and apply is opt-in', () => {
  assert.deepEqual(parseBackfillArgs(['--user', 'owner01']), { uid: 'owner01', apply: false })
  assert.deepEqual(parseBackfillArgs(['--apply', '--user', 'owner01']), {
    uid: 'owner01',
    apply: true,
  })
  assert.throws(() => parseBackfillArgs([]))
  assert.throws(() => parseBackfillArgs(['--user', 'owner01', 'unexpected']))
  assert.throws(() => parseBackfillArgs(['--user', 'owner01', '--user', 'other01']))
})

test('repeated dry-runs never write and report the same plan', async () => {
  const context = fixture()
  const first = await runProgressDailyBackfill({
    uid: 'owner01',
    apply: false,
    ...context.dependencies,
  })
  const second = await runProgressDailyBackfill({
    uid: 'owner01',
    apply: false,
    ...context.dependencies,
  })
  assert.deepEqual(first, second)
  assert.equal(context.getWriteCalls(), 0)
  assert.equal(context.stored.has('2026-01-01'), true)
})

test('apply replaces totals, removes stale days and is idempotent', async () => {
  const context = fixture()
  const first = await runProgressDailyBackfill({
    uid: 'owner01',
    apply: true,
    ...context.dependencies,
  })
  const snapshot = structuredClone([...context.stored.entries()])
  const second = await runProgressDailyBackfill({
    uid: 'owner01',
    apply: true,
    ...context.dependencies,
  })
  assert.equal(first.failed, 0)
  assert.equal(second.failed, 0)
  assert.deepEqual([...context.stored.entries()], snapshot)
  assert.equal(context.stored.has('2026-01-01'), false)
  assert.deepEqual(context.stored.get('2026-09-16'), {
    dateKey: '2026-09-16',
    workoutCount: 2,
    strengthVolumeKg: 0,
    strengthSets: 1,
    strengthReps: 12,
    cardioMinutes: 30,
    cardioDistanceKm: 5,
    active: true,
    exerciseStats: [
      {
        exerciseId: 'push-up',
        workoutCount: 1,
        strengthVolumeKg: 0,
        strengthSets: 1,
        strengthReps: 12,
        cardioMinutes: 0,
        cardioDistanceKm: 0,
      },
      {
        exerciseId: 'run',
        workoutCount: 1,
        strengthVolumeKg: 0,
        strengthSets: 0,
        strengthReps: 0,
        cardioMinutes: 30,
        cardioDistanceKm: 5,
      },
    ],
  })
})

test('wrong users and partial write errors are reported', async () => {
  const context = fixture()
  await assert.rejects(
    () => runProgressDailyBackfill({ uid: 'other01', apply: false, ...context.dependencies }),
    /não encontrado/
  )
  await assert.rejects(
    () =>
      runProgressDailyBackfill({
        uid: 'owner01',
        apply: true,
        ...context.dependencies,
        applyPlan: async () => ({ written: 1, deleted: 0, failed: 1 }),
      }),
    /Backfill incompleto/
  )
})
