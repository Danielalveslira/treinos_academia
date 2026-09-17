import test from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateOneRepMax,
  summarizeDailyWorkouts,
  workoutDateKey,
} from './progress-daily-core.js'

test('summarizes strength and cardio without estimating zero-weight volume', () => {
  const workouts = [
    { exerciseId: 'squat', type: 'strength', setDetails: [{ weight: 50, reps: 10 }] },
    { exerciseId: 'push-up', type: 'strength', setDetails: [{ weight: 0, reps: 12 }] },
    { exerciseId: 'run', type: 'cardio', durationMinutes: 30, distanceKm: 5 },
  ]
  const result = summarizeDailyWorkouts(workouts)
  assert.equal(result.strengthVolumeKg, 500)
  assert.equal(result.strengthSets, 2)
  assert.equal(result.strengthReps, 22)
  assert.equal(result.cardioMinutes, 30)
  assert.equal(result.cardioDistanceKm, 5)
  assert.deepEqual(
    result.exerciseStats.map(({ exerciseId, strengthSets }) => ({ exerciseId, strengthSets })),
    [
      { exerciseId: 'push-up', strengthSets: 1 },
      { exerciseId: 'run', strengthSets: 0 },
      { exerciseId: 'squat', strengthSets: 1 },
    ]
  )
})

test('derives per-exercise strength only from valid recorded sets', () => {
  const result = summarizeDailyWorkouts([
    {
      exerciseId: 'bench',
      setDetails: [
        { weight: 80, reps: 8 },
        { weight: 90, reps: 3 },
        { weight: 0, reps: 20 },
      ],
    },
  ])
  const strength = result.exerciseStats[0]
  assert.equal(strength.maxWeightKg, 90)
  assert.equal(strength.repsAtMaxWeight, 3)
  assert.equal(strength.bestSetVolumeKg, 640)
  assert.ok(Math.abs(strength.estimated1RMKg - estimateOneRepMax(80, 8)) < 0.001)
  assert.equal(estimateOneRepMax(100, 0), 0)
  assert.equal(estimateOneRepMax(100, 13), 0)
  assert.equal(estimateOneRepMax(0, 10), 0)
})

test('legacy aggregate strength records remain included', () => {
  const result = summarizeDailyWorkouts([
    { exerciseId: 'legacy', weight: 30, sets: 3, repetitions: 12 },
  ])
  assert.equal(result.strengthVolumeKg, 1080)
  assert.equal(result.strengthSets, 3)
  assert.equal(result.strengthReps, 36)
  assert.equal(result.exerciseStats[0].maxWeightKg, 30)
})

test('derives a stable calendar key from Firestore-like timestamps', () => {
  assert.equal(
    workoutDateKey({ date: { toDate: () => new Date('2026-09-16T15:00:00Z') } }),
    '2026-09-16'
  )
})

test('uses the Sao Paulo calendar day at the UTC midnight boundary', () => {
  assert.equal(workoutDateKey({ date: new Date('2026-09-17T01:30:00Z') }), '2026-09-16')
  assert.equal(workoutDateKey({ date: new Date('2026-09-17T03:00:00Z') }), '2026-09-17')
})
