import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_SHEET,
  normalizeSheet,
  sheetFingerprint,
  sheetScopeExercises,
  validateSheet,
  prescription,
} from './workoutSheetValidation.js'
const sheet = {
  ...EMPTY_SHEET,
  name: 'Treino A',
  items: [{ exercise_id: 'one', target_sets: 3, reps_min: 8, reps_max: 12 }],
}
test('dirty normaliza valores, ignora estado de apresentação e volta ao original', () => {
  assert.equal(
    sheetFingerprint(sheet),
    sheetFingerprint({
      ...sheet,
      name: ' Treino A ',
      revision: 5,
      items: [
        { ...sheet.items[0], id: 'stable', available: false, sort_order: 9, target_sets: '3' },
      ],
    })
  )
  assert.notEqual(sheetFingerprint(sheet), sheetFingerprint({ ...sheet, name: 'B' }))
  assert.equal(sheetFingerprint(sheet), sheetFingerprint({ ...sheet, name: 'Treino A' }))
})
test('rascunho permitido, limites e números rejeitados antes do envio', () => {
  assert.equal(validateSheet({ ...EMPTY_SHEET, name: 'Rascunho' }), null)
  assert.ok(validateSheet(EMPTY_SHEET))
  assert.ok(validateSheet({ ...sheet, name: 'a'.repeat(81) }))
  for (const patch of [
    { target_sets: 11 },
    { reps_min: 13 },
    { rest_seconds: -1 },
    { target_duration_minutes: 601 },
    { target_distance_km: 501 },
    { target_sets: 'NaN' },
    { target_sets: 1.5 },
    { note: 'n'.repeat(301) },
  ])
    assert.ok(validateSheet({ ...sheet, items: [{ ...sheet.items[0], ...patch }] }))
  assert.ok(validateSheet({ ...sheet, weekdays: [1, 1] }))
  assert.ok(validateSheet({ ...sheet, items: [...sheet.items, ...sheet.items] }))
  assert.ok(
    validateSheet({
      ...sheet,
      items: Array.from({ length: 41 }, (_, i) => ({ exercise_id: String(i) })),
    })
  )
  assert.deepEqual(normalizeSheet({ ...sheet, weekdays: [6, 0] }).weekdays, [0, 6])
})
test('escopo mantém ordem própria, bloqueia indisponíveis e não modifica biblioteca', () => {
  const library = [{ id: 'one' }, { id: 'two' }, { id: 'three' }]
  const scope = {
    items: [
      { exercise_id: 'two' },
      { exercise_id: 'one' },
      { exercise_id: 'three', available: false },
    ],
  }
  assert.deepEqual(sheetScopeExercises(library, scope), [library[1], library[0]])
  assert.equal(sheetScopeExercises(library, null), library)
  assert.equal(library.length, 3)
  assert.match(prescription(sheet.items[0]), /3 séries/)
  assert.ok(!prescription(sheet.items[0]).includes('conclu'))
})
