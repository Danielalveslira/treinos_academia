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
//  - NUNCA interceptado: qualquer origem diferente da própria (Supabase Auth/REST/RPC/Realtime/
//    Storage, tokens, respostas autenticadas) e qualquer método diferente de GET. O Supabase é a
//    única fonte de verdade; nada dele é guardado aqui.
const VERSION = '__VERSION__'
const SHELL_CACHE = `treinos-shell-${VERSION}`
const ASSET_CACHE = 'treinos-assets-v1'
const IMAGE_CACHE = 'treinos-images-v1'
const SHELL_URLS = __SHELL_URLS__ // eslint-disable-line no-undef
const BOOT_ASSETS = __BOOT_ASSETS__ // eslint-disable-line no-undef

const MAX_ASSET_ENTRIES = 120
const MAX_IMAGE_ENTRIES = 40
const IMAGE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const CACHED_AT_HEADER = 'x-sw-cached-at'

// Os caches deste worker compartilham o prefixo; só eles são limpos (nada de apagar caches
// de terceiros da mesma origem).
const OWNED_PREFIX = 'treinos-'
const CURRENT_CACHES = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(SHELL_CACHE)
      await shell.addAll(SHELL_URLS.map((url) => new Request(url, { cache: 'reload' })))
      const assets = await caches.open(ASSET_CACHE)
      await Promise.all(
        BOOT_ASSETS.map(async (url) => {
          if (!(await assets.match(url))) await assets.add(url)
        })
      )
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
      await Promise.all([
        trim(ASSET_CACHE, MAX_ASSET_ENTRIES),
        trim(IMAGE_CACHE, MAX_IMAGE_ENTRIES),
      ])
    })()
  )
})

// Mantém só as `max` entradas mais recentes (cache.keys() devolve na ordem de inserção).
async function trim(name, max) {
  const cache = await caches.open(name)
  const keys = await cache.keys()
  await Promise.all(keys.slice(0, Math.max(0, keys.length - max)).map((key) => cache.delete(key)))
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
  const cached = await cache.match(request)
  if (cached) return cached
  const response = await fetch(request)
  if (isCacheableAsset(response)) {
    await cache.put(request, response.clone())
    trim(ASSET_CACHE, MAX_ASSET_ENTRIES).catch(() => {})
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
  const cached = await cache.match(request)
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

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    // Network-first: um refresh (inclusive hard refresh) deve sempre buscar o shell
    // mais atual quando há conexão. O cache só entra como fallback offline (cenário
    // coberto pelo pwa-offline em PwaControls), nunca como fonte primária.
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy))
          }
          return response
        })
        .catch(
          async () =>
            (await caches.open(SHELL_CACHE).then((c) => c.match('/index.html'))) || Response.error()
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
  // "\" vira "/" nos navegadores: "/\host" equivale a "//host" (open redirect).
  if (
    typeof value !== 'string' || value.length > 300 || !value.startsWith('/') ||
    value.startsWith('//') || value.includes('\\')
  ) return '/'
  if ([...value].some((character) => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127
  })) return '/'
  return value
}

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let payload = {}
    try { payload = event.data?.json() || {} } catch { payload = {} }
    const title = typeof payload.title === 'string' && payload.title.trim()
      ? payload.title.slice(0, 120)
      : 'Evolutus'
    const body = typeof payload.body === 'string' && payload.body.trim()
      ? payload.body.slice(0, 240)
      : 'Você recebeu uma nova notificação.'
    await self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: payload.notificationId ? `notification-${String(payload.notificationId)}` : undefined,
      data: {
        notificationId: payload.notificationId ? String(payload.notificationId) : null,
        targetUrl: safeNotificationTarget(payload.targetUrl),
      },
    })
  })())
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = safeNotificationTarget(event.notification.data?.targetUrl)
  event.waitUntil((async () => {
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
        try { navigated = await existing.navigate(href) } catch { navigated = null }
      }
      if (navigated) {
        try { await navigated.focus() } catch { /* navegou; focar é só conforto */ }
        return
      }
      // 2) Cliente não controlado (navigate indisponível/recusado): abre direto na rota.
      try {
        await self.clients.openWindow(href)
        return
      } catch { /* sem permissão para abrir: ao menos traz o app para frente */ }
      try { await existing.focus() } catch { /* nada mais a fazer */ }
      return
    }
    await self.clients.openWindow(href)
  })())
})
