export const LISTING_KINDS = ['professional', 'space']
export const SERVICE_MODES = ['in_person', 'online', 'hybrid']
export const CATEGORY_KEYS = [
  'personal_trainer',
  'coach',
  'fisioterapia',
  'nutricao',
  'academia',
  'box',
  'studio',
  'assessoria',
  'outros',
]
export const MODALITY_KEYS = [
  'musculacao',
  'corrida',
  'cross_training',
  'funcional',
  'ciclismo',
  'natacao',
  'lutas',
  'yoga',
  'pilates',
  'triatlo',
  'danca',
  'outros',
]
export const BRAZIL_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
]

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const INSTAGRAM_PATTERN = /^https:\/\/(?:www\.)?instagram\.com\/[A-Za-z0-9._-]+\/?$/i
const WHATSAPP_PATTERN = /^https:\/\/wa\.me\/[1-9][0-9]{7,14}$/

export function validListingId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value)
}

export function normalizeSearchValue(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

function cleanText(value, maxLength) {
  const result = String(value || '').trim()
  return result.length <= maxLength ? result : null
}

function cleanUrl(value, type) {
  const text = String(value || '').trim()
  if (!text) return null
  if (text.length > 300) return undefined
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' || url.username || url.password) return undefined
    if (type === 'website') return url.href
    if (type === 'instagram' && INSTAGRAM_PATTERN.test(text)) return url.href
    if (type === 'whatsapp' && WHATSAPP_PATTERN.test(text)) return text
  } catch {
    return undefined
  }
  return undefined
}

export function validateListingDraft(input) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const displayName = cleanText(data.displayName, 80)
  const bio = cleanText(data.bio, 1500)
  const city = cleanText(data.city, 80)
  const specialties = Array.isArray(data.specialties)
    ? [...new Set(data.specialties.map((item) => cleanText(item, 60)).filter(Boolean))]
    : []
  const modalityKeys = Array.isArray(data.modalityKeys)
    ? [...new Set(data.modalityKeys.filter((item) => MODALITY_KEYS.includes(item)))]
    : []
  const contacts = {
    whatsapp: cleanUrl(data.contacts?.whatsapp, 'whatsapp'),
    instagram: cleanUrl(data.contacts?.instagram, 'instagram'),
    website: cleanUrl(data.contacts?.website, 'website'),
  }

  if (!LISTING_KINDS.includes(data.kind)) return { error: 'Tipo de vitrine inválido.' }
  if (!displayName) return { error: 'Informe um nome com até 80 caracteres.' }
  if (!CATEGORY_KEYS.includes(data.categoryKey)) return { error: 'Categoria inválida.' }
  if (modalityKeys.length < 1 || modalityKeys.length > 5) {
    return { error: 'Selecione entre uma e cinco modalidades.' }
  }
  if (specialties.length > 10 || specialties.some((item) => item.length > 60)) {
    return { error: 'Informe no máximo dez especialidades.' }
  }
  if (!bio) return { error: 'Informe uma apresentação com até 1.500 caracteres.' }
  if (!city) return { error: 'Informe uma cidade com até 80 caracteres.' }
  if (!BRAZIL_STATES.includes(data.uf)) return { error: 'Estado inválido.' }
  if (!SERVICE_MODES.includes(data.serviceMode)) return { error: 'Atendimento inválido.' }
  if (Object.values(contacts).some((value) => value === undefined)) {
    return { error: 'Use somente links HTTPS válidos para os contatos.' }
  }
  if (data.linkedCommunityId && !validListingId(data.linkedCommunityId)) {
    return { error: 'Comunidade inválida.' }
  }

  return {
    value: {
      kind: data.kind,
      displayName,
      categoryKey: data.categoryKey,
      modalityKeys,
      specialties,
      bio,
      city,
      cityKey: normalizeSearchValue(city),
      uf: data.uf,
      serviceMode: data.serviceMode,
      contacts,
      linkedCommunityId: data.linkedCommunityId || null,
      useProfileAvatar: data.kind === 'professional' && data.useProfileAvatar === true,
    },
  }
}

export function buildFilterKeys({ kind, modalityKeys, cityKey, uf, serviceMode }) {
  const modalities = ['*', ...modalityKeys]
  const values = new Set()
  for (const modality of modalities) {
    for (const state of ['*', uf]) {
      for (const city of ['*', cityKey]) {
        for (const mode of ['*', serviceMode]) {
          values.add(`${kind}|${modality}|${state}|${city}|${mode}`)
        }
      }
    }
  }
  return [...values]
}

export function buildPublicProjection(
  draft,
  { avatarPath = null, avatarSourceMediaId = null } = {}
) {
  const publicContacts = Object.entries(draft.contacts)
    .filter(([, url]) => Boolean(url))
    .map(([type, url]) => ({ type, url }))
  return {
    kind: draft.kind,
    displayName: draft.displayName,
    sortKey: normalizeSearchValue(draft.displayName),
    categoryKey: draft.categoryKey,
    modalityKeys: draft.modalityKeys,
    specialties: draft.specialties,
    bio: draft.bio,
    city: draft.city,
    cityKey: draft.cityKey,
    uf: draft.uf,
    serviceMode: draft.serviceMode,
    publicContacts,
    linkedCommunityId: draft.linkedCommunityId || null,
    publicationStatus: 'published',
    filterKeys: buildFilterKeys(draft),
    ...(avatarPath ? { avatarPath, avatarSourceMediaId } : {}),
  }
}

export function selectedFilterKey({
  kind,
  modality = '*',
  uf = '*',
  city = '*',
  serviceMode = '*',
}) {
  return `${kind}|${modality}|${uf}|${normalizeSearchValue(city) || '*'}|${serviceMode}`
}
