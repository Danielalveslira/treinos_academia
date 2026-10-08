import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestedSets, parseSetInput } from './setSuggestions.js'
import { isValidSet } from './workoutSets.js'

test('history preserves the corresponding set, including legacy and zero load', () => {
  assert.deepEqual(
    suggestedSets({
      setDetails: [
        { weight: 0, reps: 12 },
        { weight: 17.5, reps: 8 },
      ],
    }).map(({ weight, reps }) => [weight, reps]),
    [
      ['0', '12'],
      ['17.5', '8'],
    ]
  )
  assert.equal(suggestedSets({ sets: 3, weight: 20, reps: 10 }).length, 3)
  assert.equal(suggestedSets({ sets: 20, weight: 20, reps: 10 }).length, 10)
})

test('missing or invalid history does not invent values', () => {
  for (const workout of [
    undefined,
    { setDetails: [] },
    { setDetails: [{ weight: -1, reps: 2 }] },
  ]) {
    assert.deepEqual(suggestedSets(workout), [{ weight: '', reps: '', source: 'empty' }])
  }
})

test('direct entry accepts comma, dot and empty drafts without NaN', () => {
  assert.equal(parseSetInput('weight', '17,5'), '17.5')
  assert.equal(parseSetInput('weight', '17.5'), '17.5')
  assert.equal(parseSetInput('weight', '0'), '0')
  assert.equal(parseSetInput('weight', ''), '')
  assert.equal(parseSetInput('weight', '17,'), '17.')
  assert.equal(parseSetInput('reps', '9'), '9')
  assert.equal(isValidSet({ weight: '', reps: '9' }), false)
  assert.equal(isValidSet({ weight: '0', reps: '0' }), false)
  for (const raw of ['NaN', 'Infinity', '-1', '1e3', 'abc', '1,2,3', '10001'])
    assert.equal(parseSetInput('weight', raw), null)
  for (const raw of ['1.5', '1,5', '-1', '100001']) assert.equal(parseSetInput('reps', raw), null)
})
