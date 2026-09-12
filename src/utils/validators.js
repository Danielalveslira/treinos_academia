import { isValidSet, MAX_WORKOUT_SETS } from './workoutSets.js'
import { calculateAge } from './age.js'
import { EXERCISE_TYPES } from './exerciseType.js'
import { isValidCardioSession, MAX_DURATION_MINUTES, MAX_DISTANCE_KM } from './cardioSessions.js'
import { COMMUNITY_ICON_NAMES } from '../constants/communityIcons.js'

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
export const SEXO_OPTIONS = ['masculino', 'feminino', 'nao_informar']
const MAX_PLAUSIBLE_AGE = 120

function requiredText(value, max, requiredMessage, maxMessage) {
  if (!value || !value.trim()) return requiredMessage
  if (value.trim().length > max) return maxMessage
  return undefined
}

function optionalText(value, max, maxMessage) {
  if (value && value.trim().length > max) return maxMessage
  return undefined
}

// Mesmo padrão de validateWorkout abaixo (formato + volta por toISOString para
// rejeitar datas de calendário inexistentes, ex.: 2025-02-30) — replicado aqui em vez
// de reaproveitado porque as duas mensagens de erro e a regra de idade mínima são
// específicas de data de nascimento.
export function validateBirthDate(dateString, { minimumAge } = {}) {
  const errors = {}
  if (!dateString) {
    errors.birthDate = 'Data de nascimento é obrigatória'
  } else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(dateString) ||
    !Number.isFinite(new Date(dateString).getTime()) ||
    new Date(dateString).toISOString().slice(0, 10) !== dateString
  ) {
    errors.birthDate = 'Data de nascimento inválida'
  } else if (dateString > new Date().toISOString().slice(0, 10)) {
    errors.birthDate = 'A data de nascimento não pode ser no futuro'
  } else if (calculateAge(dateString) > MAX_PLAUSIBLE_AGE) {
    errors.birthDate = 'Data de nascimento inválida'
  } else if (minimumAge != null && calculateAge(dateString) < minimumAge) {
    errors.birthDate = `É necessário ter pelo menos ${minimumAge} anos para se cadastrar`
  }
  return errors
}

export function validateSexo(value) {
  const errors = {}
  if (value != null && !SEXO_OPTIONS.includes(value)) errors.sexo = 'Opção inválida'
  return errors
}

export function validateUsername(rawUsername) {
  const errors = {}
  const username = (rawUsername || '').trim().toLowerCase()
  if (!username) errors.username = 'Escolha um nome de usuário'
  else if (!USERNAME_PATTERN.test(username)) {
    errors.username = 'Use de 3 a 20 letras minúsculas, números ou _ (sem espaços ou acentos)'
  }
  return errors
}

export function validateExercise({ name, muscleGroup, type }) {
  const errors = {}
  const nameError = requiredText(name, 60, 'Nome é obrigatório', 'Nome muito longo')
  if (nameError) errors.name = nameError
  const muscleGroupError = requiredText(
    muscleGroup,
    30,
    'Grupo muscular é obrigatório',
    'Nome do grupo muito longo'
  )
  if (muscleGroupError) errors.muscleGroup = muscleGroupError
  if (type != null && !EXERCISE_TYPES.includes(type)) errors.type = 'Tipo inválido'
  return errors
}

export function validateWorkout({
  exerciseId,
  type = 'strength',
  setDetails,
  durationMinutes,
  distanceKm,
  date,
  note,
}) {
  const errors = {}
  if (!exerciseId || typeof exerciseId !== 'string') errors.exerciseId = 'Selecione um exercício'
  if (type === 'cardio') {
    if (!isValidCardioSession({ durationMinutes, distanceKm })) {
      errors.durationMinutes = `Informe a duração (até ${MAX_DURATION_MINUTES} min) e, se quiser, a distância (até ${MAX_DISTANCE_KM} km)`
    }
  } else if (
    !Array.isArray(setDetails) ||
    setDetails.length < 1 ||
    setDetails.length > MAX_WORKOUT_SETS
  ) {
    errors.setDetails = `Informe de 1 a ${MAX_WORKOUT_SETS} séries válidas`
  } else {
    setDetails.forEach((set, index) => {
      if (!isValidSet(set))
        errors[`set${index}`] = 'Informe peso de 0 a 10.000 kg e repetições inteiras de 1 a 100.000'
    })
  }
  if (!date) errors.date = 'Data é obrigatória'
  else if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(new Date(date).getTime()) ||
    new Date(date).toISOString().slice(0, 10) !== date
  ) {
    errors.date = 'Data inválida'
  } else if (date > new Date().toISOString().slice(0, 10)) {
    errors.date = 'A data não pode ser no futuro'
  }
  if (note != null && (typeof note !== 'string' || note.trim().length > 300))
    errors.note = 'Use até 300 caracteres'
  return errors
}

export function hasErrors(errors) {
  return Object.keys(errors).length > 0
}

export function validateCommunity({ name, description, iconName }) {
  const errors = {}
  const nameError = requiredText(name, 60, 'Nome é obrigatório', 'Nome muito longo')
  if (nameError) errors.name = nameError
  const descriptionError = optionalText(description, 300, 'Descrição muito longa')
  if (descriptionError) errors.description = descriptionError
  // Defesa em profundidade: a grade do seletor já só oferece esses valores, e o
  // servidor recusa qualquer outro (isValidCommunity em firestore.rules) — checar aqui
  // também evita gastar uma escrita com algo que a regra vai rejeitar de qualquer jeito.
  if (iconName != null && !COMMUNITY_ICON_NAMES.includes(iconName))
    errors.iconName = 'Ícone inválido'
  return errors
}

export function validateTextStatus({ text }) {
  const errors = {}
  const textError = requiredText(text, 500, 'Escreva algo para publicar', 'Texto muito longo')
  if (textError) errors.text = textError
  return errors
}

export function validatePollStatus({ question, options }) {
  const errors = {}
  const questionError = requiredText(question, 200, 'Pergunta é obrigatória', 'Pergunta muito longa')
  if (questionError) errors.question = questionError
  const filled = options.filter((o) => o.trim())
  if (filled.length < 2) errors.options = 'Adicione pelo menos 2 opções'
  else if (filled.some((o) => o.trim().length > 80))
    errors.options = 'Uma das opções está muito longa'
  return errors
}

export function validateWorkoutStatus({ title, date, location }) {
  const errors = {}
  const titleError = requiredText(title, 100, 'Título é obrigatório', 'Título muito longo')
  if (titleError) errors.title = titleError
  if (!date) errors.date = 'Data é obrigatória'
  const locationError = requiredText(location, 150, 'Local é obrigatório', 'Local muito longo')
  if (locationError) errors.location = locationError
  return errors
}

export function validatePhotoStatus({ blob, caption }) {
  const errors = {}
  if (!blob) errors.photo = 'Escolha uma foto para publicar'
  const captionError = optionalText(caption, 280, 'Legenda muito longa')
  if (captionError) errors.caption = captionError
  return errors
}

// Tudo opcional — só valida formato/faixa plausível de quem preencheu (mesmos limites de
// isValidBodyMeasurement/isValidHeightField em firestore.rules), nunca obrigatoriedade.
export function validateBodyMeasurement({
  heightCm,
  weightKg,
  bodyFatPercent,
  waistCm,
  hipCm,
  leanMassKg,
  note,
}) {
  const errors = {}
  function inRange(value, min, max, inclusiveMin = false) {
    if (value === '' || value == null) return true
    const n = Number(value)
    if (!Number.isFinite(n)) return false
    return inclusiveMin ? n >= min && n <= max : n > min && n <= max
  }
  if (!inRange(heightCm, 50, 250, true)) errors.heightCm = 'Altura entre 50 e 250 cm'
  if (!inRange(weightKg, 0, 400)) errors.weightKg = 'Peso até 400 kg'
  if (!inRange(bodyFatPercent, 0, 70)) errors.bodyFatPercent = '% de gordura até 70'
  if (!inRange(waistCm, 0, 200)) errors.waistCm = 'Cintura até 200 cm'
  if (!inRange(hipCm, 0, 200)) errors.hipCm = 'Quadril até 200 cm'
  if (!inRange(leanMassKg, 0, 300)) errors.leanMassKg = 'Massa magra até 300 kg'
  const noteError = optionalText(note, 300, 'Use até 300 caracteres')
  if (noteError) errors.note = noteError
  return errors
}

export const SPONSORED_AD_CTA_TYPES = ['external', 'internal']
export const SPONSORED_AD_DISPLAY_MODES = ['feed', 'banner']
// Sem allowlist de esquema, ctaTarget era texto livre renderizado direto como href —
// um ctaTarget do tipo 'javascript:...' executava no clique, na origem real do app,
// contra qualquer membro das comunidades do anúncio (achado #1 da auditoria de
// segurança). https-only (não http) por simplicidade: um só esquema aceito, sem
// ambiguidade. Espelhada em isValidSponsoredAd() em firestore.rules -- nunca confiar só
// nesta camada.
const EXTERNAL_CTA_TARGET_PATTERN = /^https:\/\/.+$/
// Precisa começar com uma única barra (não duas) -- "//evil.com" é uma URL válida
// "protocol-relative" que o navegador resolveria para outro domínio, e "/\evil.com"
// sofre o mesmo risco por normalização de barra invertida em alguns navegadores. Só a
// barra raiz sozinha ("/") também é aceita.
const INTERNAL_CTA_TARGET_PATTERN = /^\/([^/\\].*)?$/
// Teto de forma do próprio documento (quantas comunidades um anúncio pode listar) —
// puramente sobre o shape, não exige consultar o Firestore, então cabe neste arquivo.
const MAX_SPONSORED_AD_COMMUNITIES = 50

// Quantos anúncios podem mirar a MESMA comunidade ao mesmo tempo — a checagem em si
// (contar quantos já existem) precisa do Firestore e mora em sponsoredAdsService.js,
// mas o número e a classe de erro ficam aqui: são valores puros que tanto o service
// quanto o formulário admin (SponsoredAdForm) precisam, e mantê-los aqui evita o
// formulário importar de um arquivo que carrega toda a inicialização do Firebase só
// para ler uma constante.
export const MAX_ACTIVE_ADS_PER_COMMUNITY = 6

export class SponsoredAdCapError extends Error {
  constructor(communityId) {
    super(`Esta comunidade já atingiu o limite de ${MAX_ACTIVE_ADS_PER_COMMUNITY} anúncios.`)
    this.name = 'SponsoredAdCapError'
    this.communityId = communityId
  }
}

export function validateSponsoredAd({
  partnerName,
  title,
  description,
  imageUrl,
  ctaLabel,
  ctaType,
  ctaTarget,
  expiresAt,
  communityIds,
  displayMode,
}) {
  const errors = {}

  const partnerNameError = requiredText(
    partnerName,
    60,
    'Nome do parceiro é obrigatório',
    'Nome do parceiro muito longo'
  )
  if (partnerNameError) errors.partnerName = partnerNameError

  const titleError = requiredText(title, 100, 'Título é obrigatório', 'Título muito longo')
  if (titleError) errors.title = titleError

  const descriptionError = optionalText(description, 500, 'Descrição muito longa')
  if (descriptionError) errors.description = descriptionError

  const imageUrlError = optionalText(imageUrl, 500, 'Link da imagem muito longo')
  if (imageUrlError) errors.imageUrl = imageUrlError

  const ctaLabelError = optionalText(ctaLabel, 30, 'Texto do botão muito longo')
  if (ctaLabelError) errors.ctaLabel = ctaLabelError

  // ctaType/ctaTarget só existem em função de ctaLabel — sem texto de botão, não faz
  // sentido exigir pra onde ele levaria.
  if (ctaLabel && ctaLabel.trim()) {
    if (!SPONSORED_AD_CTA_TYPES.includes(ctaType)) {
      errors.ctaType = 'Selecione o tipo de destino do botão'
    }
    const ctaTargetError = requiredText(
      ctaTarget,
      300,
      'Informe o destino do botão',
      'Destino do botão muito longo'
    )
    if (ctaTargetError) {
      errors.ctaTarget = ctaTargetError
    } else if (ctaType === 'external' && !EXTERNAL_CTA_TARGET_PATTERN.test(ctaTarget.trim())) {
      errors.ctaTarget = 'Links externos devem começar com https://'
    } else if (ctaType === 'internal' && !INTERNAL_CTA_TARGET_PATTERN.test(ctaTarget.trim())) {
      errors.ctaTarget = 'Rotas internas devem começar com uma única barra (ex.: /comunidades)'
    }
  }

  if (expiresAt) {
    const date = new Date(expiresAt)
    if (Number.isNaN(date.getTime())) errors.expiresAt = 'Data de expiração inválida'
  }

  if (!Array.isArray(communityIds) || communityIds.length < 1) {
    errors.communityIds = 'Selecione pelo menos uma comunidade'
  } else if (communityIds.length > MAX_SPONSORED_AD_COMMUNITIES) {
    errors.communityIds = `Selecione no máximo ${MAX_SPONSORED_AD_COMMUNITIES} comunidades`
  }

  if (
    !Array.isArray(displayMode) ||
    displayMode.length < 1 ||
    !displayMode.every((mode) => SPONSORED_AD_DISPLAY_MODES.includes(mode))
  ) {
    errors.displayMode = 'Selecione ao menos uma forma de exibição (feed e/ou banner)'
  }

  return errors
}
