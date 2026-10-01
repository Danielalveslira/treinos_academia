// Cache do catálogo da ExerciseAPI, por dispositivo (nunca compartilhado/servidor) --
// IndexedDB em vez de localStorage porque o volume acumulado (buscas + detalhes vistos)
// não deve competir com a cota apertada (e síncrona) do localStorage. TTL de 24h,
// stale-while-revalidate: uma entrada expirada ainda é devolvida (com staleness sinalizada),
// nunca bloqueia a UI esperando rede -- quem chama decide se busca atualização em
// background.
//
// Versionado (DB_VERSION/STORE) por dois motivos independentes: (1) se o formato salvo
// mudar, um bump aqui invalida tudo de uma vez, sem precisar migrar registros antigos; (2)
// isolar do resto do app -- este é o único consumidor de IndexedDB hoje.
const DB_NAME = 'evolutus-exercise-catalog'
const DB_VERSION = 1
const STORE = 'entries'
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000
// Mesmo TTL dos demais dados da ExerciseAPI (24h, igual à orientação oficial deles) --
// stale-while-revalidate já cobre a atualização, não precisa de uma janela maior só
// porque músculos/equipamentos mudam pouco.
export const TAXONOMY_TTL_MS = 24 * 60 * 60 * 1000

let dbPromise

function openDb() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'key' })
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    }).catch(() => null)
  }
  return dbPromise
}

async function withStore(mode, run) {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, mode)
    const store = tx.objectStore(STORE)
    const request = run(store)
    request.onsuccess = () => resolve(request.result)
    // Falha de IO do IndexedDB (quota, modo privado, etc.) nunca deve quebrar a tela --
    // trata como "sem cache", quem chamou recai pra rede.
    request.onerror = () => resolve(undefined)
    tx.onerror = () => resolve(undefined)
  })
}

// { value, fresh, stale } -- fresh=true dentro do TTL; stale=true significa "existe mas
// venceu" (ainda útil pra mostrar algo enquanto atualiza em segundo plano); undefined
// quando nunca foi cacheado.
export async function getCacheEntry(key, { ttlMs = CACHE_TTL_MS } = {}) {
  const record = await withStore('readonly', (store) => store.get(key))
  if (!record) return undefined
  const age = Date.now() - record.storedAt
  return { value: record.value, fresh: age < ttlMs, stale: age >= ttlMs }
}

export async function setCacheEntry(key, value) {
  await withStore('readwrite', (store) => store.put({ key, value, storedAt: Date.now() }))
}

export async function deleteCacheEntry(key) {
  await withStore('readwrite', (store) => store.delete(key))
}

export async function clearExerciseCatalogCache() {
  await withStore('readwrite', (store) => store.clear())
}

// Normaliza uma busca pra uma chave de cache estável -- "supino", " Supino ", "SUPINO"
// precisam bater na mesma entrada; filtros ausentes (undefined) não podem gerar uma
// chave diferente de filtros explicitamente vazios.
export function buildSearchCacheKey({ q, category, muscle, equipment, level, force, mechanic, hasVideo, limit, offset }) {
  const normalizedQuery = (q || '').trim().toLowerCase().replace(/\s+/g, ' ')
  return [
    'search',
    normalizedQuery,
    category || '',
    muscle || '',
    equipment || '',
    level || '',
    force || '',
    mechanic || '',
    hasVideo == null ? '' : String(hasVideo),
    limit ?? 20,
    offset ?? 0,
  ].join('|')
}

export function buildDetailCacheKey(providerExerciseId) {
  return `detail|${providerExerciseId}`
}

export function buildTaxonomyCacheKey(kind) {
  return `taxonomy|${kind}`
}

// Deduplicação de chamadas simultâneas: duas montagens de componente pedindo a MESMA
// chave ao mesmo tempo (mesmo termo de busca, mesmo exercício em duas telas) resultam
// numa única chamada de rede -- a segunda só "pega carona" na promise em andamento. Só
// em memória (não sobrevive a reload), complementar ao IndexedDB, não substituto.
const inFlight = new Map()

export function dedupeFetch(key, fetcher) {
  if (inFlight.has(key)) return inFlight.get(key)
  const promise = fetcher().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key)
  })
  inFlight.set(key, promise)
  return promise
}
