import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateAge } from './age.js'
import { validateBirthDate } from './validators.js'
import {
  MINIMUM_AGE_MESSAGE,
  MINIMUM_REGISTRATION_AGE,
  registrationMinimumAge,
} from '../constants/accountAge.js'

// Instantes explícitos: o resultado não pode depender do fuso do aparelho (TZ do processo).
const SP_NOON = new Date('2026-09-10T15:00:00Z') // 10/09/2026 12:00 em Brasília

test('calculateAge counts full years, only crediting the birthday once it has actually passed', () => {
  assert.equal(calculateAge('2000-09-10', SP_NOON), 26) // aniversário hoje
  assert.equal(calculateAge('2000-09-09', SP_NOON), 26) // ontem
  assert.equal(calculateAge('2000-09-11', SP_NOON), 25) // amanhã
  assert.equal(calculateAge('2008-01-01', SP_NOON), 18)
  assert.equal(calculateAge('2026-09-10', SP_NOON), 0) // nasceu hoje
})

test('o dia civil é o de America/Sao_Paulo, não UTC nem o do aparelho', () => {
  // 23:30 em Brasília de 09/09 já é 10/09 em UTC: ainda não é o 18º aniversário.
  const lateEvening = new Date('2026-09-10T02:30:00Z')
  assert.equal(calculateAge('2008-09-10', lateEvening), 17)
  assert.equal(calculateAge('2008-09-10', new Date('2026-09-10T03:00:00Z')), 18) // 00:00 em Brasília
})

test('29/02 completa ano em 01/03 nos anos comuns (igual a age() do PostgreSQL)', () => {
  assert.equal(calculateAge('2008-02-29', new Date('2026-02-28T15:00:00Z')), 17)
  assert.equal(calculateAge('2008-02-29', new Date('2026-03-01T15:00:00Z')), 18)
  assert.equal(calculateAge('2008-02-29', new Date('2028-02-29T15:00:00Z')), 20)
})

test('cadastro 16+: fronteira exata, data futura, inexistente e implausível', () => {
  const rules = { minimumAge: MINIMUM_REGISTRATION_AGE, now: SP_NOON }
  assert.deepEqual(validateBirthDate('2010-09-10', rules), {}, 'exatamente 16 anos: aceito')
  assert.deepEqual(validateBirthDate('1990-01-01', rules), {}, 'adulto')
  assert.equal(
    validateBirthDate('2010-09-11', rules).birthDate,
    MINIMUM_AGE_MESSAGE,
    'um dia antes: recusado'
  )
  assert.equal(validateBirthDate('2011-03-10', rules).birthDate, MINIMUM_AGE_MESSAGE, '15 anos')
  assert.equal(MINIMUM_AGE_MESSAGE, 'É necessário ter pelo menos 16 anos para se cadastrar.')
  assert.match(validateBirthDate('2026-09-11', rules).birthDate, /futuro/)
  assert.match(validateBirthDate('2004-02-30', rules).birthDate, /inválida/)
  assert.match(validateBirthDate('2003-02-29', rules).birthDate, /inválida/)
  assert.match(validateBirthDate('1890-01-01', rules).birthDate, /inválida/)
  assert.match(validateBirthDate('', rules).birthDate, /obrigatória/)
  // Virada de ano: 16 anos completos só a partir de 01/01.
  const newYearsEve = new Date('2027-01-01T02:00:00Z') // 31/12/2026 23:00 em Brasília
  assert.equal(
    validateBirthDate('2011-01-01', { ...rules, now: newYearsEve }).birthDate,
    MINIMUM_AGE_MESSAGE
  )
  assert.deepEqual(validateBirthDate('2010-12-31', { ...rules, now: newYearsEve }), {})
})

test('versão jurídica histórica não reduz a idade mínima', () => {
  assert.equal(registrationMinimumAge({ minimumAge: 12 }), 16)
  assert.equal(registrationMinimumAge(null), 16)
  assert.equal(registrationMinimumAge({ minimumAge: 21 }), 21)
  assert.equal(registrationMinimumAge({ minimumAge: 'x' }), 16)
})
