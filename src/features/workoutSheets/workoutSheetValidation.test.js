import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EMPTY_SHEET,
  incompatibleTargetFields,
  normalizeSheet,
  sheetFingerprint,
  sheetScopeExercises,
  validateSheet,
  prescription,
} from './workoutSheetValidation.js'
test('category changes expose only incompatible targets and preserve personal fields', () => {
  const strengthToCardio = {
    exercise_id: 'one', exercise: { name: 'Mesa Flexora', type: 'cardio', typeMismatch: true },
    target_sets: 3, reps_min: 8, reps_max: 12, rest_seconds: 90, target_duration_minutes: 20,
    note: 'Ajuste pessoal',
  }
  assert.deepEqual(incompatibleTargetFields(strengthToCardio), ['target_sets', 'reps_min', 'reps_max'])
  assert.equal(validateSheet({ ...sheet, items: [strengthToCardio] }).field, 'target_sets')
  const resolved = { ...strengthToCardio, target_sets: null, reps_min: null, reps_max: null }
  assert.deepEqual(incompatibleTargetFields(resolved), [])
  assert.equal(validateSheet({ ...sheet, items: [resolved] }), null)
  assert.equal(resolved.rest_seconds, 90)
  assert.equal(resolved.note, 'Ajuste pessoal')
  const cardioToStrength = { ...resolved, exercise: { ...resolved.exercise, type: 'strength' }, target_distance_km: 2 }
  assert.deepEqual(incompatibleTargetFields(cardioToStrength), ['target_duration_minutes', 'target_distance_km'])
})
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
// 5.3 (auditoria 2026-11-10): o erro aponta exercício e campo, não só uma mensagem genérica --
// o editor usa exerciseId/field pra abrir a seção certa e focar o campo específico.
test('meta inválida identifica o exercício e o campo (5.3), não só uma mensagem genérica', () => {
  const twoItems = {
    ...sheet,
    items: [
      { exercise_id: 'one', exercise: { name: 'Supino' }, target_sets: 3 },
      { exercise_id: 'two', exercise: { name: 'Remada' }, target_sets: 11 },
    ],
  }
  const result = validateSheet(twoItems)
  assert.equal(result.exerciseId, 'two')
  assert.equal(result.field, 'target_sets')
  assert.match(result.message, /Remada/)
  assert.match(result.message, /séries-alvo/)

  const repsOrder = validateSheet({
    ...sheet,
    items: [{ exercise_id: 'one', exercise: { name: 'Supino' }, reps_min: 12, reps_max: 8 }],
  })
  assert.equal(repsOrder.exerciseId, 'one')
  assert.equal(repsOrder.field, 'reps_min')

  const longNote = validateSheet({
    ...sheet,
    items: [{ exercise_id: 'one', exercise: { name: 'Supino' }, note: 'n'.repeat(301) }],
  })
  assert.equal(longNote.exerciseId, 'one')
  assert.equal(longNote.field, 'note')

  // Erros que não são de um exercício específico (nome/objetivo/dias/duplicidade) não têm
  // exerciseId/field -- nada pra abrir ou focar numa meta.
  const nameError = validateSheet({ ...EMPTY_SHEET })
  assert.equal(nameError.exerciseId, undefined)
  assert.equal(nameError.field, undefined)
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
test('descanso no resumo: tempo próprio, 0 = sem descanso e valor efetivo herdado só quando informado', () => {
  const base = { exercise_id: 'one', target_sets: 3 }
  assert.equal(prescription({ ...base, rest_seconds: 90 }), '3 séries · 1min30s de descanso')
  assert.equal(
    prescription({ ...base, rest_seconds: 45 }, { defaultRestSeconds: 120 }),
    '3 séries · 45s de descanso'
  )
  assert.equal(
    prescription({ ...base, rest_seconds: 0 }, { defaultRestSeconds: 120 }),
    '3 séries · sem descanso'
  )
  // Ficha antiga (sem rest_seconds): sem a opção nada muda; com ela, mostra o padrão efetivo.
  assert.equal(prescription(base), '3 séries')
  assert.equal(
    prescription(base, { defaultRestSeconds: 60 }),
    '3 séries · 1min de descanso (seu padrão)'
  )
  assert.equal(
    prescription(base, { defaultRestSeconds: null }),
    '3 séries · 1min30s de descanso (seu padrão)'
  )
  assert.equal(
    prescription(base, { defaultRestSeconds: 0 }),
    '3 séries · sem descanso (seu padrão)'
  )
})
test('ficha antiga continua válida e rest_seconds nulo segue nulo ao salvar (herda o padrão)', () => {
  const old = { ...sheet, items: [{ exercise_id: 'one', target_sets: 3 }] }
  assert.equal(validateSheet(old), null)
  assert.equal(normalizeSheet(old).items[0].rest_seconds, null)
  assert.equal(
    normalizeSheet({ ...old, items: [{ exercise_id: 'one', rest_seconds: '' }] }).items[0]
      .rest_seconds,
    null
  )
  assert.equal(
    normalizeSheet({ ...old, items: [{ exercise_id: 'one', rest_seconds: '0' }] }).items[0]
      .rest_seconds,
    0
  )
})
