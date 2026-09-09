import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getWorkoutSets,
  normalizeWorkout,
  formatWorkoutSets,
  MAX_WORKOUT_SETS,
} from './workoutSets.js'
import { validateWorkout } from './validators.js'
import {
  calculateVolume,
  getExerciseIndicators,
  groupVolumeByDate,
  buildLoadHistory,
} from './calculations.js'

const legacy = { exerciseId: 'squat', weight: 30, sets: 3, reps: 12, date: '2025-01-01' }
const mixed = {
  exerciseId: 'squat',
  setDetails: [
    { weight: 40, reps: 8 },
    { weight: 35.25, reps: 10 },
    { weight: 0, reps: 12 },
  ],
  date: '2025-01-02',
}

test('legacy reading creates independent sets and preserves volume, including repetitions alias', () => {
  const result = normalizeWorkout(legacy)
  assert.equal(result.sets, 3)
  assert.deepEqual(
    result.setDetails,
    Array.from({ length: 3 }, () => ({ weight: 30, reps: 12 }))
  )
  result.setDetails[0].weight = 50
  assert.equal(result.setDetails[1].weight, 30)
  assert.equal(legacy.weight, 30)
  assert.equal(calculateVolume(legacy), 1080)
  assert.equal(calculateVolume({ ...legacy, reps: undefined, repetitions: 12 }), 1080)
  assert.deepEqual(normalizeWorkout(normalizeWorkout(mixed)), normalizeWorkout(mixed))
  assert.deepEqual(getWorkoutSets({ ...legacy, setDetails: [] }), [])
})

test('volume, charts, evolution and records use all sets in mixed histories', () => {
  assert.equal(calculateVolume(mixed), 672.5)
  const indicators = getExerciseIndicators([legacy, mixed])
  assert.equal(indicators.currentLoad, 40)
  assert.equal(indicators.previousLoad, 30)
  assert.equal(indicators.maxLoad, 40)
  assert.equal(indicators.lastVolume, 672.5)
  assert.equal(indicators.accumulatedVolume, 1752.5)
  assert.equal(indicators.evolutionPercent, (10 / 30) * 100)
  assert.equal(indicators.isPersonalRecord, true)
  assert.deepEqual(
    buildLoadHistory([mixed, legacy]).map((row) => row.weight),
    [30, 40]
  )
  assert.deepEqual(groupVolumeByDate([legacy, { ...mixed, date: legacy.date }]), [
    { date: legacy.date, volume: 1752.5 },
  ])
  assert.equal(
    getExerciseIndicators([mixed, { ...legacy, date: '2025-01-03' }]).isPersonalRecord,
    false
  )
  assert.match(formatWorkoutSets(mixed), /Série 2: 35,25 kg × 10 reps/)
})

test('validation accepts zero load, decimal loads and numeric form strings', () => {
  assert.deepEqual(validateWorkout(mixed), {})
  assert.deepEqual(validateWorkout({ ...mixed, setDetails: [{ weight: '0', reps: '1' }] }), {})
  assert.deepEqual(
    validateWorkout({
      ...mixed,
      setDetails: Array.from({ length: MAX_WORKOUT_SETS }, () => ({ weight: 1, reps: 1 })),
    }),
    {}
  )
})

test('validation rejects every malformed set, even after valid ones', () => {
  for (const invalid of ['', ' ', undefined, null, NaN, Infinity, -1, 'abc', true, [], {}]) {
    for (const field of ['weight', 'reps']) {
      const errors = validateWorkout({
        ...mixed,
        setDetails: [...mixed.setDetails, { weight: 1, reps: 1, [field]: invalid }],
      })
      assert.ok(errors.set3, `${field}: ${String(invalid)}`)
    }
  }
  for (const set of [
    null,
    { weight: 1, reps: 0 },
    { weight: 1, reps: 1.5 },
    { weight: 10001, reps: 1 },
    { weight: 1, reps: 100001 },
  ]) {
    assert.ok(validateWorkout({ ...mixed, setDetails: [set] }).set0)
  }
  for (const setDetails of [
    [],
    undefined,
    3,
    Array.from({ length: MAX_WORKOUT_SETS + 1 }, () => ({ weight: 1, reps: 1 })),
  ]) {
    assert.ok(validateWorkout({ ...mixed, setDetails }).setDetails)
  }
  for (const date of ['', 'invalid', '2025-02-30', '9999-01-01'])
    assert.ok(validateWorkout({ ...mixed, date }).date)
  assert.ok(validateWorkout({ ...mixed, note: 'a'.repeat(301) }).note)
})
