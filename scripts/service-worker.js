const CACHE = 'treinos-shell-__VERSION__'
const ASSETS = __ASSETS__ // eslint-disable-line no-undef
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)))
})
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
  // Keep earlier versions for open tabs with unsaved forms and their lazy-loaded chunks.
})
self.addEventListener('message', (event) => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting()
})
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return
  // Firebase/auth/API requests are never cached by this worker.
  if (event.request.mode === 'navigate' && !url.pathname.startsWith('/__/')) {
    event.respondWith(
      caches
        .open(CACHE)
        .then((cache) => cache.match('/index.html'))
        .then((response) => response || fetch(event.request))
    )
  } else if (ASSETS.includes(url.pathname)) {
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
