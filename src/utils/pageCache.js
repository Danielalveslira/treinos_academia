// Session-only cache (cleared on full reload): lets a page reuse the last fetched data
// instead of re-reading Firestore every time its component remounts (e.g. switching tabs
// in the bottom nav). Pages still expose a manual "Atualizar" action to force a refetch.
const store = new Map()

export function getCached(key) {
  return store.has(key) ? store.get(key) : undefined
}

export function setCached(key, value) {
  store.set(key, value)
}
