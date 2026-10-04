import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { collectBootAssets } from '../../scripts/pwa-plugin.js'

const TEMPLATE = readFileSync(new URL('../../scripts/service-worker.js', import.meta.url), 'utf8')
const ORIGIN = 'https://app.test'
const SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png']
const BOOT = ['/assets/index-aaa.js', '/assets/index-aaa.css']

const urlOf = (input) => (typeof input === 'string' ? new URL(input, ORIGIN).href : input.url)

function fakeCaches() {
  const stores = new Map()
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    return {
      match: async (request) => store.get(urlOf(request))?.clone(),
      put: async (request, response) => void store.set(urlOf(request), response),
      keys: async () => [...store.keys()].map((url) => new Request(url)),
      delete: async (request) => store.delete(urlOf(request)),
      add: async (request) => void store.set(urlOf(request), await globalThis.__fetch(request)),
      addAll: async (requests) => {
        for (const request of requests) store.set(urlOf(request), await globalThis.__fetch(request))
      },
    }
  }
  return {
    stores,
    open,
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  }
}

let sw
let network // log de URLs buscadas na rede
let handlers
let offline

// Respostas de fetch() same-origin têm type 'basic' (o construtor de Response cria 'default').
const basic = (body, init) => {
  const response = new Response(body, init)
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}
// Request relativo dentro de um service worker resolve contra a URL do próprio worker.
class WorkerRequest extends Request {
  constructor(input, init) {
    super(typeof input === 'string' ? new URL(input, ORIGIN).href : input, init)
  }
}

function load({ responder } = {}) {
  network = []
  handlers = {}
  offline = false
  const caches = fakeCaches()
  const fetchStub = async (input) => {
    const url = urlOf(input)
    if (offline) throw new TypeError('offline')
    network.push(new URL(url).pathname)
    return responder ? responder(url) : basic('ok', { status: 200 })
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: async () => (self.skipped = true),
    registration: {
      showNotification: async (title, options) => { self.shownNotification = { title, options } },
    },
    clients: {
      claim: async () => (self.claimed = true),
      matchAll: async () => self.windowClients || [],
      openWindow: async (url) => { self.openedWindow = url },
    },
  }
  const source = TEMPLATE.replace('__VERSION__', 'v2')
    .replace('__SHELL_URLS__', JSON.stringify(SHELL))
    .replace('__BOOT_ASSETS__', JSON.stringify(BOOT))
  globalThis.__fetch = fetchStub
  vm.runInNewContext(source, {
    self,
    caches,
    fetch: fetchStub,
    Request: WorkerRequest,
    Response,
    Headers,
    URL,
    Date,
    Promise,
    Math,
    Number,
    Infinity,
  })
  sw = { self, caches }
}

async function lifecycle(type) {
  let work
  handlers[type]({ waitUntil: (promise) => (work = promise) })
  await work
}

async function dispatchFetch(request) {
  let responded
  handlers.fetch({ request, respondWith: (promise) => (responded = promise) })
  return responded ? { handled: true, response: await responded } : { handled: false }
}

const get = (path, init) => new Request(`${ORIGIN}${path}`, init)
const navigation = (path) => {
  const request = get(path)
  Object.defineProperty(request, 'mode', { value: 'navigate' })
  return request
}

beforeEach(() => load())

test('install guarda só o shell e o JS/CSS de boot (nenhum chunk de tela) e ativa na hora', async () => {
  await lifecycle('install')
  assert.deepEqual([...network].sort(), [...SHELL, ...BOOT].sort())
  assert.equal(sw.self.skipped, true)
  const shell = [...sw.caches.stores.get('treinos-shell-v2').keys()].map((u) => new URL(u).pathname)
  assert.deepEqual(shell.sort(), [...SHELL].sort())
  assert.equal(sw.caches.stores.get('treinos-assets-v1').size, BOOT.length)
})

test('activate remove shells antigos mas preserva caches de assets/imagens e de terceiros', async () => {
  await sw.caches.open('treinos-shell-v1')
  await sw.caches.open('treinos-shell-v2')
  await sw.caches.open('treinos-assets-v1')
  await sw.caches.open('treinos-images-v1')
  await sw.caches.open('outro-app')
  await lifecycle('activate')
  assert.deepEqual((await sw.caches.keys()).sort(), [
    'outro-app',
    'treinos-assets-v1',
    'treinos-images-v1',
    'treinos-shell-v2',
  ])
  assert.equal(sw.self.claimed, true)
})

test('não intercepta outra origem (Supabase) nem métodos diferentes de GET', async () => {
  const supabase = new Request('https://abc.supabase.co/rest/v1/users?select=*')
  assert.equal((await dispatchFetch(supabase)).handled, false)
  assert.equal(
    (await dispatchFetch(get('/assets/x.js', { method: 'POST', body: 'a' }))).handled,
    false
  )
  assert.equal((await dispatchFetch(get('/api/qualquer'))).handled, false)
  assert.deepEqual(network, [])
  assert.equal(sw.caches.stores.size, 0)
})

test('assets com hash: rede na primeira vez, cache nas seguintes', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await dispatchFetch(get('/assets/Admin-1.js'))
  await dispatchFetch(get('/assets/Admin-1.js'))
  assert.deepEqual(network, ['/assets/Admin-1.js'])
})

test('não guarda 404, erro nem HTML do fallback SPA como se fosse um asset', async () => {
  load({ responder: () => basic('<html>', { headers: { 'content-type': 'text/html' } }) })
  await dispatchFetch(get('/assets/sumiu.js'))
  load({ responder: () => basic('nope', { status: 404 }) })
  await dispatchFetch(get('/assets/sumiu2.js'))
  assert.equal(sw.caches.stores.get('treinos-assets-v1')?.size ?? 0, 0)
})

test('cache de assets tem teto: descarta os mais antigos', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  for (let i = 0; i < 125; i++) await dispatchFetch(get(`/assets/c${i}.js`))
  await lifecycle('activate')
  const urls = [...sw.caches.stores.get('treinos-assets-v1').keys()]
  assert.equal(urls.length, 120)
  assert.ok(!urls.some((url) => url.endsWith('/assets/c0.js')))
  assert.ok(urls.some((url) => url.endsWith('/assets/c124.js')))
})

test('imagens: cache-first, e expiradas são buscadas de novo', async () => {
  load({ responder: () => basic('img', { headers: { 'content-type': 'image/avif' } }) })
  await dispatchFetch(get('/img/capa-800.avif'))
  await dispatchFetch(get('/img/capa-800.avif'))
  assert.equal(network.length, 1)
  const store = sw.caches.stores.get('treinos-images-v1')
  const [key, cached] = [...store.entries()][0]
  const headers = new Headers(cached.headers)
  headers.set('x-sw-cached-at', String(Date.now() - 40 * 24 * 60 * 60 * 1000))
  store.set(key, basic('img', { headers }))
  await dispatchFetch(get('/img/capa-800.avif'))
  assert.equal(network.length, 2)
})

test('navegação: rede primeiro; offline cai no index.html em cache; sem cache, erro de rede', async () => {
  load({
    responder: () => basic('<html>shell</html>', { headers: { 'content-type': 'text/html' } }),
  })
  offline = true
  const first = await dispatchFetch(navigation('/perfil'))
  assert.equal(first.response.type, 'error')

  offline = false
  const online = await dispatchFetch(navigation('/comunidades/123'))
  assert.equal(await online.response.text(), '<html>shell</html>')
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.ok(sw.caches.stores.get('treinos-shell-v2').has(`${ORIGIN}/index.html`))

  offline = true
  const fallback = await dispatchFetch(navigation('/comunidades/123'))
  assert.equal(await fallback.response.text(), '<html>shell</html>')
})

test('collectBootAssets inclui entry + imports estáticos + CSS, e exclui chunks dinâmicos', () => {
  const bundle = {
    'assets/index.js': {
      type: 'chunk',
      fileName: 'assets/index.js',
      isEntry: true,
      imports: ['assets/primer.js'],
      dynamicImports: ['assets/Admin.js'],
      viteMetadata: { importedCss: new Set(['assets/index.css']) },
    },
    'assets/primer.js': {
      type: 'chunk',
      fileName: 'assets/primer.js',
      isEntry: false,
      imports: [],
      viteMetadata: { importedCss: new Set(['assets/primer.css']) },
    },
    'assets/Admin.js': {
      type: 'chunk',
      fileName: 'assets/Admin.js',
      isEntry: false,
      imports: ['assets/primer.js'],
      viteMetadata: { importedCss: new Set() },
    },
    'index.html': { type: 'asset', fileName: 'index.html' },
  }
  assert.deepEqual(collectBootAssets(bundle), [
    '/assets/index.css',
    '/assets/index.js',
    '/assets/primer.css',
    '/assets/primer.js',
  ])
})

test('push valida payload e usa fallback sem depender do React', async () => {
  let work
  handlers.push({
    data: { json: () => ({ title: 'Aviso', body: 'Corpo', notificationId: 7, targetUrl: 'https://evil.test' }) },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.shownNotification.title, 'Aviso')
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
  assert.equal(sw.self.shownNotification.options.tag, 'notification-7')
})

test('push com payload inválido não quebra e exibe fallback seguro', async () => {
  let work
  handlers.push({
    data: { json: () => { throw new SyntaxError('invalid json') } },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.shownNotification.title, 'Evolutus')
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
})

test('notificationclick foca janela existente e navega somente dentro da origem', async () => {
  const navigated = []
  sw.self.windowClients = [{
    url: `${ORIGIN}/perfil`,
    focus: async () => { sw.self.focused = true },
    navigate: async (url) => navigated.push(url),
  }]
  let work
  let closed = false
  handlers.notificationclick({
    notification: { data: { targetUrl: '/comunidades/1' }, close: () => { closed = true } },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(closed, true)
  assert.equal(sw.self.focused, true)
  assert.deepEqual(navigated, [`${ORIGIN}/comunidades/1`])
})

test('notificationclick abre janela quando não há cliente existente', async () => {
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: '//evil.test' }, close() {} },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.openedWindow, `${ORIGIN}/`)
})
