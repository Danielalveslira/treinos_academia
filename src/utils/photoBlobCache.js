// Cache de sessão para as URLs de objeto (blob:) das fotos já baixadas do Storage —
// evita rebaixar a mesma imagem a cada re-render/scroll do feed. Diferente do
// pageCache.js (dados pequenos, sem limite), aqui cada entrada pode pesar até
// MAX_OUTPUT_BYTES (utils/imageCompression.js), então o cache tem um teto: ao
// estourar, a entrada mais antiga é revogada (URL.revokeObjectURL) antes de sair do
// mapa, para não vazar memória seguindo com blobs enormes vivos sem nenhuma <img>
// referenciando eles.
const MAX_ENTRIES = 30
const cache = new Map()

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
