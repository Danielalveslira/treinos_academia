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
    exerciseRecords: 2,
    volumeKg: 100,
    sets: 7,
    reps: 70,
    cardioMinutes: 20,
    cardioDistanceKm: 3.2,
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
        {
          exerciseId: 'bench',
          strengthSets: 2,
          strengthReps: 10,
          maxWeightKg: 85,
          repsAtMaxWeight: 5,
        },
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

test('groups quarter charts by seven-day blocks and muscle distribution by sets', () => {
  const days = [day('2026-09-14'), day('2026-09-16')]
  const chart = buildProgressChart(days, 'quarter', 'strengthSets', {
    start: new Date(2026, 8, 1),
    end: new Date(2026, 8, 16),
  })
  assert.equal(
    chart.reduce((sum, point) => sum + point.value, 0),
    6
  )
  assert.equal(chart.at(-1).value, 3)
  assert.deepEqual(aggregateMuscleGroups(days, new Map([['squat', 'Pernas']])), [
    { muscleGroup: 'Pernas', sets: 6 },
  ])
})

test('returns null when percentage comparison has no baseline', () => {
  assert.equal(percentChange(10, 0), null)
  assert.equal(percentChange(0, 0), null)
  assert.equal(percentChange(120, 100), 20)
})

test('today counts a day once and still shows prior-only exercises', () => {
  const range = getProgressPeriod('today', new Date('2026-11-02T15:00:00Z'))
  const today = day('2026-11-02', { workoutCount: 4 })
  const prior = day('2026-11-01', { exerciseStats: [{ exerciseId: 'old', strengthSets: 2 }] })
  assert.equal(buildProgressChart([today], 'today', 'trainingDays', range)[0].value, 1)
  const comparison = buildProgressComparisonChart([], [prior], 'today', 'strengthSets', range)
  assert.equal(comparison.length, 1)
  assert.equal(comparison[0].currentValue, 0)
  assert.equal(comparison[0].previousValue, 2)
})

test('business day and calendar rollovers use Sao Paulo', () => {
  const month = getProgressPeriod('month', new Date('2027-01-01T02:30:00Z'))
  assert.equal(month.end.getDate(), 31)
  assert.equal(month.end.getMonth(), 11)
  const year = getProgressPeriod('year', new Date('2027-01-01T15:00:00Z'))
  assert.equal(year.previousStart.getFullYear(), 2026)
  assert.equal(year.previousEnd.getDate(), 1)
})

test('month chart groups days into equivalent seven-day blocks on narrow screens', () => {
  const range = getProgressPeriod('month', new Date('2026-11-23T15:00:00Z'))
  const points = buildProgressComparisonChart(
    [day('2026-11-08', { strengthSets: 4 })],
    [day('2026-10-08', { strengthSets: 2 })],
    'month',
    'strengthSets',
    range
  )
  assert.equal(points.length, 4)
  assert.equal(points[1].currentValue, 4)
  assert.equal(points[1].previousValue, 2)
  assert.equal(
    points.reduce((sum, point) => sum + point.currentValue, 0),
    4
  )
})
