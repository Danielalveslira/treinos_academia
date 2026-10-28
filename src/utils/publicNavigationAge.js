// Monotonic age of the HTML request, including IO. Turbo keeps the document clock,
// so performance.now() alone would incorrectly age fresh HTML by the previous visit.
export function publicNavigationAge(
  perf = globalThis.performance,
  href = globalThis.location?.href
) {
  const now = perf?.now?.() || 0
  try {
    const url = new URL(href)
    url.hash = ''
    const starts = (perf.getEntriesByName?.(url.href) || [])
      .filter(
        (e) =>
          ['navigation', 'resource'].includes(e.entryType) &&
          Number.isFinite(e.startTime) &&
          e.startTime >= 0 &&
          e.startTime <= now
      )
      .map((e) => e.startTime)
    return now - (starts.length ? Math.max(...starts) : 0)
  } catch {
    return now
  }
}
