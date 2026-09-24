// Cache de sessão para as URLs de objeto (blob:) das fotos já baixadas do Storage —
// evita rebaixar a mesma imagem a cada re-render/scroll do feed. Diferente do
// pageCache.js (dados pequenos, sem limite), aqui cada entrada pode pesar até
// MAX_OUTPUT_BYTES (utils/imageCompression.js), então o cache tem um teto: ao
// estourar, a entrada mais antiga é revogada (URL.revokeObjectURL) antes de sair do
// mapa, para não vazar memória seguindo com blobs enormes vivos sem nenhuma <img>
// referenciando eles.
const MAX_ENTRIES = 30
const cache = new Map()
// Downloads em andamento, por path -- nunca guarda a Promise no `cache` acima (que só
// guarda URLs já resolvidas): dois cards montando com o mesmo path ao mesmo tempo (ex.:
// o mesmo autor aparecendo em "Destaques" e no feed principal) esperam esta ÚNICA
// requisição em vez de cada um abrir a sua contra o Storage.
const inFlight = new Map()

export function getCachedPhotoUrl(photoPath) {
  return cache.get(photoPath)
}

export function setCachedPhotoUrl(photoPath, url) {
  if (cache.has(photoPath)) cache.delete(photoPath)
  cache.set(photoPath, url)
  while (cache.size > MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value
    URL.revokeObjectURL(cache.get(oldestKey))
    cache.delete(oldestKey)
  }
}

// `fetcher` só roda quando nem o cache resolvido nem um download já em andamento
// cobrem este path. Rejeições não são cacheadas -- a próxima montagem tenta de novo.
export function loadPhotoOnce(photoPath, fetcher) {
  const cached = getCachedPhotoUrl(photoPath)
  if (cached) return Promise.resolve(cached)
  const pending = inFlight.get(photoPath)
  if (pending) return pending
  const promise = Promise.resolve()
    .then(fetcher)
    .then((url) => {
      setCachedPhotoUrl(photoPath, url)
      return url
    })
    .finally(() => {
      if (inFlight.get(photoPath) === promise) inFlight.delete(photoPath)
    })
  inFlight.set(photoPath, promise)
  return promise
}

// AUD-018: nada chamava isto no logout/troca de usuário -- os blobs (e as object URLs
// que apontam pra eles) ficavam vivos em memória até serem despejados pelo teto de
// MAX_ENTRIES ou até um reload de página, mesmo depois da sessão que os baixou acabar.
export function clearPhotoCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url)
  cache.clear()
}
