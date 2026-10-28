// Monotonic, conservative deadline: processing/network time can shorten display,
// never extend a server-authorized interval. No device wall-clock assumption.
export function adAuthorizationDeadline(expiresAt, serverTime, requestStartedAt) {
  if (!expiresAt) return Infinity
  const remaining = Date.parse(expiresAt) - Date.parse(serverTime)
  return Number.isFinite(remaining) ? requestStartedAt + Math.max(0, remaining) : requestStartedAt
}
export function authorizedAds(ads, now) {
  return ads.filter((ad) => ad.authorizationUntil === undefined || ad.authorizationUntil > now)
}
export function nextAuthorizationDeadline(ads) {
  const deadlines = ads.map((ad) => ad.authorizationUntil).filter(Number.isFinite)
  return deadlines.length ? Math.min(...deadlines) : null
}
