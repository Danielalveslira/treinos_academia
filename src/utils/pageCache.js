// Memory only. Keys include the user ID; never cache authorization decisions here.
const store = new Map()
const pending = new Map()
const MAX_ENTRIES = 100
const MAX_AGE = 5 * 60 * 1000

export function getCached(key) {
  const entry = store.get(key)
  if (!entry || entry.expiresAt <= Date.now()) {
    store.delete(key)
    return undefined
  }
  return entry.value
}

export function setCached(key, value) {
  store.delete(key)
  store.set(key, { value, expiresAt: Date.now() + MAX_AGE })
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value)
}

export function fetchCached(key, fetchValue, { force = false } = {}) {
  if (pending.has(key)) return pending.get(key)
  const cached = getCached(key)
  if (!force && cached !== undefined) return Promise.resolve(cached)
  const request = Promise.resolve()
    .then(fetchValue)
    .then((value) => {
      // Logout or a write may have invalidated this request while it was in flight.
      if (pending.get(key) === request) setCached(key, value)
      return value
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}

export function invalidateCache(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key)
}

export function invalidateWorkoutCache(uid) {
  for (const prefix of ['dashboard', 'workouts', 'exerciseHistory']) {
    invalidateCache(`${prefix}:${uid}:`)
    // Dashboard keys historically have no suffix.
    store.delete(`${prefix}:${uid}`)
    pending.delete(`${prefix}:${uid}`)
  }
}

export function clearPageCache() {
  store.clear()
  pending.clear()
}
