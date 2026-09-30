import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  validateBirthDate,
  validateSexo,
  validateUsageProfile,
  validateExercise,
  validateWorkout,
  validateBodyMeasurement,
  validateCommunity,
  validateTextStatus,
  validatePollStatus,
  validateWorkoutStatus,
  validatePhotoStatus,
  validateSponsoredAd,
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

test('validateUsageProfile accepts only the three declared options, unlike validateSexo it never allows null/undefined', () => {
  assert.equal(hasErrors(validateUsageProfile('common')), false)
  assert.equal(hasErrors(validateUsageProfile('professional')), false)
  assert.equal(hasErrors(validateUsageProfile('establishment_owner')), false)
  assert.equal(hasErrors(validateUsageProfile(null)), true)
  assert.equal(hasErrors(validateUsageProfile(undefined)), true)
  assert.equal(hasErrors(validateUsageProfile('')), true)
  assert.equal(hasErrors(validateUsageProfile('superadmin')), true)
})

test('validateExercise requires name and muscleGroup, and bounds both lengths', () => {
  assert.equal(hasErrors(validateExercise({ name: 'Supino', muscleGroup: 'Peito' })), false)
  assert.match(validateExercise({ name: '', muscleGroup: 'Peito' }).name, /obrigatório/)
  assert.match(validateExercise({ name: 'x'.repeat(101), muscleGroup: 'Peito' }).name, /longo/)
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
  assert.equal(hasErrors(validateExercise({ name: 'x'.repeat(100), muscleGroup: 'Peito' })), false)
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
  assert.equal(
    hasErrors(
      validateExercise({
        name: 'Supino',
        muscleGroup: 'Peito',
        source: 'catalog',
        providerExerciseId: 'bench',
      })
    ),
    false
  )
  assert.match(
    validateExercise({ name: 'Supino', muscleGroup: 'Peito', source: 'catalog' }).providerExerciseId,
    /inválido/
  )
  assert.match(
    validateExercise({
      name: 'Supino',
      muscleGroup: 'Peito',
      source: 'custom',
      providerExerciseId: 'bench',
    }).providerExerciseId,
    /personalizado/
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

test('validateBodyMeasurement: every field is optional, only format/range is checked', () => {
  assert.equal(hasErrors(validateBodyMeasurement({})), false)
  assert.equal(
    hasErrors(validateBodyMeasurement({ weightKg: '', bodyFatPercent: '', note: '' })),
    false
  )
  assert.equal(
    hasErrors(validateBodyMeasurement({ heightCm: 178, weightKg: 80.5, bodyFatPercent: 18 })),
    false
  )
  assert.match(validateBodyMeasurement({ heightCm: 49 }).heightCm, /Altura/)
  assert.match(validateBodyMeasurement({ heightCm: 251 }).heightCm, /Altura/)
  assert.match(validateBodyMeasurement({ weightKg: 0 }).weightKg, /Peso/)
  assert.match(validateBodyMeasurement({ weightKg: 401 }).weightKg, /Peso/)
  assert.match(validateBodyMeasurement({ bodyFatPercent: 71 }).bodyFatPercent, /gordura/)
  assert.match(validateBodyMeasurement({ waistCm: -5 }).waistCm, /Cintura/)
  assert.match(validateBodyMeasurement({ hipCm: 'abc' }).hipCm, /Quadril/)
  assert.match(validateBodyMeasurement({ leanMassKg: 301 }).leanMassKg, /Massa magra/)
  assert.equal(hasErrors(validateBodyMeasurement({ note: 'x'.repeat(300) })), false)
  assert.match(validateBodyMeasurement({ note: 'x'.repeat(301) }).note, /300 caracteres/)
})

test('validateCommunity requires a name and only accepts an iconName from the known grid', () => {
  assert.equal(hasErrors(validateCommunity({ name: 'Academia X' })), false)
  assert.equal(hasErrors(validateCommunity({ name: 'Academia X', iconName: 'dumbbell' })), false)
  assert.match(validateCommunity({ name: '' }).name, /obrigatório/)
  assert.match(validateCommunity({ name: 'Academia X', iconName: 'not-real' }).iconName, /inválido/)
  // Comunidades de antes desse campo existir não mandam iconName nenhum — não é erro.
  assert.equal(hasErrors(validateCommunity({ name: 'Academia X', iconName: undefined })), false)
  assert.equal(
    hasErrors(validateCommunity({ name: 'Academia X', description: 'x'.repeat(300) })),
    false
  )
  assert.match(
    validateCommunity({ name: 'Academia X', description: 'x'.repeat(301) }).description,
    /longa/
  )
})

test('validateTextStatus requires text and bounds its length', () => {
  assert.match(validateTextStatus({ text: '' }).text, /Escreva algo/)
  assert.match(validateTextStatus({ text: '   ' }).text, /Escreva algo/)
  assert.equal(hasErrors(validateTextStatus({ text: 'x'.repeat(500) })), false)
  assert.match(validateTextStatus({ text: 'x'.repeat(501) }).text, /longo/)
})

test('validatePollStatus requires a question, at least 2 filled options, and bounds lengths', () => {
  assert.match(validatePollStatus({ question: '', options: ['a', 'b'] }).question, /obrigatória/)
  assert.equal(
    hasErrors(validatePollStatus({ question: 'x'.repeat(200), options: ['a', 'b'] })),
    false
  )
  assert.match(
    validatePollStatus({ question: 'x'.repeat(201), options: ['a', 'b'] }).question,
    /longa/
  )
  assert.match(validatePollStatus({ question: 'Q?', options: ['a'] }).options, /pelo menos 2/)
  assert.match(
    validatePollStatus({ question: 'Q?', options: ['a', 'x'.repeat(81)] }).options,
    /muito longa/
  )
})

test('validateWorkoutStatus requires title, date and location, and bounds text lengths', () => {
  const base = { title: 'Treino em grupo', date: '2026-01-01', location: 'Academia X' }
  assert.equal(hasErrors(validateWorkoutStatus(base)), false)
  assert.match(validateWorkoutStatus({ ...base, title: '' }).title, /obrigatório/)
  assert.equal(hasErrors(validateWorkoutStatus({ ...base, title: 'x'.repeat(100) })), false)
  assert.match(validateWorkoutStatus({ ...base, title: 'x'.repeat(101) }).title, /longo/)
  assert.match(validateWorkoutStatus({ ...base, date: '' }).date, /obrigatória/)
  assert.match(validateWorkoutStatus({ ...base, location: '' }).location, /obrigatório/)
  assert.equal(hasErrors(validateWorkoutStatus({ ...base, location: 'x'.repeat(150) })), false)
  assert.match(validateWorkoutStatus({ ...base, location: 'x'.repeat(151) }).location, /longo/)
})

test('validatePhotoStatus requires a photo and bounds caption length', () => {
  assert.match(validatePhotoStatus({ blob: null, caption: '' }).photo, /Escolha uma foto/)
  assert.equal(hasErrors(validatePhotoStatus({ blob: {}, caption: '' })), false)
  assert.equal(hasErrors(validatePhotoStatus({ blob: {}, caption: 'x'.repeat(280) })), false)
  assert.match(validatePhotoStatus({ blob: {}, caption: 'x'.repeat(281) }).caption, /longa/)
})

function baseSponsoredAd(overrides = {}) {
  return {
    partnerName: 'Academia Parceira',
    title: 'Desconto de 20% no plano anual',
    communityIds: ['comm1'],
    displayMode: ['feed'],
    ...overrides,
  }
}

test('validateSponsoredAd requires partnerName, title, communityIds and displayMode', () => {
  assert.equal(hasErrors(validateSponsoredAd(baseSponsoredAd())), false)
  assert.match(validateSponsoredAd(baseSponsoredAd({ partnerName: '' })).partnerName, /obrigatório/)
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ partnerName: 'x'.repeat(61) })).partnerName,
    /longo/
  )
  assert.match(validateSponsoredAd(baseSponsoredAd({ title: '' })).title, /obrigatório/)
  assert.match(validateSponsoredAd(baseSponsoredAd({ title: 'x'.repeat(101) })).title, /longo/)
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ communityIds: [] })).communityIds,
    /ao menos uma comunidade/
  )
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ communityIds: Array(51).fill('c') })).communityIds,
    /no máximo/
  )
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ displayMode: [] })).displayMode,
    /ao menos uma/
  )
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ displayMode: ['invalid'] })).displayMode,
    /ao menos uma/
  )
  assert.equal(
    hasErrors(validateSponsoredAd(baseSponsoredAd({ displayMode: ['feed', 'banner'] }))),
    false
  )
})

test('validateSponsoredAd: communityIds and isGlobal are orthogonal, not mutually exclusive', () => {
  // Só comunidade, sem isGlobal -- já coberto pelo teste acima (baseSponsoredAd()).
  // Só global, sem comunidade nenhuma.
  assert.equal(
    hasErrors(validateSponsoredAd(baseSponsoredAd({ communityIds: [], isGlobal: true }))),
    false
  )
  // Os dois ao mesmo tempo.
  assert.equal(
    hasErrors(validateSponsoredAd(baseSponsoredAd({ communityIds: ['comm1'], isGlobal: true }))),
    false
  )
  // Nenhum dos dois -- o único estado de fato inválido (não apareceria em lugar nenhum).
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ communityIds: [], isGlobal: false })).communityIds,
    /Home/
  )
})

test('validateSponsoredAd: description/imageUrl/ctaLabel are optional but bounded', () => {
  assert.equal(hasErrors(validateSponsoredAd(baseSponsoredAd())), false)
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ description: 'x'.repeat(501) })).description,
    /longa/
  )
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ imageUrl: 'x'.repeat(501) })).imageUrl,
    /longo/
  )
  assert.match(validateSponsoredAd(baseSponsoredAd({ ctaLabel: 'x'.repeat(31) })).ctaLabel, /longo/)
})

test('validateSponsoredAd: ctaType/ctaTarget are only required when ctaLabel is filled', () => {
  assert.equal(hasErrors(validateSponsoredAd(baseSponsoredAd())), false)
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ ctaLabel: 'Saiba mais' })).ctaType,
    /Selecione/
  )
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ ctaLabel: 'Saiba mais', ctaType: 'external' })).ctaTarget,
    /Informe o destino/
  )
  assert.equal(
    hasErrors(
      validateSponsoredAd(
        baseSponsoredAd({
          ctaLabel: 'Saiba mais',
          ctaType: 'external',
          ctaTarget: 'https://exemplo.com',
        })
      )
    ),
    false
  )
  assert.match(
    validateSponsoredAd(
      baseSponsoredAd({ ctaLabel: 'Saiba mais', ctaType: 'not-real', ctaTarget: '/x' })
    ).ctaType,
    /Selecione/
  )
})

// Achado #1 da auditoria de segurança: ctaTarget era texto livre renderizado direto
// como href, sem checagem de esquema — um valor 'javascript:...' executava no clique.
test('validateSponsoredAd: ctaTarget is restricted to a safe scheme per ctaType', () => {
  function ctaErrors(overrides) {
    return validateSponsoredAd(baseSponsoredAd({ ctaLabel: 'Saiba mais', ...overrides }))
  }

  // external: só https://, nunca http:// puro, javascript:, data: ou protocol-relative.
  assert.equal(
    hasErrors(ctaErrors({ ctaType: 'external', ctaTarget: 'https://exemplo.com' })),
    false
  )
  for (const malicious of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://exemplo.com',
    '//evil.com',
  ]) {
    assert.match(
      ctaErrors({ ctaType: 'external', ctaTarget: malicious }).ctaTarget,
      /https:\/\//,
      `deveria rejeitar: ${malicious}`
    )
  }

  // internal: uma barra só (rota relativa de verdade); nunca duas barras (URL
  // "protocol-relative") nem barra invertida (bypass de normalização de navegador).
  assert.equal(hasErrors(ctaErrors({ ctaType: 'internal', ctaTarget: '/comunidades' })), false)
  assert.equal(hasErrors(ctaErrors({ ctaType: 'internal', ctaTarget: '/' })), false)
  for (const malicious of ['//evil.com', '/\\evil.com', 'javascript:alert(1)', 'comunidades']) {
    assert.match(
      ctaErrors({ ctaType: 'internal', ctaTarget: malicious }).ctaTarget,
      /barra/,
      `deveria rejeitar: ${malicious}`
    )
  }
})

test('validateSponsoredAd: expiresAt is optional but must be a parseable date when given', () => {
  assert.equal(hasErrors(validateSponsoredAd(baseSponsoredAd())), false)
  assert.equal(hasErrors(validateSponsoredAd(baseSponsoredAd({ expiresAt: '2026-12-31' }))), false)
  assert.match(
    validateSponsoredAd(baseSponsoredAd({ expiresAt: 'not-a-date' })).expiresAt,
    /inválida/
  )
})
