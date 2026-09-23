export function normalizeListingFilter(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

export function listingFilterKey({
  kind,
  modality = '*',
  uf = '*',
  city = '*',
  serviceMode = '*',
}) {
  return `${kind}|${modality}|${uf}|${normalizeListingFilter(city) || '*'}|${serviceMode}`
}

export function safeExternalContact(contact) {
  if (!contact || !['whatsapp', 'instagram', 'website'].includes(contact.type)) return null
  try {
    const url = new URL(contact.url)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (contact.type === 'whatsapp' && url.hostname !== 'wa.me') return null
    if (
      contact.type === 'instagram' &&
      !['instagram.com', 'www.instagram.com'].includes(url.hostname)
    )
      return null
    return { ...contact, url: url.href }
  } catch {
    return null
  }
}

export const EMPTY_LISTING_DRAFT = {
  displayName: '',
  categoryKey: '',
  modalityKeys: [],
  specialties: [],
  bio: '',
  city: '',
  uf: '',
  serviceMode: 'in_person',
  contacts: { whatsapp: '', instagram: '', website: '' },
  linkedCommunityId: '',
  useProfileAvatar: false,
}
