import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateBirthDate,
  validateSexo,
  validateExercise,
  validateWorkout,
  hasErrors,
} from './validators.js'

test('validateBirthDate requires a real calendar date, never in the future', () => {
  assert.deepEqual(validateBirthDate(''), { birthDate: 'Data de nascimento é obrigatória' })
  assert.ok(validateBirthDate('2020-02-30').birthDate) // Feb 30 does not exist
  assert.ok(validateBirthDate('not-a-date').birthDate)
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  assert.match(validateBirthDate(tomorrow).birthDate, /futuro/)
  assert.deepEqual(validateBirthDate('2000-01-01'), {})
})

test('validateBirthDate rejects implausibly old dates', () => {
  assert.ok(validateBirthDate('1850-01-01').birthDate)
})

test('validateBirthDate enforces a minimum age only when one is given', () => {
  const seventeenYearsAgo = new Date()
  seventeenYearsAgo.setFullYear(seventeenYearsAgo.getFullYear() - 17)
  const dateString = seventeenYearsAgo.toISOString().slice(0, 10)

  assert.match(validateBirthDate(dateString, { minimumAge: 18 }).birthDate, /pelo menos 18/)
  assert.deepEqual(validateBirthDate(dateString, { minimumAge: undefined }), {})
  assert.deepEqual(validateBirthDate(dateString), {})
})

test('validateSexo accepts the three known options, null/undefined, and rejects anything else', () => {
  assert.equal(hasErrors(validateSexo('masculino')), false)
  assert.equal(hasErrors(validateSexo('feminino')), false)
  assert.equal(hasErrors(validateSexo('nao_informar')), false)
  assert.equal(hasErrors(validateSexo(null)), false)
  assert.equal(hasErrors(validateSexo(undefined)), false)
  assert.equal(hasErrors(validateSexo('outro-valor-qualquer')), true)
})

test('validateExercise requires name and muscleGroup, and bounds both lengths', () => {
  assert.equal(hasErrors(validateExercise({ name: 'Supino', muscleGroup: 'Peito' })), false)
  assert.match(validateExercise({ name: '', muscleGroup: 'Peito' }).name, /obrigatório/)
  assert.match(validateExercise({ name: 'x'.repeat(61), muscleGroup: 'Peito' }).name, /longo/)
  assert.match(validateExercise({ name: 'Supino', muscleGroup: '' }).muscleGroup, /obrigatório/)
  assert.match(validateExercise({ name: 'Supino', muscleGroup: '   ' }).muscleGroup, /obrigatório/)
  // Grupo personalizado (digitado no formulário, não escolhido de uma lista fixa) —
  // mesmo teto aplicado nas firestore.rules (isValidExercise), pra nunca aceitar no
  // cliente o que o servidor recusaria.
  assert.match(
    validateExercise({ name: 'Supino', muscleGroup: 'x'.repeat(31) }).muscleGroup,
    /longo/
  )
  assert.equal(hasErrors(validateExercise({ name: 'Supino', muscleGroup: 'x'.repeat(30) })), false)
  // type é opcional (exercícios de antes deste campo existir não o têm) e só aceita os
  // dois valores conhecidos quando presente.
  assert.equal(hasErrors(validateExercise({ name: 'Supino', muscleGroup: 'Peito' })), false)
  assert.equal(
    hasErrors(validateExercise({ name: 'Supino', muscleGroup: 'Peito', type: 'cardio' })),
    false
  )
  assert.match(
    validateExercise({ name: 'Supino', muscleGroup: 'Peito', type: 'yoga' }).type,
    /inválido/
  )
})

test('validateWorkout branches by type: strength needs setDetails, cardio needs duration', () => {
  const base = { exerciseId: 'squat', date: '2026-01-01' }
  // Sem type (default 'strength'), continua exigindo setDetails como sempre.
  assert.match(validateWorkout(base).setDetails, /séries/)
  assert.equal(
    hasErrors(validateWorkout({ ...base, setDetails: [{ weight: 10, reps: 5 }] })),
    false
  )
  // Cardio não exige (nem aceita relevância a) setDetails — exige duração.
  assert.match(validateWorkout({ ...base, type: 'cardio' }).durationMinutes, /duração/)
  assert.equal(hasErrors(validateWorkout({ ...base, type: 'cardio', durationMinutes: 30 })), false)
  assert.equal(
    hasErrors(validateWorkout({ ...base, type: 'cardio', durationMinutes: 30, distanceKm: 5.2 })),
    false
  )
  assert.match(
    validateWorkout({ ...base, type: 'cardio', durationMinutes: 0 }).durationMinutes,
    /duração/
  )
  // exerciseId, data e nota continuam validados igual, independente do tipo.
  assert.match(
    validateWorkout({ type: 'cardio', durationMinutes: 30, date: '2026-01-01' }).exerciseId,
    /Selecione/
  )
})
