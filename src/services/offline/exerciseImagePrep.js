// Preparação SELETIVA de imagens oficiais dos exercícios (start/end/thumbnail) para uso offline --
// docs/prompts/EVOLUTUS_PROMPT_CATALOGO_OFFLINE_COMPLETO.md seção 4.2. Não baixa nada "no escuro":
// só os exercícios que o chamador passar (tipicamente os da rotina do usuário), com concorrência
// pequena, cancelamento e progresso real.
//
// Importante: este módulo NÃO escreve no Cache Storage diretamente nem duplica a validação de
// CORS/MIME -- o Service Worker (scripts/service-worker.js) já intercepta QUALQUER fetch() para
// uma URL do bucket exercise-visuals (não só <img>) e decide, com a mesma lógica de sempre
// (isCacheableExerciseImage), se grava. Aqui só disparamos o fetch e CONFIRMAMOS no Cache Storage
// se ele realmente foi gravado -- um fetch "ok" não garante isso (sem SW ativo, quota cheia, MIME
// errado), então nunca contamos sucesso sem essa confirmação.

// Mesmo nome EXATO do cache usado por scripts/service-worker.js (EXERCISE_IMAGE_CACHE) -- Cache
// Storage é compartilhado por nome entre página e worker na mesma origem; não há import cruzado
// possível entre os dois pipelines de build, por isso a string é duplicada de propósito.
const EXERCISE_IMAGE_CACHE = 'treinos-exercise-images-v1'
// Mesma string em scripts/service-worker.js (EXERCISE_IMAGE_MANIFEST_URL).
const EXERCISE_IMAGE_MANIFEST_URL = '/__exercise-image-manifest__'
const DEFAULT_CONCURRENCY = 3

function hasCacheStorage() {
  return typeof globalThis.caches?.open === 'function'
}

async function isImageCached(cache, url) {
  try {
    return Boolean(await cache.match(url))
  } catch {
    return false
  }
}

// URLs únicas, na ordem em que aparecem (thumbnail + start/end), de uma lista de exercícios no
// formato já consumido pela UI (ver exerciseCatalogService.mapRow) -- nunca conta imagem
// inexistente (campo ausente/vazio é simplesmente ignorado, não é uma falha).
export function collectRoutineImageUrls(exercises) {
  const urls = new Set()
  for (const exercise of exercises || []) {
    if (typeof exercise?.thumbnail === 'string' && exercise.thumbnail) urls.add(exercise.thumbnail)
    for (const url of exercise?.images || []) if (typeof url === 'string' && url) urls.add(url)
  }
  return [...urls]
}

// Tenta baixar (ou só confirmar que já está em cache) as imagens oficiais dos exercícios
// informados, com concorrência limitada. Nunca lança: cada URL é independente, uma falha não
// aborta as demais. Ao final, grava o manifesto de paths protegidos (ver scripts/service-worker.js)
// para que a poda do Service Worker priorize o que acabou de ser preparado.
export async function prepareRoutineImages(
  exercises,
  { concurrency = DEFAULT_CONCURRENCY, onProgress, signal } = {}
) {
  const urls = collectRoutineImageUrls(exercises)
  const total = urls.length
  if (!hasCacheStorage() || total === 0) {
    const result = { done: 0, failed: 0, total }
    onProgress?.(result)
    return result
  }

  const cache = await globalThis.caches.open(EXERCISE_IMAGE_CACHE)
  let done = 0
  let failed = 0
  let nextIndex = 0
  const report = () => onProgress?.({ done, failed, total })

  async function worker() {
    while (nextIndex < urls.length) {
      if (signal?.aborted) return
      const url = urls[nextIndex]
      nextIndex += 1
      try {
        let cached = await isImageCached(cache, url)
        if (!cached) {
          await fetch(url, { mode: 'cors', credentials: 'omit', signal })
          cached = await isImageCached(cache, url)
        }
        if (cached) done += 1
        else failed += 1
      } catch {
        failed += 1
      }
      report()
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, urls.length))
  await Promise.all(Array.from({ length: workerCount }, worker))
  await writeProtectedManifest(cache, urls)
  return { done, failed, total }
}

async function writeProtectedManifest(cache, urls) {
  try {
    const paths = urls.map((url) => new URL(url).pathname)
    await cache.put(
      EXERCISE_IMAGE_MANIFEST_URL,
      new Response(JSON.stringify({ paths, updatedAt: Date.now() }), {
        headers: { 'content-type': 'application/json' },
      })
    )
  } catch {
    // Melhor esforço: sem o manifesto, a eviction normal (FIFO) ainda protege o resto do cache --
    // só perde a prioridade extra para estas imagens específicas.
  }
}

// "X de Y arquivos disponíveis" -- SEMPRE recalculado contra o Cache Storage de verdade, nunca um
// flag lembrado (reinício do navegador, limpeza por quota ou troca de aba não deixam o número
// mentir). `total` só conta imagens realmente publicadas (ver collectRoutineImageUrls).
export async function countAvailableRoutineImages(exercises) {
  const urls = collectRoutineImageUrls(exercises)
  if (!hasCacheStorage() || urls.length === 0) return { available: 0, total: urls.length }
  const cache = await globalThis.caches.open(EXERCISE_IMAGE_CACHE)
  let available = 0
  for (const url of urls) if (await isImageCached(cache, url)) available += 1
  return { available, total: urls.length }
}

// O manifesto não tem user_id (é Cache Storage, não IndexedDB) -- sem isto, a rotina da conta
// anterior continuaria "protegida" na eviction do Service Worker depois do logout, mesmo sem
// nenhuma conta usando o aparelho. Chamado por userScope.purgePrivateData no logout explícito
// (keepUserId == null). Nunca lança; as IMAGENS em si continuam no cache (são públicas, mesmo
// bucket pra qualquer conta) -- só a prioridade de eviction "solta".
export async function clearRoutineImageManifest() {
  if (!hasCacheStorage()) return
  try {
    const cache = await globalThis.caches.open(EXERCISE_IMAGE_CACHE)
    await cache.delete(EXERCISE_IMAGE_MANIFEST_URL)
  } catch {
    /* melhor esforço */
  }
}
