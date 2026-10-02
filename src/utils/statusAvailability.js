import { toMillis } from './expiry.js'

export function effectivePublicationExpiry(status) {
  const commentsCloseAt = toMillis(status?.commentsCloseAt)
  const expiresAt = toMillis(status?.expiresAt)
  const promotedUntil = status?.promoted === true ? toMillis(status?.promotedUntil) : 0
  return Math.max(
    Number.isFinite(commentsCloseAt) ? commentsCloseAt : 0,
    Number.isFinite(expiresAt) ? expiresAt : 0,
    Number.isFinite(promotedUntil) ? promotedUntil : 0
  )
}

export function isPublicationInteractionActive(status, now = Date.now()) {
  return effectivePublicationExpiry(status) > toMillis(now)
}
