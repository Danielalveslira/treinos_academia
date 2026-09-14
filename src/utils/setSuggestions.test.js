import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestedSets, inheritSet, parseSetInput, adjustSetValue } from './setSuggestions.js'
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

test('inheritance fills untouched next sets; historical, manually edited and completed values win', () => {
  const previous = { weight: '17.5', reps: '8' }
  assert.deepEqual(inheritSet({ key: 2, source: 'empty' }, previous, false), {
    ...previous,
    key: 2,
    source: 'inherited',
  })
  for (const source of ['history', 'manual']) {
    const target = { weight: '', reps: '6', source }
    assert.equal(inheritSet(target, previous, false), target)
  }
  const completed = { weight: '5', reps: '12' }
  assert.equal(inheritSet(completed, previous, true), completed)
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

test('quick adjustments respect decimal arithmetic, zero and upper boundaries', () => {
  assert.equal(adjustSetValue('weight', '17.5', 1.25), '18.75')
  assert.equal(adjustSetValue('weight', '0', -2.5), '0')
  assert.equal(adjustSetValue('weight', '9999', 2.5), '10000')
  assert.equal(adjustSetValue('reps', '8', 1), '9')
  assert.equal(adjustSetValue('reps', '1', -1), '1')
  assert.equal(adjustSetValue('reps', '100000', 1), '100000')
  assert.equal(adjustSetValue('reps', '', 1), '1')
})
