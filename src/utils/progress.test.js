import test from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateMuscleGroups,
  aggregateProgress,
  buildProgressChart,
  buildProgressComparisonChart,
  buildStrengthWeeklySeries,
  getProgressPeriod,
  getStrengthExerciseIds,
  percentChange,
  summarizeExerciseStrength,
} from './progress.js'

const day = (dateKey, overrides = {}) => ({
  dateKey,
  workoutCount: 1,
  strengthVolumeKg: 100,
  strengthSets: 3,
  strengthReps: 30,
  cardioMinutes: 0,
  cardioDistanceKm: 0,
  exerciseStats: [
    { exerciseId: 'squat', strengthVolumeKg: 100, strengthSets: 3, strengthReps: 30 },
  ],
  ...overrides,
})

test('builds equivalent rolling week ranges', () => {
  const range = getProgressPeriod('week', new Date(2026, 8, 16, 18))
  assert.equal(range.start.toDateString(), new Date(2026, 8, 10).toDateString())
  assert.equal(range.previousStart.toDateString(), new Date(2026, 8, 3).toDateString())
  assert.equal(range.previousEnd.toDateString(), new Date(2026, 8, 9).toDateString())
})

test('compares calendar periods from their own starts', () => {
  const month = getProgressPeriod('month', new Date(2026, 8, 16, 18))
  assert.equal(month.previousStart.toDateString(), new Date(2026, 7, 1).toDateString())
  assert.equal(month.previousEnd.toDateString(), new Date(2026, 7, 16).toDateString())
  const year = getProgressPeriod('year', new Date(2026, 8, 16, 18))
  assert.equal(year.previousStart.toDateString(), new Date(2025, 0, 1).toDateString())
  assert.equal(year.previousEnd.toDateString(), new Date(2025, 8, 16).toDateString())
})

test('aggregates all general indicators without estimating bodyweight volume', () => {
  const result = aggregateProgress([
    day('2026-09-15'),
    day('2026-09-16', {
      strengthVolumeKg: 0,
      strengthSets: 4,
      strengthReps: 40,
      cardioMinutes: 20,
      cardioDistanceKm: 3.2,
      exerciseStats: [{ exerciseId: 'push-up', exerciseName: 'Flexão' }],
    }),
  ])
  assert.deepEqual(result, {
    trainingDays: 2,
    workoutCount: 2,
    volumeKg: 100,
    sets: 7,
    reps: 70,
    cardioMinutes: 20,
    cardioDistanceKm: 3.2,
    averageVolumePerWorkout: 50,
    averageVolumePerActiveDay: 50,
    distinctExercises: 2,
  })
})

test('comparison chart aligns equivalent periods and exposes no invented values', () => {
  const range = getProgressPeriod('week', new Date(2026, 8, 16, 12))
  const result = buildProgressComparisonChart(
    [day('2026-09-16', { strengthSets: 4 })],
    [day('2026-09-09', { strengthSets: 2 })],
    'week',
    'strengthSets',
    range
  )
  assert.equal(result.at(-1).currentValue, 4)
  assert.equal(result.at(-1).previousValue, 2)
})

test('strength summary never mixes exercises and tolerates legacy summaries without force fields', () => {
  const days = [
    day('2026-09-10', {
      exerciseStats: [
        {
          exerciseId: 'bench',
          strengthSets: 3,
          strengthReps: 24,
          maxWeightKg: 80,
          repsAtMaxWeight: 8,
          bestSetVolumeKg: 640,
          estimated1RMKg: 101.3,
        },
        { exerciseId: 'squat', strengthSets: 2, maxWeightKg: 120 },
      ],
    }),
    day('2026-09-16', {
      exerciseStats: [
        { exerciseId: 'bench', strengthSets: 2, strengthReps: 10, maxWeightKg: 85, repsAtMaxWeight: 5 },
        { exerciseId: 'legacy', strengthSets: 1, strengthReps: 10 },
      ],
    }),
  ]
  assert.deepEqual(getStrengthExerciseIds(days).sort(), ['bench', 'legacy', 'squat'])
  assert.deepEqual(summarizeExerciseStrength(days, 'bench'), {
    bestWeightKg: 85,
    reps: 5,
    bestSetVolumeKg: 640,
    estimated1RMKg: 101.3,
    sets: 5,
    totalReps: 34,
    recentWeightKg: 85,
    recentReps: 5,
  })
  assert.equal(summarizeExerciseStrength(days, 'squat').bestWeightKg, 120)
  assert.equal(buildStrengthWeeklySeries(days, 'bench').length, 2)
})

test('groups quarter charts by week and muscle distribution by sets', () => {
  const days = [day('2026-09-14'), day('2026-09-16')]
  const chart = buildProgressChart(days, 'quarter', 'strengthSets', {
    start: new Date(2026, 8, 1),
    end: new Date(2026, 8, 16),
  })
  assert.equal(chart.at(-1).value, 6)
  assert.deepEqual(aggregateMuscleGroups(days, new Map([['squat', 'Pernas']])), [
    { muscleGroup: 'Pernas', sets: 6 },
  ])
})

test('returns null when percentage comparison has no baseline', () => {
  assert.equal(percentChange(10, 0), null)
  assert.equal(percentChange(0, 0), 0)
  assert.equal(percentChange(120, 100), 20)
})
