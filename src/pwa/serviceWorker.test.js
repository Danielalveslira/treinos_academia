import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { setImmediate } from 'node:timers'
import { collectBootAssets, collectOfflineAssets, exerciseVisualsPrefix, pushAckConfig } from '../../scripts/pwa-plugin.js'

const TEMPLATE = readFileSync(new URL('../../scripts/service-worker.js', import.meta.url), 'utf8')
const ORIGIN = 'https://app.test'
const SHELL = ['/index.html', '/manifest.webmanifest', '/icons/icon-192.png']
const BOOT = ['/assets/index-aaa.js', '/assets/index-aaa.css']
const OFFLINE = ['/assets/Dashboard-bbb.js', '/assets/ExerciseDetail-ccc.js', '/assets/WorkoutForm-ddd.css']
const CORE = [...BOOT, ...OFFLINE]

const urlOf = (input) => (typeof input === 'string' ? new URL(input, ORIGIN).href : input.url)

function fakeCaches() {
  const stores = new Map()
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)
    return {
      match: async (request, options) => {
        const entry = store.get(urlOf(request))
        if (
          entry?.headers.get('vary')?.toLowerCase().includes('origin') &&
          !options?.ignoreVary &&
          request?.headers?.has('origin')
        )
          return undefined
        return entry?.clone()
      },
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
let requests // as Requests completas (modo/credenciais) buscadas na rede
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

const ACK_URL = 'https://proj.supabase.co/rest/v1/rpc/push_delivery_ack'
const VISUALS_PREFIX = 'https://proj.supabase.co/storage/v1/object/public/exercise-visuals/'
const ACK_KEY = 'public-anon-key'
let timers // setTimeout falso: os testes disparam o tempo manualmente
let ackHandler = () => Promise.resolve(new Response('', { status: 204 }))

function load({ responder, ack = { url: ACK_URL, key: ACK_KEY }, visuals = VISUALS_PREFIX } = {}) {
  timers = []
  network = []
  requests = []
  handlers = {}
  offline = false
  const caches = fakeCaches()
  const fetchStub = (input, init) => {
    const url = urlOf(input)
    if (url === ACK_URL) return ackHandler(init)
    return plainFetch(input, url)
  }
  const plainFetch = async (input, url) => {
    if (offline) throw new TypeError('offline')
    network.push(new URL(url).pathname)
    requests.push(input)
    return responder ? responder(url) : basic('ok', { status: 200 })
  }
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: async () => (self.skipped = true),
    registration: {
      showNotification: async (title, options) => {
        self.shownNotification = { title, options }
      },
    },
    clients: {
      claim: async () => (self.claimed = true),
      matchAll: async () => self.windowClients || [],
      openWindow: async (url) => {
        self.openedWindow = url
      },
    },
  }
  const source = TEMPLATE.replace('__VERSION__', 'v2')
    .replace('__SHELL_URLS__', JSON.stringify(SHELL))
    .replace('__BOOT_ASSETS__', JSON.stringify(BOOT))
    .replace('__OFFLINE_ASSETS__', JSON.stringify(OFFLINE))
    .replace('__PUSH_ACK_URL__', JSON.stringify(ack.url))
    .replace('__PUSH_ACK_KEY__', JSON.stringify(ack.key))
    .replace('__EXERCISE_VISUALS_PREFIX__', JSON.stringify(visuals))
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
    AbortController,
    setTimeout: (fn) => {
      timers.push(fn)
      return timers.length
    },
    clearTimeout: () => {},
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

test('install guarda o shell, o boot e SÓ as telas offline essenciais (nenhuma outra) e ativa na hora', async () => {
  await lifecycle('install')
  assert.deepEqual([...network].sort(), [...SHELL, ...CORE].sort())
  assert.equal(sw.self.skipped, true)
  const shell = [...sw.caches.stores.get('treinos-shell-v2').keys()].map((u) => new URL(u).pathname)
  assert.deepEqual(shell.sort(), [...SHELL].sort())
  assert.equal(sw.caches.stores.get('treinos-assets-v1').size, CORE.length)
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
    'treinos-exercise-images-v1',
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

test('precache com Vary: Origin serve JS/CSS offline quando o navegador envia Origin no import', async () => {
  load({
    responder: () =>
      basic('js', { headers: { 'content-type': 'text/javascript', vary: 'Origin' } }),
  })
  await lifecycle('install')
  offline = true
  const response = await dispatchFetch(get('/assets/index-aaa.js', { headers: { origin: ORIGIN } }))
  assert.equal(response.response && (await response.response.text()), 'js')
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

test('cache cheio: chunks de boot (os mais antigos) NÃO são expulsos pelo teto', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await lifecycle('install') // boot entra primeiro => são as entradas mais antigas
  for (let i = 0; i < 200; i++) await dispatchFetch(get(`/assets/rota${i}.js`))
  await lifecycle('activate')
  const urls = [...sw.caches.stores.get('treinos-assets-v1').keys()].map((u) => new URL(u).pathname)
  for (const boot of BOOT) assert.ok(urls.includes(boot), `${boot} foi expulso`)
  assert.equal(urls.length, 120)
  assert.ok(!urls.includes('/assets/rota0.js'))
  assert.ok(urls.includes('/assets/rota199.js'))
  // Offline logo depois: o boot abre direto do cache.
  offline = true
  const response = await dispatchFetch(get(BOOT[0]))
  assert.equal(await response.response.text(), 'js')
})

test('activate repõe chunk de boot que já tinha sido expulso (com rede) e a poda o preserva', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  const assets = await sw.caches.open('treinos-assets-v1')
  for (let i = 0; i < 125; i++) await assets.put(`${ORIGIN}/assets/x${i}.js`, basic('x'))
  await lifecycle('activate')
  const urls = [...sw.caches.stores.get('treinos-assets-v1').keys()].map((u) => new URL(u).pathname)
  for (const boot of BOOT) assert.ok(urls.includes(boot), `${boot} não foi reposto`)
  assert.equal(urls.length, 120)
})

test('activate sem rede não falha nem apaga o boot que existe', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await lifecycle('install')
  offline = true
  await lifecycle('activate')
  assert.equal(sw.self.claimed, true)
  assert.equal(sw.caches.stores.get('treinos-assets-v1').size, CORE.length)
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
    responder: (url) =>
      url.includes('/assets/')
        ? basic('js', { headers: { 'content-type': 'text/javascript' } })
        : basic('<html>shell</html>', { headers: { 'content-type': 'text/html' } }),
  })
  offline = true
  const first = await dispatchFetch(navigation('/perfil'))
  assert.equal(first.response.type, 'error')

  offline = false
  const online = await dispatchFetch(navigation('/comunidades/123'))
  assert.equal(await online.response.text(), '<html>shell</html>')
  await new Promise((resolve) => setTimeout(resolve, 0))
  // A rede NÃO regrava o shell do cache (pode ser de um deploy mais novo que este worker).
  assert.ok(!sw.caches.stores.get('treinos-shell-v2')?.has(`${ORIGIN}/index.html`))

  // O fallback offline é o shell do install, casado com os chunks que o install guardou.
  await lifecycle('install')
  offline = true
  const fallback = await dispatchFetch(navigation('/comunidades/123'))
  assert.equal(await fallback.response.text(), '<html>shell</html>')
})

test('navegação online com HTML mais novo que o worker NÃO contamina o shell offline', async () => {
  let html = '<html>v2</html>'
  load({ responder: (url) => (url.endsWith('/index.html') || !url.includes('/assets/')
    ? basic(html, { headers: { 'content-type': 'text/html' } })
    : basic('js', { headers: { 'content-type': 'text/javascript' } })) })
  await lifecycle('install')
  html = '<html>v3-novo-deploy</html>' // deploy novo publicado depois do install deste worker
  await dispatchFetch(navigation('/'))
  await new Promise((resolve) => setTimeout(resolve, 0))
  offline = true
  const fallback = await dispatchFetch(navigation('/historico'))
  assert.equal(await fallback.response.text(), '<html>v2</html>')
  for (const url of CORE) assert.equal((await dispatchFetch(get(url))).handled, true)
})

test('cold start offline: toda tela essencial + dependências abrem do cache, sem rede', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await lifecycle('install')
  offline = true
  network.length = 0
  for (const url of CORE) {
    const result = await dispatchFetch(get(url, { headers: { origin: ORIGIN } }))
    assert.equal(await result.response.text(), 'js', `${url} não veio do cache`)
  }
  assert.deepEqual(network, [])
})

test('install é atômico: um asset essencial indisponível rejeita o install e descarta o shell parcial', async () => {
  load({
    responder: (url) =>
      url.endsWith('/ExerciseDetail-ccc.js')
        ? basic('nope', { status: 404 })
        : basic('js', { headers: { 'content-type': 'text/javascript' } }),
  })
  await assert.rejects(lifecycle('install'))
  assert.equal(sw.self.skipped, undefined) // não ativa uma versão incompleta
  assert.ok(!sw.caches.stores.has('treinos-shell-v2'))
})

test('install rejeitado com HTML do fallback SPA no lugar de um chunk', async () => {
  load({
    responder: (url) =>
      url.endsWith('/Dashboard-bbb.js')
        ? basic('<html>', { headers: { 'content-type': 'text/html' } })
        : basic('js', { headers: { 'content-type': 'text/javascript' } }),
  })
  await assert.rejects(lifecycle('install'))
})

test('o teto de assets também preserva as telas offline essenciais', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await lifecycle('install')
  for (let i = 0; i < 200; i++) await dispatchFetch(get(`/assets/outra${i}.js`))
  await lifecycle('activate')
  const urls = [...sw.caches.stores.get('treinos-assets-v1').keys()].map((u) => new URL(u).pathname)
  for (const url of CORE) assert.ok(urls.includes(url), `${url} expulso`)
  assert.equal(urls.length, 120)
})

test('build novo (hashes novos): o install repõe o conjunto da nova versão sem apagar a anterior em uso', async () => {
  load({ responder: () => basic('js', { headers: { 'content-type': 'text/javascript' } }) })
  await lifecycle('install')
  const assets = sw.caches.stores.get('treinos-assets-v1')
  const before = [...assets.keys()].length
  assert.equal(before, CORE.length)
  // Segunda versão com os mesmos nomes de vendor: nada é rebaixado, nada se perde.
  await lifecycle('install')
  assert.equal(assets.size, CORE.length)
})

test('collectOfflineAssets: resolve por módulo-fonte (sem hash fixo), segue imports estáticos e exclui boot e dinâmicos', () => {
  const chunk = (fileName, extra = {}) => ({
    type: 'chunk', fileName, imports: [], dynamicImports: [], isEntry: false, ...extra,
  })
  const bundle = {
    'assets/index-9.js': chunk('assets/index-9.js', { isEntry: true }),
    'assets/Dashboard-XYZ.js': chunk('assets/Dashboard-XYZ.js', {
      facadeModuleId: '/repo/src/pages/Dashboard.jsx',
      imports: ['assets/index-9.js', 'assets/shared-7.js'],
      dynamicImports: ['assets/charts-1.js'],
      viteMetadata: { importedCss: new Set(['assets/Dashboard-XYZ.css']) },
    }),
    'assets/ExerciseDetail-QQ.js': chunk('assets/ExerciseDetail-QQ.js', {
      facadeModuleId: '/repo/src/pages/ExerciseDetail.jsx', imports: ['assets/shared-7.js'],
    }),
    'assets/shared-7.js': chunk('assets/shared-7.js'),
    'assets/charts-1.js': chunk('assets/charts-1.js'),
  }
  const assets = collectOfflineAssets(bundle, ['/assets/index-9.js'], [
    'src/pages/Dashboard.jsx', 'src/pages/ExerciseDetail.jsx',
  ])
  assert.deepEqual(assets, [
    '/assets/Dashboard-XYZ.css', '/assets/Dashboard-XYZ.js', '/assets/ExerciseDetail-QQ.js', '/assets/shared-7.js',
  ])
  // Outro build, hashes diferentes: mesma resolução.
  const renamed = JSON.parse(JSON.stringify(bundle).replaceAll('XYZ', 'NEW').replaceAll('QQ', 'ZZ'))
  renamed['assets/Dashboard-NEW.js'].viteMetadata = { importedCss: new Set(['assets/Dashboard-NEW.css']) }
  assert.ok(collectOfflineAssets(renamed, ['/assets/index-9.js'], ['src/pages/ExerciseDetail.jsx'])
    .includes('/assets/ExerciseDetail-ZZ.js'))
  // Módulo essencial renomeado/removido => build falha em vez de quebrar o offline em silêncio.
  assert.throws(() => collectOfflineAssets(bundle, [], ['src/pages/Sumiu.jsx']), /não encontrado/)
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
    data: {
      json: () => ({
        title: 'Aviso',
        body: 'Corpo',
        notificationId: 7,
        targetUrl: 'https://evil.test',
      }),
    },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.shownNotification.title, 'Aviso')
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
  assert.equal(sw.self.shownNotification.options.tag, 'notification-7')
})

test('push com payload inválido não quebra e exibe fallback seguro', async () => {
  let work
  handlers.push({
    data: {
      json: () => {
        throw new SyntaxError('invalid json')
      },
    },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.shownNotification.title, 'Evolutus')
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
})

test('notificationclick navega a janela existente para a rota e só então foca', async () => {
  const calls = []
  sw.self.openedWindow = null
  const navigatedClient = {
    focus: async () => {
      calls.push('focus')
    },
  }
  sw.self.windowClients = [
    {
      url: `${ORIGIN}/perfil`,
      focus: async () => {
        calls.push('focus-original')
      },
      navigate: async (url) => {
        calls.push(`navigate:${url}`)
        return navigatedClient
      },
    },
  ]
  let work
  let closed = false
  handlers.notificationclick({
    notification: {
      data: { targetUrl: '/comunidades/1' },
      close: () => {
        closed = true
      },
    },
    waitUntil: (promise) => {
      work = promise
    },
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
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.openedWindow, `${ORIGIN}/`)
})

test('push rejeita targetUrl com barra invertida (equivale a // no navegador)', async () => {
  let work
  handlers.push({
    data: { json: () => ({ title: 'Aviso', targetUrl: '/\\evil.test' }) },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.shownNotification.options.data.targetUrl, '/')
  assert.equal(sw.self.shownNotification.options.body, 'Você recebeu uma nova notificação.')
})

test('notificationclick abre nova janela quando navigate falha no cliente existente', async () => {
  sw.self.openedWindow = null
  sw.self.windowClients = [
    {
      url: `${ORIGIN}/perfil`,
      focus: async () => {},
      navigate: async () => {
        throw new TypeError('not a controlled client')
      },
    },
  ]
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: '/notificacoes' }, close() {} },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.openedWindow, `${ORIGIN}/notificacoes`)
})

test('notificationclick ignora janela de outra origem e nunca abre URL externa', async () => {
  sw.self.openedWindow = null
  sw.self.windowClients = [
    {
      url: 'https://evil.test/',
      focus: async () => {
        throw new Error('não deve focar')
      },
    },
  ]
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl: '/\\evil.test' }, close() {} },
    waitUntil: (promise) => {
      work = promise
    },
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
    if (state.focused) {
      state.openError = new Error('Not allowed to open a window')
      throw state.openError
    }
    state.opened = url
    sw.self.openedWindow = url
  }
  const client = {
    url: `${ORIGIN}/`,
    focus: async () => {
      state.focused = true
    },
    ...(navigate ? { navigate } : {}),
  }
  sw.self.windowClients = [client]
  return state
}

async function click(targetUrl) {
  let work
  handlers.notificationclick({
    notification: { data: { targetUrl }, close() {} },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
}

test('notificationclick: navigate recusado (cliente não controlado) abre a rota ANTES de focar', async () => {
  const state = clickWithFocusConsumingActivation({
    navigate: async () => {
      throw new TypeError('not controlled')
    },
  })
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
  const state = clickWithFocusConsumingActivation({
    navigate: async () => {
      throw new TypeError('x')
    },
  })
  sw.self.clients.openWindow = async () => {
    throw new Error('Not allowed to open a window')
  }
  await click('/perfil')
  assert.equal(state.focused, true)
})

test('notificationclick: sem janela existente abre direto a rota do payload', async () => {
  sw.self.windowClients = []
  sw.self.openedWindow = null
  sw.self.clients.openWindow = async (url) => {
    sw.self.openedWindow = url
  }
  await click('/perfil')
  assert.equal(sw.self.openedWindow, `${ORIGIN}/perfil`)
})

test('push com o app FECHADO (nenhuma janela) mostra a notificação com ícone/badge do Evolutus, sem tocar em clientes', async () => {
  sw.self.windowClients = []
  let matchAllCalls = 0
  const originalMatchAll = sw.self.clients.matchAll
  sw.self.clients.matchAll = async () => {
    matchAllCalls += 1
    return []
  }
  let work
  handlers.push({
    data: {
      json: () => ({
        title: '@ana: nova curtida',
        body: 'Alguém curtiu sua publicação.',
        notificationId: 41,
        targetUrl: '/comunidades/c1#publicacao-p1',
        icon: 'https://evil.test/x.png',
      }),
    },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  sw.self.clients.matchAll = originalMatchAll
  const { title, options } = sw.self.shownNotification
  assert.equal(title, '@ana: nova curtida')
  assert.equal(options.body, 'Alguém curtiu sua publicação.')
  assert.equal(options.icon, '/icons/icon-192.png', 'ícone vem do app, nunca do payload')
  assert.equal(options.badge, '/icons/icon-192.png')
  assert.equal(
    options.data.targetUrl,
    '/comunidades/c1#publicacao-p1',
    'âncora da publicação preservada'
  )
  assert.equal(matchAllCalls, 0, 'mostrar o Push não depende de janela/React')
})

test('clique com a âncora da publicação: navega a janela existente para o card exato', async () => {
  const navigated = []
  sw.self.openedWindow = null
  sw.self.windowClients = [
    {
      url: `${ORIGIN}/`,
      focus: async () => {},
      navigate: async (url) => {
        navigated.push(url)
        return { focus: async () => {} }
      },
    },
  ]
  await click('/comunidades/c1#publicacao-p1')
  assert.deepEqual(navigated, [`${ORIGIN}/comunidades/c1#publicacao-p1`])
  assert.equal(sw.self.openedWindow, null)
})

test('clique sem janela abre direto o deep link com âncora', async () => {
  sw.self.windowClients = []
  sw.self.openedWindow = null
  sw.self.clients.openWindow = async (url) => {
    sw.self.openedWindow = url
  }
  await click('/comunidades/c1#treino-w1')
  assert.equal(sw.self.openedWindow, `${ORIGIN}/comunidades/c1#treino-w1`)
})

// ---- Contrato de URL: as 3 camadas JS (Central, worker, Service Worker) aplicam a MESMA regra ------
const BAD_URLS = [
  'https://evil.test',
  'http://evil.test',
  '//evil.test',
  '/\\evil.test',
  '/\t/evil.test',
  '/\n/evil.test',
  '/\r/evil.test',
  ' /x',
  '/ x',
  '/x y',
  'javascript:alert(1)',
  'data:text/html,x',
  'vbscript:x',
  '\u0000/x',
  '/\u2028/evil',
  '/\u0085/evil',
  '',
  null,
  undefined,
  123,
  `/${'a'.repeat(300)}`,
]
const GOOD_URLS = [
  '/',
  '/perfil',
  '/comunidades/c#publicacao-p',
  '/novo-treino?planejado=2026-10-06',
  '/comunidades/c/publicacoes/p/comentarios/k',
]

test('contrato de URL: Central, worker e Service Worker rejeitam o mesmo conjunto e aceitam os mesmos caminhos', async () => {
  const { safeActionUrl } = await import('../features/notifications/utils/notifications.js')
  const { safeTargetUrl } =
    await import('../../supabase/functions/process-push-outbox/processor.js')
  for (const url of BAD_URLS) {
    assert.equal(safeActionUrl(url), null, `Central aceitou ${JSON.stringify(url)}`)
    assert.equal(safeTargetUrl(url), '/', `worker aceitou ${JSON.stringify(url)}`)
    let work
    handlers.push({
      data: { json: () => ({ title: 't', targetUrl: url }) },
      waitUntil: (promise) => {
        work = promise
      },
    })
    await work
    assert.equal(
      sw.self.shownNotification.options.data.targetUrl,
      '/',
      `Service Worker aceitou ${JSON.stringify(url)}`
    )
  }
  for (const url of GOOD_URLS) {
    assert.equal(safeActionUrl(url), url)
    assert.equal(safeTargetUrl(url), url)
    let work
    handlers.push({
      data: { json: () => ({ title: 't', targetUrl: url }) },
      waitUntil: (promise) => {
        work = promise
      },
    })
    await work
    assert.equal(sw.self.shownNotification.options.data.targetUrl, url)
  }
})

test('push com `tag` do servidor agrupa e re-notifica; tag inválida é ignorada', async () => {
  let work
  handlers.push({
    data: { json: () => ({ title: 'a', notificationId: 7, tag: 'post_like:1x9z' }) },
    waitUntil: (promise) => {
      work = promise
    },
  })
  await work
  assert.equal(sw.self.shownNotification.options.tag, 'post_like:1x9z')
  assert.equal(sw.self.shownNotification.options.renotify, true)
  for (const tag of ['<script>', 'a b', 'x'.repeat(65), 12, {}, '']) {
    handlers.push({
      data: { json: () => ({ title: 'a', notificationId: 8, tag }) },
      waitUntil: (promise) => {
        work = promise
      },
    })
    await work
    assert.equal(
      sw.self.shownNotification.options.tag,
      'notification-8',
      `aceitou tag ${JSON.stringify(tag)}`
    )
    assert.equal(sw.self.shownNotification.options.renotify, false)
  }
})

// ---- Telemetria da última milha: nunca vira dependência do Push ------------------------------------
const ACK = 'cd'.repeat(32)
let log // ordem dos eventos: show, ack:<evento>
let acks

function arm(mode, options) {
  acks = []
  load(options)
  log = []
  const originalShow = sw.self.registration.showNotification
  sw.self.registration.showNotification = async (title, opts) => {
    log.push('show')
    if (sw.self.showMode === 'reject')
      throw Object.assign(new Error('secret message with /private/path'), {
        name: 'NotAllowedError',
      })
    return originalShow(title, opts)
  }
  ackHandler = (init) => {
    const body = JSON.parse(init.body)
    acks.push({ body, headers: init.headers, signal: init.signal, init })
    log.push(`ack:${body.p_event}`)
    if (mode === 'throw') throw new TypeError('sync failure')
    if (mode === 'offline') return Promise.reject(new TypeError('Failed to fetch'))
    if (mode === 'hang')
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () => reject(new Error('aborted')))
      )
    return Promise.resolve(new Response('', { status: 204 }))
  }
}
function push(payload = {}) {
  let work
  handlers.push({
    data: {
      json: () => ({
        title: 'x',
        body: 'y',
        notificationId: 5,
        targetUrl: '/p',
        ack: ACK,
        ...payload,
      }),
    },
    waitUntil: (promise) => {
      work = promise
    },
  })
  return work
}

test('telemetria: Push exibido, ACK "received" disparado ANTES e "shown" DEPOIS de showNotification', async () => {
  arm('ok')
  await push()
  assert.deepEqual(log, ['ack:received', 'show', 'ack:shown'])
  assert.equal(sw.self.shownNotification.title, 'x')
  assert.equal(acks[0].body.p_token, ACK)
  assert.deepEqual(Object.keys(acks[0].body).sort(), ['p_event', 'p_token'])
  assert.equal(acks[0].headers.apikey, ACK_KEY)
  assert.equal(acks[0].init.credentials, 'omit')
  assert.equal(acks[0].init.keepalive, true)
})

test('telemetria: ACK falhando (offline) e ACK que lança de forma síncrona não impedem a notificação', async () => {
  for (const mode of ['offline', 'throw']) {
    arm(mode)
    await push()
    assert.equal(sw.self.shownNotification.title, 'x', mode)
    assert.ok(log.includes('show'), mode)
  }
})

test('telemetria: ACK lento NÃO atrasa a exibição; ao estourar o tempo é abortado e o handler termina', async () => {
  arm('hang')
  let settled = false
  const work = push().then(() => {
    settled = true
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.ok(log.includes('show'), 'a notificação apareceu com o ACK ainda pendente')
  assert.equal(sw.self.shownNotification.title, 'x')
  assert.equal(settled, false, 'o handler só termina depois do ACK (limitado por timeout)')
  assert.equal(timers.length >= 1, true, 'o ACK tem timeout')
  timers.forEach((fire) => fire()) // estoura o prazo => AbortController.abort()
  await work
  assert.equal(settled, true)
  assert.ok(acks.every((ack) => ack.signal.aborted))
})

test('telemetria: showNotification rejeitando gera show_failed só com o NOME do erro e preserva a falha', async () => {
  arm('ok')
  sw.self.showMode = 'reject'
  await assert.rejects(push(), /secret message/)
  assert.deepEqual(log, ['ack:received', 'show', 'ack:show_failed'])
  const failed = acks.find((ack) => ack.body.p_event === 'show_failed')
  assert.equal(failed.body.p_failure, 'NotAllowedError')
  assert.equal(
    JSON.stringify(acks).includes('secret'),
    false,
    'nem mensagem nem caminho vão para a telemetria'
  )
})

test('telemetria: sem token, token inválido ou build sem configuração => nenhuma requisição, notificação normal', async () => {
  for (const payload of [
    { ack: undefined },
    { ack: '' },
    { ack: 'curto' },
    { ack: 'CD'.repeat(32) },
    { ack: `${ACK}0` },
    { ack: 123 },
    { ack: '<img src=x>' },
  ]) {
    arm('ok')
    await push(payload)
    assert.equal(acks.length, 0, JSON.stringify(payload))
    assert.equal(sw.self.shownNotification.title, 'x')
  }
  for (const ack of [
    { url: null, key: null },
    { url: ACK_URL, key: null },
    { url: null, key: ACK_KEY },
  ]) {
    arm('ok', { ack })
    await push()
    assert.equal(acks.length, 0)
    assert.equal(sw.self.shownNotification.title, 'x')
  }
})

test('telemetria: o token vai só em notification.data (para o clique), nunca no título, corpo ou tag', async () => {
  arm('ok')
  await push()
  const { title, options } = sw.self.shownNotification
  assert.equal(options.data.ack, ACK)
  assert.equal(`${title}${options.body}${options.tag}`.includes(ACK), false)
})

test('telemetria: clique envia "clicked" e a navegação acontece mesmo com ACK offline, lento ou lançando', async () => {
  for (const mode of ['ok', 'offline', 'throw', 'hang']) {
    arm(mode)
    sw.self.windowClients = []
    sw.self.openedWindow = null
    sw.self.clients.openWindow = async (url) => {
      sw.self.openedWindow = url
    }
    let work
    handlers.notificationclick({
      notification: { data: { targetUrl: '/perfil', ack: ACK }, close() {} },
      waitUntil: (promise) => {
        work = promise
      },
    })
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(
      sw.self.openedWindow,
      `${ORIGIN}/perfil`,
      `${mode}: abriu a rota sem esperar o ACK`
    )
    assert.deepEqual(
      acks.map((ack) => ack.body.p_event),
      ['clicked']
    )
    timers.forEach((fire) => fire())
    await work
  }
})

test('telemetria: clique sem token não faz requisição', async () => {
  arm('ok')
  sw.self.windowClients = []
  await click('/perfil')
  assert.equal(acks.length, 0)
})

test('build: pushAckConfig só habilita a telemetria com https + chave; nada de valores parciais', () => {
  assert.deepEqual(
    pushAckConfig({ VITE_SUPABASE_URL: 'https://proj.supabase.co/', VITE_SUPABASE_ANON_KEY: 'k' }),
    { url: ACK_URL, key: 'k' }
  )
  for (const env of [
    {},
    { VITE_SUPABASE_URL: 'https://proj.supabase.co' },
    { VITE_SUPABASE_ANON_KEY: 'k' },
    { VITE_SUPABASE_URL: 'http://proj.supabase.co', VITE_SUPABASE_ANON_KEY: 'k' },
    { VITE_SUPABASE_URL: 'not a url', VITE_SUPABASE_ANON_KEY: 'k' },
    { VITE_SUPABASE_URL: 'https://proj.supabase.co/?x=1', VITE_SUPABASE_ANON_KEY: 'k' },
  ])
    assert.deepEqual(pushAckConfig(env), { url: null, key: null }, JSON.stringify(env))
})

test('build: o template não deixa placeholders sem substituir', () => {
  assert.equal((TEMPLATE.match(/__EXERCISE_VISUALS_PREFIX__/g) || []).length, 1)
  assert.equal((TEMPLATE.match(/__PUSH_ACK_URL__/g) || []).length, 1)
  assert.equal((TEMPLATE.match(/__PUSH_ACK_KEY__/g) || []).length, 1)
})

// ---- Imagens oficiais dos exercícios (bucket público exercise-visuals) -------------------------------

const CATALOG_ID = '11111111-2222-3333-4444-555555555555'
const visualUrl = (file = 'start.webp', version = 3) => `${VISUALS_PREFIX}${CATALOG_ID}/v${version}/${file}`
const imageRequest = (url) => new Request(url, { mode: 'no-cors' })
const webp = (body = 'bytes', init = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'image/webp' }, ...init })
const VISUAL_CACHE = 'treinos-exercise-images-v1'

test('imagem publicada do exercício: rede na primeira vez (refeita com CORS, sem credenciais), cache nas seguintes', async () => {
  load({ responder: () => webp() })
  const first = await dispatchFetch(imageRequest(visualUrl()))
  assert.equal(first.handled, true)
  assert.equal(await first.response.text(), 'bytes')
  const second = await dispatchFetch(imageRequest(visualUrl()))
  assert.equal(await second.response.text(), 'bytes')
  assert.equal(requests.length, 1, 'a segunda leitura vem do cache, sem rede')
  assert.equal(requests[0].url, visualUrl())
  assert.equal(requests[0].mode, 'cors', 'o <img> é no-cors (opaco); o worker refaz com CORS para validar o tipo')
  assert.equal(requests[0].credentials, 'omit')
  assert.equal(sw.caches.stores.get(VISUAL_CACHE).size, 1)
})

test('imagem do exercício: versão nova = URL nova = nova entrada (nunca serve a versão antiga no lugar)', async () => {
  load({ responder: (url) => webp(url.includes('/v4/') ? 'novo' : 'antigo') })
  assert.equal(await (await dispatchFetch(imageRequest(visualUrl('start.webp', 3)))).response.text(), 'antigo')
  assert.equal(await (await dispatchFetch(imageRequest(visualUrl('start.webp', 4)))).response.text(), 'novo')
  assert.equal(sw.caches.stores.get(VISUAL_CACHE).size, 2)
})

test('offline: imagem já vista continua aparecendo; nunca vista falha (a UI mostra o placeholder)', async () => {
  load({ responder: () => webp('vista') })
  await dispatchFetch(imageRequest(visualUrl('start.webp')))
  offline = true
  assert.equal(await (await dispatchFetch(imageRequest(visualUrl('start.webp')))).response.text(), 'vista')
  const result = dispatchFetch(imageRequest(visualUrl('end.webp')))
  await assert.rejects(result)
})

test('só guarda WebP de verdade: erro HTTP, HTML ou outro tipo nunca entram no cache', async () => {
  load({ responder: () => new Response('nope', { status: 404, headers: { 'content-type': 'application/json' } }) })
  const notFound = await dispatchFetch(imageRequest(visualUrl()))
  assert.equal(notFound.response.status, 404)
  load({ responder: () => new Response('<html>', { status: 200, headers: { 'content-type': 'text/html' } }) })
  await dispatchFetch(imageRequest(visualUrl()))
  assert.equal(sw.caches.stores.get(VISUAL_CACHE)?.size ?? 0, 0)
})

test('NÃO é um cache genérico do Supabase: auth, REST, RPC, realtime, storage privado e outros paths ficam de fora', async () => {
  load({ responder: () => webp() })
  const base = 'https://proj.supabase.co'
  const outside = [
    `${base}/auth/v1/token?grant_type=refresh_token`,
    `${base}/rest/v1/exercise_catalog?select=*`,
    `${base}/rest/v1/rpc/search_exercise_catalog`,
    `${base}/realtime/v1/websocket`,
    `${base}/storage/v1/object/sign/exercise-visual-drafts/${CATALOG_ID}/set/start.webp?token=x`,
    `${base}/storage/v1/object/authenticated/exercise-visual-drafts/${CATALOG_ID}/set/start.webp`,
    `${base}/storage/v1/object/public/profile-avatars/${CATALOG_ID}/x.webp`,
    `${base}/storage/v1/object/public/exercise-visual-references/${CATALOG_ID}/v1/start.webp`,
    `${VISUALS_PREFIX}Bench_Press/0.jpg`, // path do dataset original
    `${VISUALS_PREFIX}${CATALOG_ID}/v3/start.webp?token=abc`, // com query
    `${VISUALS_PREFIX}${CATALOG_ID}/v3/start.webp#x`,
    `${VISUALS_PREFIX}${CATALOG_ID}/v3/../../secret.webp`,
    `${VISUALS_PREFIX}${CATALOG_ID}/v3/animation.webp`,
    `https://evil.example/storage/v1/object/public/exercise-visuals/${CATALOG_ID}/v3/start.webp`,
    `http://proj.supabase.co/storage/v1/object/public/exercise-visuals/${CATALOG_ID}/v3/start.webp`,
  ]
  for (const url of outside) assert.equal((await dispatchFetch(imageRequest(url))).handled, false, url)
  assert.equal(
    (await dispatchFetch(new Request(visualUrl(), { method: 'POST', body: 'x' }))).handled,
    false,
    'só GET'
  )
  assert.deepEqual(network, [])
  assert.equal(sw.caches.stores.size, 0)
})

test('sem VITE_SUPABASE_URL https no build, o cache de imagens fica desligado', async () => {
  load({ visuals: null, responder: () => webp() })
  assert.equal((await dispatchFetch(imageRequest(visualUrl()))).handled, false)
})

test('teto de entradas: descarta as imagens mais antigas (cache nunca cresce sem limite)', async () => {
  load({ responder: () => webp() })
  for (let n = 1; n <= 104; n += 1) {
    await dispatchFetch(imageRequest(visualUrl('start.webp', n)))
  }
  await new Promise((resolve) => setImmediate(resolve))
  const keys = [...sw.caches.stores.get(VISUAL_CACHE).keys()]
  assert.equal(keys.length, 100)
  assert.ok(!keys.includes(visualUrl('start.webp', 1)))
  assert.ok(keys.includes(visualUrl('start.webp', 104)))
})

test('activate preserva o cache de imagens de exercício e a poda também o limita', async () => {
  await sw.caches.open(VISUAL_CACHE)
  await sw.caches.open('treinos-antigo-v0')
  await lifecycle('activate')
  const names = await sw.caches.keys()
  assert.ok(names.includes(VISUAL_CACHE))
  assert.ok(!names.includes('treinos-antigo-v0'))
})

test('build: exerciseVisualsPrefix só liga com https e URL limpa', () => {
  assert.equal(exerciseVisualsPrefix({ VITE_SUPABASE_URL: 'https://proj.supabase.co/' }), VISUALS_PREFIX)
  for (const env of [
    {},
    { VITE_SUPABASE_URL: 'http://proj.supabase.co' },
    { VITE_SUPABASE_URL: 'not a url' },
    { VITE_SUPABASE_URL: 'https://proj.supabase.co/?x=1' },
    { VITE_SUPABASE_URL: 'https://proj.supabase.co/#x' },
  ])
    assert.equal(exerciseVisualsPrefix(env), null, JSON.stringify(env))
})
