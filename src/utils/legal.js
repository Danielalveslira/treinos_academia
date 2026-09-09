import manifest from '../../functions/legal/manifest.json'
import documents from '../../functions/legal/documents.json'

export const LEGAL_MANIFEST = manifest
export const LEGAL_DOCUMENTS = documents

export function needsLegalAcceptance(acceptance, version = manifest.version) {
  return !acceptance || acceptance.version !== version || !acceptance.acceptedAt
}

export function isAccountRestricted(restriction, now = Date.now()) {
  if (!restriction) return false
  if (restriction.action === 'system_ban') return true
  const until = restriction.until?.toMillis?.() ?? new Date(restriction.until).getTime()
  return restriction.action === 'temporary_suspension' && until > now
}
