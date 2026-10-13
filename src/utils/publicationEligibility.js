import { toMillis } from './expiry.js'
import { isNeverExpiring } from './postRetention.js'

// A view já valida a promoção real. Não reconstruir esse prazo a partir de flags.
// O fallback é somente para publicações locais, ainda sem a resposta da view.
export function isPublicationEligible(status, now = Date.now()) {
  if (Object.hasOwn(status, 'publicationExpiresAt')) {
    return status.publicationExpiresAt === null || toMillis(status.publicationExpiresAt) > now
  }
  return isNeverExpiring(status) || toMillis(status.expiresAt) > now
}

// Mantém a referência quando nada expirou, evitando atualizações de estado/cache.
export function eligiblePublications(items, now = Date.now()) {
  const next = items.filter((status) => isPublicationEligible(status, now))
  return next.length === items.length ? items : next
}
