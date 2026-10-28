// Política de cache do Evolutus (ver docs/prompts/current/evolutus_pwa_performance_navegacao_auditoria.md):
//
//  - PRECACHE (install): só o shell para o app abrir -- index.html, manifest, ícones e o JS/CSS
//    de boot. Telas (Admin, Comunidades, gráficos...) NÃO são baixadas na instalação.
//  - /assets/*  (nome com hash de conteúdo => imutável): cache-first, preenchido sob demanda
//    quando a tela é aberta. Cache NÃO versionado de propósito: uma aba antiga ainda precisa dos
//    chunks da versão antiga depois que este worker assume; o teto de entradas descarta os mais
//    antigos, então não cresce sem limite.
//  - /img/*: cache-first com teto de entradas e idade máxima.
//  - navegação: network-first (um F5 sempre busca o shell mais novo); cache só como fallback
//    offline.
//  - imagens oficiais dos exercícios (ÚNICA exceção de origem externa): cache-first sob demanda, só
//    para URLs do bucket PÚBLICO exercise-visuals do Supabase configurado, no formato exato
//    {catalogId}/v{n}/{start|end|thumb}.webp. A versão faz parte do path (nova versão = URL nova),
//    então o cache nunca fica velho. Teto de entradas; nada é baixado antecipadamente.
//  - NUNCA interceptado: qualquer outra origem (Supabase Auth/REST/RPC/Realtime/Storage privado,
//    tokens, respostas autenticadas) e qualquer método diferente de GET. O Supabase é a única fonte
//    de verdade; só os bytes imutáveis das imagens públicas acima são guardados aqui.
const VERSION = '__VERSION__'
const SHELL_CACHE = `treinos-shell-${VERSION}`
const ASSET_CACHE = 'treinos-assets-v1'
const IMAGE_CACHE = 'treinos-images-v1'
const EXERCISE_IMAGE_CACHE = 'treinos-exercise-images-v1'
const SHELL_URLS = __SHELL_URLS__ // eslint-disable-line no-undef
const BOOT_ASSETS = __BOOT_ASSETS__ // eslint-disable-line no-undef
// Chunks das telas que abrem offline (Home, Treino, Histórico, Exercícios, detalhe): resolvidos no build
// a partir dos módulos-fonte (scripts/pwa-plugin.js), nunca por nome fixo.
const OFFLINE_ASSETS = __OFFLINE_ASSETS__ // eslint-disable-line no-undef
// Conjunto mínimo que esta versão exige para abrir offline: entra inteiro no install e nunca é expulso.
const CORE_ASSETS = [...BOOT_ASSETS, ...OFFLINE_ASSETS]
// Telemetria da última milha do Push (RPC pública, só avança o tempo da entrega dona do token).
// Null quando o build não tem as variáveis do Supabase: a telemetria simplesmente não roda.
const PUSH_ACK_URL = __PUSH_ACK_URL__ // eslint-disable-line no-undef
const PUSH_ACK_KEY = __PUSH_ACK_KEY__ // eslint-disable-line no-undef
const ACK_TIMEOUT_MS = 4000
// Prefixo https://<projeto>/storage/v1/object/public/exercise-visuals/ do bucket público de imagens
// dos exercícios. Null quando o build não tem VITE_SUPABASE_URL https: o cache simplesmente não liga.
const EXERCISE_VISUALS_PREFIX = __EXERCISE_VISUALS_PREFIX__ // eslint-disable-line no-undef
// {catalogId}/v{versão}/{start|end|thumb}.webp -- o único formato que o cache aceita.
const EXERCISE_VISUAL_FILE = /^[0-9a-f-]{36}\/v\d{1,6}\/(start|end|thumb)\.webp$/
const ACK_TOKEN_PATTERN = /^[0-9a-f]{64}$/
// Chave sintética (mesma origem do app, NÃO do bucket) onde a página grava a lista de paths das
// imagens da rotina que pediu para priorizar -- gravada DIRETO no Cache Storage pela própria
// página (window.caches também dá acesso a este mesmo cache por nome; não é mensagem, por isso
// sobrevive a reinício/atualização do worker: lida do cache a cada chamada, nunca de memória).
// Mesma string em src/services/offline/exerciseImagePrep.js (pipelines de build diferentes --
// não há import cruzado possível entre o Service Worker e o app).
const EXERCISE_IMAGE_MANIFEST_URL = '/__exercise-image-manifest__'
const MAX_PROTECTED_EXERCISE_PATHS = 200

const MAX_ASSET_ENTRIES = 120
const MAX_IMAGE_ENTRIES = 40
// ~50 exercícios visualizados (start + end). Sob demanda e com poda do mais antigo -- reduzido
// pela metade quando o aparelho está com pouco espaço (ver exerciseImageBudget). As imagens da
// rotina (manifesto acima) são protegidas da poda mesmo com o teto reduzido.
const MAX_EXERCISE_IMAGE_ENTRIES = 100
const LOW_STORAGE_RATIO = 0.9 // mesmo limiar de storagePersistence.js (LOW_SPACE_RATIO) no app
const IMAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const CACHED_AT_HEADER = 'x-sw-cached-at'
const PUBLIC_STATIC_ROUTES = new Set([
  '/como-funciona',
  '/para-empresas',
  '/vitrine',
  '/profissionais',
  '/locais',
])

// Os caches deste worker compartilham o prefixo; só eles são limpos (nada de apagar caches
// de terceiros da mesma origem).
const OWNED_PREFIX = 'treinos-'
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE, EXERCISE_IMAGE_CACHE]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      // ATÔMICO: a versão só vira "pronta" (e só então ativa) quando shell + boot + telas offline estão
      // TODOS no cache. Qualquer falha rejeita o install: o worker anterior (e o cache funcional dele)
      // continua valendo, e o shell parcial desta versão é descartado -- nunca "index novo + chunk antigo".
      try {
        const shell = await caches.open(SHELL_CACHE)
        await shell.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })))
        const assets = await caches.open(ASSET_CACHE)
        await Promise.all(
          CORE_ASSETS.map(async (url) => {
            if (!(await assets.match(url, { ignoreVary: true }))) await storeAsset(assets, url)
          })
        )
      } catch (error) {
        await caches.delete(SHELL_CACHE)
        throw error
      }
      // A install que não ativa sozinha é a causa raiz da tela branca pós-deploy: uma
      // aba que só faz hard refresh (sem fechar todas as abas) nunca via a versão nova,
      // e ficava presa servindo um index.html antigo apontando para chunks já removidos
      // do servidor. Ativar assim que instalar garante que a PRÓXIMA navegação (F5
      // incluso) sempre carregue de forma consistente.
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      // Shells de versões anteriores (e o precache gigante da política antiga, que usava o
      // mesmo prefixo) saem aqui; sem isso, cada deploy deixaria um cache novo para sempre.
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((key) => key.startsWith(OWNED_PREFIX) && !CURRENT_CACHES.includes(key))
          .map((key) => caches.delete(key))
      )
      // Chunks essenciais que o teto já tenha expulsado (ex.: instalados em outra versão e nunca
      // reinseridos) voltam ao cache antes da poda: sem eles o app não abre offline.
      await restoreCoreAssets()
      await Promise.all([
        trim(ASSET_CACHE, MAX_ASSET_ENTRIES, CORE_ASSETS),
        trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES),
        trimExerciseImages(),
      ])
    })()
  )
})

// Busca e guarda um asset; recusa 404/erro/HTML do fallback SPA (não seria um chunk JS/CSS de verdade).
async function storeAsset(cache, url) {
  const response = await fetch(url)
  if (!isCacheableAsset(response)) throw new Error(`asset indisponível: ${url}`)
  await cache.put(url, response)
}

// Melhor esforço: sem rede, o próximo install/activate com rede repete.
async function restoreCoreAssets() {
  try {
    const cache = await caches.open(ASSET_CACHE)
    await Promise.all(
      CORE_ASSETS.map(async (url) => {
        try {
          if (!(await cache.match(url, { ignoreVary: true }))) await storeAsset(cache, url)
        } catch {
          /* offline: tenta de novo no próximo ciclo */
        }
      })
    )
  } catch {
    /* cache indisponível: a poda abaixo continua protegendo o que existe */
  }
}

// Mantém no máximo `max` entradas, descartando as mais antigas (cache.keys() devolve na ordem de
// inserção). `keep` são pathnames que nunca saem: os chunks de boot da versão atual precisam
// sobreviver ao teto -- como o install não reinsere o que já existe, os chunks estáveis (vendor)
// seriam justamente os mais antigos e os primeiros expulsos.
async function trim(name, max, keep = []) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  const excess = keys.length - max
  if (excess <= 0) return
  const protectedPaths = new Set(keep)
  const evictable = keys.filter((key) => !protectedPaths.has(new URL(key.url).pathname))
  await Promise.all(evictable.slice(0, excess).map((key) => cache.delete(key)))
}

function isCacheableAsset(response) {
  // Um 404 reescrito para o index.html (SPA fallback) viria como 200 text/html: guardar isso
  // como se fosse um chunk JS envenenaria o cache.
  return (
    response.ok &&
    response.type === 'basic' &&
    !(response.headers.get('content-type') || '').includes('text/html')
  )
}

async function assetStrategy(request) {
  const cache = await caches.open(ASSET_CACHE)
  // O precache usa Request(url), enquanto imports de módulos/CSS incluem Origin. Alguns hosts
  // respondem com Vary: Origin; a comparação padrão perde o asset já salvo e tenta a rede offline.
  // Só chegamos aqui para assets da PRÓPRIA origem e com URL hashada pelo build.
  const cached = await cache.match(request, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(request)
  if (isCacheableAsset(response)) {
    await cache.put(request, response.clone())
    trim(ASSET_CACHE, MAX_ASSET_ENTRIES, CORE_ASSETS).catch(() => {})
  }
  return response
}

async function withTimestamp(response) {
  const headers = new Headers(response.headers)
  headers.set(CACHED_AT_HEADER, String(Date.now()))
  return new Response(await response.blob(), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function imageStrategy(request) {
  const cache = await caches.open(IMAGE_CACHE)
  const cached = await cache.match(request, { ignoreVary: true })
  const age = cached ? Date.now() - Number(cached.headers.get(CACHED_AT_HEADER) || 0) : Infinity
  if (cached && age < IMAGE_MAX_AGE_MS) return cached
  try {
    const response = await fetch(request)
    if (isCacheableAsset(response)) {
      await cache.put(request, await withTimestamp(response.clone()))
      trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES).catch(() => {})
    }
    return response
  } catch (error) {
    // Expirada mas offline: melhor a imagem velha do que nenhuma.
    if (cached) return cached
    throw error
  }
}

// Só GET de uma imagem publicada do bucket público, sem query nem hash (uma única chave por arquivo).
function isExerciseVisualUrl(url) {
  return (
    Boolean(EXERCISE_VISUALS_PREFIX) &&
    url.protocol === 'https:' &&
    !url.search &&
    !url.hash &&
    url.href.startsWith(EXERCISE_VISUALS_PREFIX) &&
    EXERCISE_VISUAL_FILE.test(url.href.slice(EXERCISE_VISUALS_PREFIX.length))
  )
}

function isCacheableExerciseImage(response) {
  return (
    response.ok &&
    response.type !== 'opaque' &&
    (response.headers.get('content-type') || '').startsWith('image/webp')
  )
}

// path (sem a origem do bucket) que casa o formato aceito -- usado para validar o manifesto da
// página antes de proteger qualquer coisa que ela liste (nunca confia ciegamente no conteúdo).
function isProtectableExercisePath(path) {
  if (!EXERCISE_VISUALS_PREFIX || typeof path !== 'string') return false
  const prefixPath = new URL(EXERCISE_VISUALS_PREFIX).pathname
  return path.startsWith(prefixPath) && EXERCISE_VISUAL_FILE.test(path.slice(prefixPath.length))
}

// Paths que a poda NUNCA pode expulsar: o próprio manifesto, mais os paths válidos que ele lista
// (imagens da rotina que a página preparou). Nunca lança -- manifesto ausente/corrompido só
// significa "nada protegido além dele mesmo"; a poda comum (FIFO) continua valendo pro resto.
async function protectedExercisePaths(cache) {
  const manifestPath = new URL(EXERCISE_IMAGE_MANIFEST_URL, self.location.origin).pathname
  const paths = [manifestPath]
  try {
    const manifestResponse = await cache.match(EXERCISE_IMAGE_MANIFEST_URL)
    if (manifestResponse) {
      const manifest = await manifestResponse.json()
      for (const path of Array.isArray(manifest?.paths) ? manifest.paths : []) {
        if (paths.length >= MAX_PROTECTED_EXERCISE_PATHS) break
        if (isProtectableExercisePath(path)) paths.push(path)
      }
    }
  } catch {
    /* manifesto corrompido/indisponível: segue só com o próprio manifesto protegido */
  }
  return paths
}

// Reduz o teto efetivo sob pressão de espaço (aparelho quase sem cota): protege o que já foi
// preparado da rotina (ver protectedExercisePaths) em vez de competir igualmente com entradas
// antigas/não solicitadas. Sem suporte a navigator.storage.estimate(), mantém o teto normal.
async function exerciseImageBudget() {
  try {
    const estimate = await self.navigator?.storage?.estimate?.()
    if (!estimate?.quota) return MAX_EXERCISE_IMAGE_ENTRIES
    if (estimate.usage / estimate.quota < LOW_STORAGE_RATIO) return MAX_EXERCISE_IMAGE_ENTRIES
    return Math.ceil(MAX_EXERCISE_IMAGE_ENTRIES / 2)
  } catch {
    return MAX_EXERCISE_IMAGE_ENTRIES
  }
}

async function trimExerciseImages() {
  const cache = await caches.open(EXERCISE_IMAGE_CACHE)
  const [budget, keep] = await Promise.all([exerciseImageBudget(), protectedExercisePaths(cache)])
  await trim(EXERCISE_IMAGE_CACHE, budget, keep)
}

// Cache-first: o path inclui a versão, então o conteúdo de uma URL nunca muda. A requisição do <img>
// é no-cors (resposta opaca, que não dá para validar); refazemos com CORS (o bucket público responde
// com Access-Control-Allow-Origin) para só guardar uma imagem WebP de verdade. Offline sem cache: a
// promessa rejeita e o <img> cai no placeholder (ExerciseCatalogImage) -- o treino nunca é bloqueado.
async function exerciseImageStrategy(request) {
  const cache = await caches.open(EXERCISE_IMAGE_CACHE)
  const cached = await cache.match(request.url, { ignoreVary: true })
  if (cached) return cached
  const response = await fetch(new Request(request.url, { mode: 'cors', credentials: 'omit' }))
  if (isCacheableExerciseImage(response)) {
    await cache.put(request.url, response.clone())
    trimExerciseImages().catch(() => {})
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method === 'GET' && isExerciseVisualUrl(url)) {
    event.respondWith(exerciseImageStrategy(request))
    return
  }
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Uma página pública estática nunca deve receber o shell autenticado quando
    // a rede falha; isso mostraria a rota errada (ou um 200 offline enganoso).
    if (
      PUBLIC_STATIC_ROUTES.has(url.pathname) ||
      /^\/(?:vitrine|profissionais|locais)\/[0-9a-f-]{36}$/i.test(url.pathname)
    ) {
      event.respondWith(fetch(request))
      return
    }
    // Network-first: um refresh (inclusive hard refresh) deve sempre buscar o shell
    // mais atual quando há conexão. O cache só entra como fallback offline, nunca como fonte
    // primária. O shell do cache é SÓ o do install desta versão (casado com os chunks que o install
    // guardou): regravá-lo com o HTML da rede, que pode ser de um deploy mais novo que este worker,
    // criaria "index novo + chunks que não estão no cache" e o app não abriria offline.
    event.respondWith(
      fetch(request).catch(
        async () =>
          (await caches.open(SHELL_CACHE).then((c) => c.match('/app-shell.html'))) ||
          Response.error()
      )
    )
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(assetStrategy(request))
  } else if (url.pathname.startsWith('/img/')) {
    event.respondWith(imageStrategy(request))
  } else if (SHELL_URLS.includes(url.pathname)) {
    // Manifest e ícones: sem hash no nome, mas versionados junto com o shell.
    event.respondWith(
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((response) => response || fetch(request))
    )
  }
})

function safeNotificationTarget(value) {
  // Só caminho interno: sem "//", "\\" (o navegador a trata como "/"), espaço nem caracteres de controle
  // (tab/nova linha são removidos de URLs: "/<TAB>/host" viraria "//host").
  if (
    typeof value !== 'string' ||
    value.length > 300 ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\')
  )
    return '/'
  if (
    [...value].some((character) => {
      const code = character.charCodeAt(0)
      return code <= 32 || (code >= 127 && code <= 159) || code === 0x2028 || code === 0x2029
    })
  )
    return '/'
  return value
}

// ACK de telemetria: melhor esforço, NUNCA rejeita e nunca é aguardado antes de mostrar a
// notificação. O token é o identificador opaco da entrega (vem no payload criptografado); o servidor
// grava o relógio dele. Falha de rede, resposta de erro ou lentidão (abortada em ACK_TIMEOUT_MS) são
// ignoradas: a notificação não depende disto.
function sendDeliveryAck(token, eventName, failure) {
  try {
    if (
      !PUSH_ACK_URL ||
      !PUSH_ACK_KEY ||
      typeof token !== 'string' ||
      !ACK_TOKEN_PATTERN.test(token)
    ) {
      return Promise.resolve()
    }
    const controller = typeof AbortController === 'function' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), ACK_TIMEOUT_MS) : null
    const body = { p_token: token, p_event: eventName }
    if (failure) body.p_failure = failure
    return Promise.resolve(
      fetch(PUSH_ACK_URL, {
        method: 'POST',
        headers: {
          apikey: PUSH_ACK_KEY,
          Authorization: `Bearer ${PUSH_ACK_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        keepalive: true,
        cache: 'no-store',
        credentials: 'omit',
        signal: controller ? controller.signal : undefined,
      })
    )
      .then(
        () => undefined,
        () => undefined
      )
      .then(() => {
        if (timer) clearTimeout(timer)
      })
  } catch {
    return Promise.resolve()
  }
}

// Só o NOME do erro (letras), nunca a mensagem: nada de texto livre na telemetria.
function failureName(error) {
  const name = String((error && error.name) || '')
    .replace(/[^A-Za-z]/g, '')
    .slice(0, 40)
  return name || 'Error'
}

self.addEventListener('push', (event) => {
  event.waitUntil(
    (async () => {
      let payload = {}
      try {
        payload = event.data?.json() || {}
      } catch {
        payload = {}
      }
      const title =
        typeof payload.title === 'string' && payload.title.trim()
          ? payload.title.slice(0, 120)
          : 'Evolutus'
      const body =
        typeof payload.body === 'string' && payload.body.trim()
          ? payload.body.slice(0, 240)
          : 'Você recebeu uma nova notificação.'
      // `tag` do servidor agrupa rajadas (curtidas/alertas): o Push novo SUBSTITUI o anterior no aparelho
      // e `renotify` ainda avisa. Só aceita um formato conservador; qualquer outra coisa é ignorada.
      const groupTag =
        typeof payload.tag === 'string' && /^[A-Za-z0-9:_-]{1,64}$/.test(payload.tag)
          ? payload.tag
          : null
      const ackToken =
        typeof payload.ack === 'string' && ACK_TOKEN_PATTERN.test(payload.ack) ? payload.ack : null
      // Ordem: o ACK de "recebido" só DISPARA a requisição (sem aguardar) e a notificação é mostrada
      // em seguida; o ACK de "exibido" vai depois de showNotification() resolver.
      const acks = [sendDeliveryAck(ackToken, 'received')]
      let showError = null
      try {
        await self.registration.showNotification(title, {
          body,
          icon: '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag:
            groupTag ||
            (payload.notificationId ? `notification-${String(payload.notificationId)}` : undefined),
          renotify: Boolean(groupTag),
          data: {
            notificationId: payload.notificationId ? String(payload.notificationId) : null,
            targetUrl: safeNotificationTarget(payload.targetUrl),
            ack: ackToken,
          },
        })
      } catch (error) {
        showError = error
      }
      acks.push(
        showError
          ? sendDeliveryAck(ackToken, 'show_failed', failureName(showError))
          : sendDeliveryAck(ackToken, 'shown')
      )
      await Promise.all(acks)
      // Mesmo comportamento de antes: se a exibição falhou, a falha continua visível ao navegador.
      if (showError) throw showError
    })()
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = safeNotificationTarget(event.notification.data?.targetUrl)
  const clickAck = event.notification.data?.ack
  const navigation = (async () => {
    let target = new URL(targetUrl, self.location.origin)
    // Defesa em profundidade: mesmo após a sanitização, nunca navega para outra origem.
    if (target.origin !== self.location.origin) target = new URL('/', self.location.origin)
    const href = target.href
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin)
    if (existing) {
      // 1) Navega ANTES de focar: focus() consome a permissão de interação do clique, e sem ela o
      //    fallback openWindow() seria recusado, deixando só a aba antiga em foco (sem a rota).
      let navigated = null
      if ('navigate' in existing) {
        try {
          navigated = await existing.navigate(href)
        } catch {
          navigated = null
        }
      }
      if (navigated) {
        try {
          await navigated.focus()
        } catch {
          /* navegou; focar é só conforto */
        }
        return
      }
      // 2) Cliente não controlado (navigate indisponível/recusado): abre direto na rota.
      try {
        await self.clients.openWindow(href)
        return
      } catch {
        /* sem permissão para abrir: ao menos traz o app para frente */
      }
      try {
        await existing.focus()
      } catch {
        /* nada mais a fazer */
      }
      return
    }
    await self.clients.openWindow(href)
  })()
  // Telemetria do clique em paralelo à navegação (não a atrasa nem depende dela; nunca rejeita).
  event.waitUntil(Promise.all([navigation, sendDeliveryAck(clickAck, 'clicked')]))
})
