const CACHE = 'treinos-shell-__VERSION__'
const ASSETS = __ASSETS__ // eslint-disable-line no-undef

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      // A install que não ativa sozinha é a causa raiz da tela branca pós-deploy: uma
      // aba que só faz hard refresh (sem fechar todas as abas) nunca via a versão nova,
      // e ficava presa servindo um index.html antigo apontando para chunks já removidos
      // do servidor. Ativar assim que instalar garante que a PRÓXIMA navegação (F5
      // incluso) sempre carregue de forma consistente.
      .then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Sem isso, cada deploy deixava a versão anterior no Cache Storage para sempre —
      // nesta sessão sozinha foram dezenas de deploys. Como a navegação agora é
      // network-first (abaixo), não há mais razão para preservar versões antigas.
      caches
        .keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
    ])
  )
})

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Firebase/auth/API requests are never cached by this worker.
  if (event.request.mode === 'navigate' && !url.pathname.startsWith('/__/')) {
    // Network-first: um refresh (inclusive hard refresh) deve sempre buscar o shell
    // mais atual quando há conexão. O cache só entra como fallback offline (cenário
    // coberto pelo pwa-offline em PwaControls), nunca como fonte primária.
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.open(CACHE).then((cache) => cache.match('/index.html')))
    )
  } else if (ASSETS.includes(url.pathname)) {
    // Assets com hash de conteúdo no nome são imutáveis: cache-first é seguro e nunca
    // fica desatualizado (um build novo gera um nome de arquivo novo).
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match(url.pathname))
        .then((response) => response || fetch(event.request))
    )
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(event.request).then((response) => response || fetch(event.request))
    )
  }
})
