import { isValidSet, MAX_WORKOUT_SETS } from './workoutSets.js'
import { calculateAge } from './age.js'
import { EXERCISE_TYPES } from './exerciseType.js'
import { isValidCardioSession, MAX_DURATION_MINUTES, MAX_DISTANCE_KM } from './cardioSessions.js'
import { COMMUNITY_ICON_NAMES } from '../constants/communityIcons.js'
import { USAGE_PROFILES } from '../constants/usageProfile.js'
import { isFutureBusinessDay } from './businessDate.js'
import { STATUS_TEXT_MAX_LENGTH } from './statusLimits.js'

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/
export const SEXO_OPTIONS = ['masculino', 'feminino', 'nao_informar']
const MAX_PLAUSIBLE_AGE = 120
export const PASSWORD_MIN_LENGTH = 8

// Espelha a política do servidor (supabase/config.toml: minimum_password_length = 8,
// password_requirements = "letters_digits") -- validar aqui só adianta o feedback; o
// GoTrue é sempre a autoridade final.
export function validatePassword(password) {
  const errors = {}
  const value = password || ''
  if (value.length < PASSWORD_MIN_LENGTH) {
    errors.password = `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`
  } else if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    errors.password = 'A senha deve ter letras e números'
  }
  return errors
}

// Usado nas duas telas de "defina uma senha nova" (ResetPassword.jsx e ConfirmEmail.jsx) --
// mesma política + confirmação por digitação repetida.
export function validatePasswordConfirmation(password, confirmPassword) {
  const errors = validatePassword(password)
  if (password !== confirmPassword) errors.confirmPassword = 'As senhas não coincidem'
  return errors
}

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

// `required`: cadastro e conclusão de perfil exigem uma escolha explícita ("Não informar" vale como
// escolha). Sem `required` (contas antigas), ausência continua aceita -- só valor desconhecido falha.
export function validateSexo(value, { required = false } = {}) {
  const errors = {}
  if (required && !SEXO_OPTIONS.includes(value)) errors.sexo = 'Selecione uma opção para Sexo'
  else if (value != null && value !== '' && !SEXO_OPTIONS.includes(value))
    errors.sexo = 'Opção inválida'
  return errors
}

// Diferente de validateSexo: obrigatório e sem alternativa pré-selecionada (ver
// Register.jsx) -- um valor ausente é sempre um erro, não "não informado".
export function validateUsageProfile(value) {
  const errors = {}
  if (!USAGE_PROFILES.includes(value)) {
    errors.usageProfile = 'Selecione como você pretende utilizar o Evolutus'
  }
  return errors
}

// Só o formato básico (algo@dominio.tld, até 254 caracteres) para dar o erro junto do campo antes de
// criar a conta; o GoTrue continua sendo a autoridade (email_address_invalid).
export function validateEmail(rawEmail) {
  const errors = {}
  const email = (rawEmail || '').trim()
  if (!email) errors.email = 'Informe seu e-mail'
  else if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(email))
    errors.email = 'E-mail inválido. Confira se está no formato nome@exemplo.com'
  return errors
}

// Cidade onde mora: precisa ser um código escolhido no seletor (CitySelector). Texto digitado sem
// escolher uma sugestão chega aqui como null. A existência do código é conferida no servidor.
export function validateResidenceMunicipality(code) {
  const errors = {}
  if (!Number.isInteger(code) || code < 1100000 || code > 5399999)
    errors.city = 'Selecione a cidade onde você mora na lista de sugestões'
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

export function validateExercisePreferences({ note, active }) {
  const errors = {}
  if (typeof note !== 'string' || note.length > 300)
    errors.note = 'A observação deve ter até 300 caracteres'
  if (typeof active !== 'boolean') errors.active = 'Status inválido'
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
  } else if (isFutureBusinessDay(date)) {
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
  // Defesa em profundidade: a grade do seletor já só oferece esses valores -- checar
  // aqui também evita gastar uma escrita que o resto do app não saberia renderizar.
  if (iconName != null && !COMMUNITY_ICON_NAMES.includes(iconName))
    errors.iconName = 'Ícone inválido'
  return errors
}

export function validateTextStatus({ text }) {
  const errors = {}
  const textError = requiredText(
    text,
    STATUS_TEXT_MAX_LENGTH,
    'Escreva algo para publicar',
    'Texto muito longo'
  )
  if (textError) errors.text = textError
  return errors
}

export function validatePollStatus({ question, options }) {
  const errors = {}
  const questionError = requiredText(
    question,
    200,
    'Pergunta é obrigatória',
    'Pergunta muito longa'
  )
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

// Tudo opcional — só valida formato/faixa plausível de quem preencheu (validação hoje só
// client-side, sem constraint espelhando isto no Postgres), nunca obrigatoriedade.
export function validateBodyMeasurement({
  heightCm,
  weightKg,
  bodyFatPercent,
  abdomenCm,
  waistCm,
  hipCm,
  chestCm,
  armCm,
  thighCm,
  calfCm,
  leanMassKg,
  fatMassKg,
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
  if (!inRange(abdomenCm, 0, 300)) errors.abdomenCm = 'Abdômen até 300 cm'
  if (!inRange(waistCm, 0, 200)) errors.waistCm = 'Cintura até 200 cm'
  if (!inRange(hipCm, 0, 200)) errors.hipCm = 'Quadril até 200 cm'
  if (!inRange(chestCm, 0, 300)) errors.chestCm = 'Tórax até 300 cm'
  if (!inRange(armCm, 0, 200)) errors.armCm = 'Braço até 200 cm'
  if (!inRange(thighCm, 0, 200)) errors.thighCm = 'Coxa até 200 cm'
  if (!inRange(calfCm, 0, 200)) errors.calfCm = 'Panturrilha até 200 cm'
  if (!inRange(leanMassKg, 0, 300)) errors.leanMassKg = 'Massa magra até 300 kg'
  if (!inRange(fatMassKg, 0, 300)) errors.fatMassKg = 'Massa gorda até 300 kg'
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
// ambiguidade. Espelhada no constraint sponsored_ads_cta_target_shape (migration
// sponsored_ads.sql) -- nunca confiar só nesta camada.
const EXTERNAL_CTA_TARGET_PATTERN = /^https:\/\/.+$/
// Precisa começar com uma única barra (não duas) -- "//evil.com" é uma URL válida
// "protocol-relative" que o navegador resolveria para outro domínio, e "/\evil.com"
// sofre o mesmo risco por normalização de barra invertida em alguns navegadores. Só a
// barra raiz sozinha ("/") também é aceita.
const INTERNAL_CTA_TARGET_PATTERN = /^\/([^/\\].*)?$/
// Teto de forma da própria linha (quantas comunidades um anúncio pode listar; mesmo
// valor do constraint sponsored_ads_community_ids_size) — puramente sobre o shape, não
// exige nenhuma consulta extra, então cabe neste arquivo.
const MAX_SPONSORED_AD_COMMUNITIES = 50

// Quantos anúncios podem mirar a MESMA comunidade ao mesmo tempo — a checagem em si
// (contar quantos já existem) precisa de uma consulta e mora em sponsoredAdsService.js,
// mas o número e a classe de erro ficam aqui: são valores puros que tanto o service
// quanto o formulário admin (SponsoredAdForm) precisam, e mantê-los aqui evita o
// formulário importar de um arquivo que carrega toda a inicialização do client Supabase
// só para ler uma constante.
export const MAX_ACTIVE_ADS_PER_COMMUNITY = 6

export class SponsoredAdCapError extends Error {
  constructor(communityId) {
    super(`Esta comunidade já atingiu o limite de ${MAX_ACTIVE_ADS_PER_COMMUNITY} anúncios.`)
    this.name = 'SponsoredAdCapError'
    this.communityId = communityId
  }
}

// Mesmo raciocínio do teto por comunidade, mas para o banner da Home (isGlobal): sem um
// teto análogo, um anúncio global a mais nunca "esbarra" em lugar nenhum (não há uma
// lista de comunidades pra mostrar "cheia") e a Home acumularia anúncios indefinidamente.
export const MAX_ACTIVE_GLOBAL_ADS = 6

export class SponsoredAdGlobalCapError extends Error {
  constructor() {
    super(`A Home já atingiu o limite de ${MAX_ACTIVE_GLOBAL_ADS} anúncios globais.`)
    this.name = 'SponsoredAdGlobalCapError'
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
  isGlobal,
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

  // communityIds e isGlobal são ortogonais: o único estado inválido é não aparecer em
  // lugar nenhum (nem em comunidade nenhuma, nem na Home).
  if (!Array.isArray(communityIds)) {
    errors.communityIds = 'Selecione pelo menos uma comunidade'
  } else if (communityIds.length > MAX_SPONSORED_AD_COMMUNITIES) {
    errors.communityIds = `Selecione no máximo ${MAX_SPONSORED_AD_COMMUNITIES} comunidades`
  } else if (communityIds.length < 1 && !isGlobal) {
    errors.communityIds = 'Selecione ao menos uma comunidade ou marque "Exibir na Home"'
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

function requiredTextRange(value, min, max, requiredMessage, rangeMessage) {
  const trimmed = (value || '').trim()
  if (!trimmed) return requiredMessage
  if (trimmed.length < min || value.length > max) return rangeMessage
  return undefined
}

// Mesma checagem de URL usada no cadastro de produtos da Vitrine (CommercialAdmin/
// PartnerProductForm): https-only, sem usuário/senha embutidos na URL e com um host que
// não seja um IP nu -- espelha (sem substituir) o constraint de formato em
// partner_products.store_url/image_url (migration 20261108000001_public_commercial.sql).
export function isValidPartnerProductUrl(value) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      /\.[a-z]{2,}$/i.test(url.hostname) &&
      !/^[\d.]+$/.test(url.hostname)
    )
  } catch {
    return false
  }
}

// Mesmos limites do constraint check em partner_products (migration
// 20261108000001_public_commercial.sql): name/brand 2-120, category 2-80, description
// 10-500. ends_at > starts_at (quando ambos definidos) espelha o constraint da mesma
// tabela -- validado aqui só para mostrar o erro perto do campo antes de ir ao servidor,
// que continua sendo a autoridade final. `requireImage` espelha o trigger
// enforce_partner_product_image (migration 20261111000001_partner_products_require_image.sql):
// o chamador (CommercialAdmin) passa true para todo cadastro novo e para qualquer
// publicação (approved=true), mesmo em produtos legados sem imagem.
export function validatePartnerProduct({
  name,
  brand,
  category,
  description,
  storeUrl,
  imageUrl,
  startsAt,
  endsAt,
  requireImage = false,
}) {
  const errors = {}

  const nameError = requiredTextRange(
    name,
    2,
    120,
    'Nome do produto é obrigatório',
    'Nome deve ter de 2 a 120 caracteres'
  )
  if (nameError) errors.name = nameError

  const brandError = requiredTextRange(
    brand,
    2,
    120,
    'Marca é obrigatória',
    'Marca deve ter de 2 a 120 caracteres'
  )
  if (brandError) errors.brand = brandError

  const categoryError = requiredTextRange(
    category,
    2,
    80,
    'Categoria é obrigatória',
    'Categoria deve ter de 2 a 80 caracteres'
  )
  if (categoryError) errors.category = categoryError

  const descriptionError = requiredTextRange(
    description,
    10,
    500,
    'Descrição é obrigatória',
    'Descrição deve ter de 10 a 500 caracteres'
  )
  if (descriptionError) errors.description = descriptionError

  if (!storeUrl || !storeUrl.trim()) {
    errors.storeUrl = 'URL da loja é obrigatória'
  } else if (storeUrl.length > 500) {
    errors.storeUrl = 'URL da loja muito longa'
  } else if (!isValidPartnerProductUrl(storeUrl.trim())) {
    errors.storeUrl = 'Use uma URL HTTPS válida, sem usuário/senha na URL'
  }

  if (!imageUrl || !imageUrl.trim()) {
    if (requireImage) errors.imageUrl = 'Imagem é obrigatória para cadastrar ou publicar o produto'
  } else if (imageUrl.length > 500) {
    errors.imageUrl = 'URL da imagem muito longa'
  } else if (!isValidPartnerProductUrl(imageUrl.trim())) {
    errors.imageUrl = 'Use uma URL HTTPS válida, sem usuário/senha na URL'
  }

  if (startsAt && endsAt) {
    const starts = new Date(startsAt)
    const ends = new Date(endsAt)
    if (!Number.isNaN(starts.getTime()) && !Number.isNaN(ends.getTime()) && ends <= starts) {
      errors.endsAt = 'O fim deve ser depois do início'
    }
  }

  return errors
}
