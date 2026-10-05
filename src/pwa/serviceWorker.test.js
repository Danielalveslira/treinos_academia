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

test('notificationclick navega a janela existente para a rota e só então foca', async () => {
  const calls = []
  sw.self.openedWindow = null
  const navigatedClient = { focus: async () => { calls.push('focus') } }
  sw.self.windowClients = [{
    url: `${ORIGIN}/perfil`,
    focus: async () => { calls.push('focus-original') },
    navigate: async (url) => { calls.push(`navigate:${url}`); return navigatedClient },
  }]
  let work
  let closed = false
  handlers.notificationclick({
    notification: { data: { targetUrl: '/comunidades/1' }, close: () => { closed = true } },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(closed, true)
  assert.deepEqual(calls, [`navigate:${ORIGIN}/comunidades/1`, 'focus'])
  assert.equal(sw.self.openedWindow, null)
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

test('push rejeita targetUrl com barra invertida (equivale a // no navegador)', async () => {
  let work
  handlers.push({
    data: { json: () => ({ title: 'Aviso', targetUrl: '/\\evil.test' }) },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
  assert.equal(sw.self.shownNotification.options.body, 'Você recebeu uma nova notificação.')
})

test('notificationclick abre nova janela quando navigate falha no cliente existente', async () => {
  sw.self.openedWindow = null
  sw.self.windowClients = [{
    url: `${ORIGIN}/perfil`,
    focus: async () => {},
    navigate: async () => { throw new TypeError('not a controlled client') },
  }]
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: '/notificacoes' }, close() {} },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.openedWindow, `${ORIGIN}/notificacoes`)
})

test('notificationclick ignora janela de outra origem e nunca abre URL externa', async () => {
  sw.self.openedWindow = null
  sw.self.windowClients = [{ url: 'https://evil.test/', focus: async () => { throw new Error('não deve focar') } }]
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: '/\\evil.test' }, close() {} },
    waitUntil: (promise) => { work = promise },
  })
  await work
  assert.equal(sw.self.openedWindow, `${ORIGIN}/`)
  sw.self.windowClients = []
})

// Comportamento real de Chromium/Firefox: focus() consome a permissão de interação do clique e,
// depois dele, openWindow() é recusado ("Not allowed to open a window").
function clickWithFocusConsumingActivation({ navigate }) {
  const state = { focused: false, opened: null, openError: null }
  sw.self.openedWindow = null
  sw.self.clients.openWindow = async (url) => {
    if (state.focused) { state.openError = new Error('Not allowed to open a window'); throw state.openError }
    state.opened = url
    sw.self.openedWindow = url
  }
  const client = {
    url: `${ORIGIN}/`,
    focus: async () => { state.focused = true },
    ...(navigate ? { navigate } : {}),
  }
  sw.self.windowClients = [client]
  return state
}

async function click(targetUrl) {
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl }, close() {} },
    waitUntil: (promise) => { work = promise },
  })
  await work
}

test('notificationclick: navigate recusado (cliente não controlado) abre a rota ANTES de focar', async () => {
  const state = clickWithFocusConsumingActivation({ navigate: async () => { throw new TypeError('not controlled') } })
  await click('/perfil')
  assert.equal(state.opened, `${ORIGIN}/perfil`)
  assert.equal(state.openError, null)
  assert.equal(state.focused, false)
})

test('notificationclick: navigate indisponível ou resolvendo null também abre a rota', async () => {
  let state = clickWithFocusConsumingActivation({})
  await click('/perfil')
  assert.equal(state.opened, `${ORIGIN}/perfil`)
  state = clickWithFocusConsumingActivation({ navigate: async () => null })
  await click('/perfil')
  assert.equal(state.opened, `${ORIGIN}/perfil`)
})

test('notificationclick: sem permissão para abrir janela ao menos foca o app e não quebra', async () => {
  const state = clickWithFocusConsumingActivation({ navigate: async () => { throw new TypeError('x') } })
  sw.self.clients.openWindow = async () => { throw new Error('Not allowed to open a window') }
  await click('/perfil')
  assert.equal(state.focused, true)
})

test('notificationclick: sem janela existente abre direto a rota do payload', async () => {
  sw.self.windowClients = []
  sw.self.openedWindow = null
  sw.self.clients.openWindow = async (url) => { sw.self.openedWindow = url }
  await click('/perfil')
  assert.equal(sw.self.openedWindow, `${ORIGIN}/perfil`)
})

test('push com o app FECHADO (nenhuma janela) mostra a notificação com ícone/badge do Evolutus, sem tocar em clientes', async () => {
  sw.self.windowClients = []
  let matchAllCalls = 0
  const originalMatchAll = sw.self.clients.matchAll
  sw.self.clients.matchAll = async () => { matchAllCalls += 1; return [] }
  let work
  handlers.push({
    data: { json: () => ({ title: '@ana: nova curtida', body: 'Alguém curtiu sua publicação.', notificationId: 41, targetUrl: '/comunidades/c1#publicacao-p1', icon: 'https://evil.test/x.png' }) },
    waitUntil: (promise) => { work = promise },
  })
  await work
  sw.self.clients.matchAll = originalMatchAll
  const { title, options } = sw.self.shownNotification
  assert.equal(title, '@ana: nova curtida')
  assert.equal(options.body, 'Alguém curtiu sua publicação.')
  assert.equal(options.icon, '/icons/icon-192.png', 'ícone vem do app, nunca do payload')
  assert.equal(options.badge, '/icons/icon-192.png')
  assert.equal(options.data.targetUrl, '/comunidades/c1#publicacao-p1', 'âncora da publicação preservada')
  assert.equal(matchAllCalls, 0, 'mostrar o Push não depende de janela/React')
})

test('clique com a âncora da publicação: navega a janela existente para o card exato', async () => {
  const navigated = []
  sw.self.openedWindow = null
  sw.self.windowClients = [{
    url: `${ORIGIN}/`,
    focus: async () => {},
    navigate: async (url) => { navigated.push(url); return { focus: async () => {} } },
  }]
  await click('/comunidades/c1#publicacao-p1')
  assert.deepEqual(navigated, [`${ORIGIN}/comunidades/c1#publicacao-p1`])
  assert.equal(sw.self.openedWindow, null)
})

test('clique sem janela abre direto o deep link com âncora', async () => {
  sw.self.windowClients = []
  sw.self.openedWindow = null
  sw.self.clients.openWindow = async (url) => { sw.self.openedWindow = url }
  await click('/comunidades/c1#treino-w1')
  assert.equal(sw.self.openedWindow, `${ORIGIN}/comunidades/c1#treino-w1`)
})
