import { isLocalFallback } from '../services/offline/localFallback.js'

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

// maxAge opcional: o feed da comunidade vale ser mostrado "velho" por mais tempo enquanto é revalidado em
// segundo plano (ver useCommunityFeed); o padrão continua sendo 5 minutos.
export function setCached(key, value, maxAge = MAX_AGE) {
  store.delete(key)
  store.set(key, { value, expiresAt: Date.now() + maxAge })
  if (store.size > MAX_ENTRIES) store.delete(store.keys().next().value)
}

export function fetchCached(key, fetchValue, { force = false } = {}) {
  if (pending.has(key)) return pending.get(key)
  const cached = getCached(key)
  if (!force && cached !== undefined) return Promise.resolve(cached)
  const request = Promise.resolve()
    .then(fetchValue)
    .then((value) => {
      // Logout or a write may have invalidated this request while it was in flight. Um resultado
      // que veio do IndexedDB (servidor inalcançável) nunca é memorizado: ao reconectar, a
      // próxima leitura deve ir ao servidor, não reaproveitar um dado local por 5 minutos.
      if (pending.get(key) === request && !isLocalFallback(value)) setCached(key, value)
      return value
    })
    .finally(() => {
      if (pending.get(key) === request) pending.delete(key)
    })
  pending.set(key, request)
  return request
}

const invalidationListeners = new Set()
export function onCacheInvalidated(listener) {
  invalidationListeners.add(listener)
  return () => invalidationListeners.delete(listener)
}

export function invalidateCache(prefix) {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key)
  for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key)
  invalidationListeners.forEach((listener) => listener(prefix))
}

// Único ponto que conhece a chave `communities:{uid}` -- entrar/sair/criar/editar/
// excluir comunidade chamam isto em vez de escrever a string na mão em cada arquivo
// (useCommunities.js, CommunityDetail.jsx, CreateCommunity.jsx, communityMembersService.js).
export function invalidateCommunitiesCache(uid) {
  invalidateCache(`communities:${uid}`)
}

export function invalidateWorkoutCache(uid) {
  for (const prefix of ['dashboard', 'workouts', 'exerciseHistory', 'progress', 'home-sheet-activity']) {
    invalidateCache(`${prefix}:${uid}:`)
    // Dashboard keys historically have no suffix.
    store.delete(`${prefix}:${uid}`)
    pending.delete(`${prefix}:${uid}`)
  }
}

// Estados em memória de outros módulos (avatares, âncoras de rolagem, carregadores em lote...) que também
// precisam sumir quando a sessão muda: registram-se aqui e são limpos junto com a cache de páginas, que o
// AuthContext já esvazia ao trocar de conta ou encerrar a sessão.
const clearListeners = new Set()

export function onPageCacheClear(listener) {
  clearListeners.add(listener)
  return () => clearListeners.delete(listener)
}

export function clearPageCache() {
  store.clear()
  pending.clear()
  clearListeners.forEach((listener) => listener())
}
