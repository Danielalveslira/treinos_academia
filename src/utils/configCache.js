// Separate entries by identity. Failed or invalidated requests never poison a
// retry. Freshness is bounded without adding a permanent Firestore listener.
export function createConfigCache(fetchValue, { maxAge = 300000, now = Date.now } = {}) {
  const entries = new Map()
  return {
    get(key) {
      const cached = entries.get(key)
      if (cached && cached.expiresAt > now()) return cached.promise
      const entry = { expiresAt: now() + maxAge }
      entry.promise = Promise.resolve()
        .then(() => fetchValue(key))
        .catch((error) => {
          if (entries.get(key) === entry) entries.delete(key)
          throw error
        })
      entries.set(key, entry)
      return entry.promise
    },
    clear() {
      entries.clear()
    },
  }
}
