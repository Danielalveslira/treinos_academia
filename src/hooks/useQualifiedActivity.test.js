import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Multiplas abas não tem teste dedicado aqui de propósito: cada aba só pinga enquanto a SUA
// própria document.visibilityState é 'visible' (ver useQualifiedActivity.js), e a proteção real
// contra duas abas somarem tempo é do SERVIDOR -- um único acumulador por usuário/dia com o
// intervalo REAL entre checkpoints, provado em supabase/tests/finance_reward_evidence_test.sql
// e no script de concorrência supabase/tests/evocoins_concurrency.sh. Simular duas "abas" neste
// arquivo compartilhariam o mesmo document/window globais do teste e não provariam nada real.

let directory
let mod

function createEventTarget(extra = {}) {
  const listeners = new Map()
  return {
    ...extra,
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type).add(handler)
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler)
    },
    dispatch(type) {
      for (const handler of [...(listeners.get(type) ?? [])]) handler()
    },
    listenerCount(type) {
      return listeners.get(type)?.size ?? 0
    },
  }
}

let fakeWindow
let fakeDocument
let tick // callback capturado do setInterval mais recente, ou null se nenhum estiver ativo
let realSetInterval
let realClearInterval

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'qualified-activity-tests-'))
  const outfile = join(directory, 'bundle.cjs')

  await build({
    stdin: {
      contents: `
        import { useQualifiedActivity } from './useQualifiedActivity.js'
        import { beginRender } from 'react'
        export { runEffects, resetHooks } from 'react'
        export { setPathname } from 'react-router-dom'
        export { setAuthState } from './useAuth'
        export { getCalls, resetCalls, setResult, setRejectNext } from '../services/economyService'
        // beginRender() simula um RE-RENDER do mesmo componente (refs persistem, como no React de
        // verdade) -- resetHooks() (chamado só em setup(), entre testes) simula desmontar/montar de
        // novo (refs novos). Isto é o que permite testar troca de conta SEM desmontar o componente.
        export function mount() { beginRender(); return useQualifiedActivity() }
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'qualified-activity-test-stubs',
        setup(b) {
          b.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          b.onResolve({ filter: /^react-router-dom$/ }, () => ({ path: 'router', namespace: 'stub' }))
          b.onResolve({ filter: /useAuth$/ }, () => ({ path: 'auth', namespace: 'stub' }))
          b.onResolve({ filter: /economyService$/ }, () => ({ path: 'economy', namespace: 'stub' }))
          b.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              let effects = []
              let refSlots = []
              let refIndex = 0
              // Slot por ORDEM de chamada de useRef dentro de um render -- igual ao React de
              // verdade: o mesmo componente, re-renderizado, reusa o mesmo objeto ref por slot;
              // só um desmontar/montar de novo (resetHooks) cria slots novos.
              export const useRef = (v) => {
                if (refIndex >= refSlots.length) refSlots.push({ current: v })
                return refSlots[refIndex++]
              }
              export const useEffect = (fn) => { effects.push(fn) }
              export const beginRender = () => { refIndex = 0 }
              export function runEffects() {
                const cleanups = effects.splice(0).map((fn) => fn()).filter(Boolean)
                return () => cleanups.forEach((c) => c())
              }
              export const resetHooks = () => { effects = []; refSlots = []; refIndex = 0 }
            `,
          }))
          b.onLoad({ filter: /^router$/, namespace: 'stub' }, () => ({
            contents: `
              let pathname = '/inicio'
              export const useLocation = () => ({ pathname })
              export const setPathname = (p) => { pathname = p }
            `,
          }))
          b.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({
            contents: `
              let state = { user: { id: 'u1' }, profile: { id: 'u1' }, offlineLocal: false }
              export const useAuth = () => state
              export const setAuthState = (patch) => { state = { ...state, ...patch } }
            `,
          }))
          b.onLoad({ filter: /^economy$/, namespace: 'stub' }, () => ({
            contents: `
              let calls = 0
              let result = { granted: false, dayQualified: false }
              let rejectNext = false
              export function registerQualifiedActivity() {
                calls += 1
                if (rejectNext) { rejectNext = false; return Promise.reject(new Error('network')) }
                return Promise.resolve(result)
              }
              export const getCalls = () => calls
              export const resetCalls = () => { calls = 0 }
              export const setResult = (r) => { result = r }
              export const setRejectNext = () => { rejectNext = true }
            `,
          }))
        },
      },
    ],
  })

  mod = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

function setup() {
  mod.resetHooks()
  mod.resetCalls()
  mod.setResult({ granted: false, dayQualified: false })
  mod.setAuthState({ user: { id: 'u1' }, profile: { id: 'u1' }, offlineLocal: false })
  mod.setPathname('/inicio')
  fakeWindow = createEventTarget()
  fakeDocument = createEventTarget({ visibilityState: 'visible' })
  tick = null
  realSetInterval = globalThis.setInterval
  realClearInterval = globalThis.clearInterval
  globalThis.window = fakeWindow
  globalThis.document = fakeDocument
  globalThis.setInterval = (fn) => {
    tick = fn
    return 'fake-timer'
  }
  globalThis.clearInterval = () => {
    tick = null
  }
}

function teardown() {
  globalThis.setInterval = realSetInterval
  globalThis.clearInterval = realClearInterval
  delete globalThis.window
  delete globalThis.document
}

const MIN_PING_INTERVAL_MS = 3 * 60 * 1000
const IDLE_TIMEOUT_MS = 5 * 60 * 1000

// O resultado da RPC só marca completedDayRef dentro de um .then -- sem isto, a segunda
// chamada do teste abaixo rodaria antes da primeira terminar de resolver sua própria promise.
async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
}

test('interação na tela atual (sem trocar de rota) também acumula e paga', async (t) => {
  setup()
  let now = 1_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    mod.runEffects()
    assert.equal(mod.getCalls(), 0, 'mount por si só não bate na rede')

    fakeWindow.dispatch('keydown') // interação real, sem navegar
    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 1, 'interação na mesma tela + tempo suficiente dispara a chamada')
  } finally {
    teardown()
  }
})

test('navegar entre rotas continua contando como interação (comportamento anterior preservado)', async (t) => {
  setup()
  let now = 2_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    mod.runEffects()
    mod.setPathname('/treinos')
    mod.mount() // o efeito de pathname roda de novo com a nova rota
    mod.runEffects()

    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 1, 'navegação sozinha ainda basta como sinal de interação')
  } finally {
    teardown()
  }
})

test('abrir o app e ficar ocioso (sem nenhuma interação nova) para de pingar', async (t) => {
  setup()
  let now = 3_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount() // o próprio mount marca a interação inicial (entrar no app)
    mod.runEffects()

    now += IDLE_TIMEOUT_MS + MIN_PING_INTERVAL_MS // tempo e intervalo mínimo também já passaram
    tick()
    assert.equal(mod.getCalls(), 0, 'tempo sozinho não basta: sem interação nova, nada é pago (evita premiar aba aberta)')
  } finally {
    teardown()
  }
})

test('aba oculta para o intervalo local (sem trabalho em segundo plano) e retoma ao voltar', async (t) => {
  setup()
  let now = 4_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    mod.runEffects()
    assert.ok(tick, 'intervalo ativo com a aba visível')

    fakeDocument.visibilityState = 'hidden'
    fakeDocument.dispatch('visibilitychange')
    assert.equal(tick, null, 'aba oculta: o intervalo local é cancelado, não só ignorado')

    fakeDocument.visibilityState = 'visible'
    fakeDocument.dispatch('visibilitychange')
    assert.ok(tick, 'voltar a ficar visível retoma o intervalo')

    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 1, 'reengajar ao voltar permite pingar de novo')
  } finally {
    teardown()
  }
})

test('falha de rede (reconexão) não propaga erro e não trava tentativas seguintes', async (t) => {
  setup()
  let now = 5_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    mod.runEffects()
    mod.setRejectNext()

    fakeWindow.dispatch('pointerdown')
    now += MIN_PING_INTERVAL_MS
    assert.doesNotThrow(() => tick())
    assert.equal(mod.getCalls(), 1, 'tentativa foi feita apesar da falha')

    fakeWindow.dispatch('pointerdown')
    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 2, 'uma falha de rede não impede a próxima tentativa')
  } finally {
    teardown()
  }
})

test('desmontar remove os listeners e o intervalo', async (t) => {
  setup()
  let now = 6_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    const cleanup = mod.runEffects()
    assert.ok(fakeWindow.listenerCount('keydown') > 0, 'listener registrado no mount')

    cleanup()
    assert.equal(fakeWindow.listenerCount('keydown'), 0, 'listener removido no cleanup')
    assert.equal(tick, null, 'intervalo cancelado no cleanup')

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    assert.equal(mod.getCalls(), 0, 'nada dispara depois de desmontado')
  } finally {
    teardown()
  }
})

test('sem usuário/perfil ou em modo offline local: nenhum listener nem intervalo é criado', async (t) => {
  setup()
  t.mock.method(Date, 'now', () => 7_000_000)
  try {
    mod.setAuthState({ user: null, profile: null, offlineLocal: false })
    mod.mount()
    mod.runEffects()
    assert.equal(fakeWindow.listenerCount('keydown'), 0, 'sem sessão: nenhum listener')
    assert.equal(tick, null, 'sem sessão: nenhum intervalo')

    mod.setAuthState({ user: { id: 'u1' }, profile: { id: 'u1' }, offlineLocal: true })
    mod.mount()
    mod.runEffects()
    assert.equal(fakeWindow.listenerCount('keydown'), 0, 'offline local: nenhum listener')
    assert.equal(tick, null, 'offline local: nenhum intervalo')
  } finally {
    teardown()
  }
})

test('dia já resolvido (granted/dayQualified) para de pingar mesmo com nova interação', async (t) => {
  setup()
  let now = 8_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.setResult({ granted: true, dayQualified: true })
    mod.mount()
    mod.runEffects()

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick() // primeira chamada: resolve o dia (granted+dayQualified)
    assert.equal(mod.getCalls(), 1)
    await flushMicrotasks() // deixa o .then marcar completedDayRef antes do próximo tick

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 1, 'dia já resolvido: não tenta de novo mesmo com interação e tempo novos')
  } finally {
    teardown()
  }
})

// Troca de conta/sessão SEM desmontar o componente: user/profile mudam por referência e o efeito
// principal roda de novo (React chama o cleanup ANTERIOR e refaz o efeito), mas os refs
// (lastPingRef/lastInteractionRef/completedDayRef) são do MESMO componente -- sem resetá-los na
// troca, estado da conta ANTERIOR vazaria para a conta nova. A atribuição de qual conta recebe o
// crédito é sempre do servidor (auth.uid() da sessão atual no JWT) -- estes testes cobrem o que É
// responsabilidade do hook: nenhum throttle/estado local de uma conta pode silenciar a outra.

test('troca de conta sem desmontar: dia resolvido da conta ANTERIOR não bloqueia a conta nova', async (t) => {
  setup()
  let now = 9_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.setResult({ granted: true, dayQualified: true })
    mod.mount()
    const cleanupA = mod.runEffects()

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick() // conta A: resolve o dia (completedDayRef marcado para A)
    assert.equal(mod.getCalls(), 1)
    await flushMicrotasks()

    cleanupA() // React desfaz o efeito da conta A antes de refazer com a conta nova
    mod.setAuthState({ user: { id: 'u2' }, profile: { id: 'u2' }, offlineLocal: false })
    mod.setResult({ granted: false, dayQualified: false }) // conta nova: dia ainda NÃO resolvido
    mod.mount()
    mod.runEffects()

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 2, 'completedDayRef da conta anterior não impede a tentativa da conta nova')
  } finally {
    teardown()
  }
})

test('troca de conta sem desmontar: último ping da conta ANTERIOR não atrasa o primeiro ping da conta nova', async (t) => {
  setup()
  let now = 10_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.mount()
    const cleanupA = mod.runEffects()
    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick() // conta A pinga agora mesmo (lastPingRef fica muito recente)
    assert.equal(mod.getCalls(), 1)

    cleanupA() // React desfaz o efeito da conta A antes de refazer com a conta nova
    mod.setAuthState({ user: { id: 'u2' }, profile: { id: 'u2' }, offlineLocal: false })
    mod.mount() // mesmo componente, conta nova -- SEM avançar o relógio mais que isso
    mod.runEffects()

    fakeWindow.dispatch('keydown')
    now += 1 // quase nenhum tempo real passou desde o ping da conta anterior
    tick()
    assert.equal(mod.getCalls(), 2, 'lastPingRef da conta anterior não atrasa o primeiro ping da conta nova')
  } finally {
    teardown()
  }
})

test('logout e login de novo (sem desmontar): throttling da sessão anterior não atravessa para a nova sessão', async (t) => {
  setup()
  let now = 11_000_000
  t.mock.method(Date, 'now', () => now)
  try {
    mod.setResult({ granted: true, dayQualified: true })
    mod.mount()
    const cleanupSession1 = mod.runEffects()
    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick() // sessão 1: resolve o dia
    assert.equal(mod.getCalls(), 1)
    await flushMicrotasks()

    cleanupSession1() // React desfaz o efeito da sessão 1 antes de refazer com user=null (logout)
    mod.setAuthState({ user: null, profile: null, offlineLocal: false }) // logout
    mod.mount()
    mod.runEffects()
    assert.equal(fakeWindow.listenerCount('keydown'), 0, 'logout: nenhum listener ativo')
    assert.equal(tick, null, 'logout: nenhum intervalo ativo')

    mod.setAuthState({ user: { id: 'u1' }, profile: { id: 'u1' }, offlineLocal: false }) // login de novo
    mod.setResult({ granted: false, dayQualified: false }) // novo dia de uso para a sessão retomada
    mod.mount()
    mod.runEffects()

    fakeWindow.dispatch('keydown')
    now += MIN_PING_INTERVAL_MS
    tick()
    assert.equal(mod.getCalls(), 2, 'sessão retomada volta a pingar normalmente, sem o estado da sessão anterior')
  } finally {
    teardown()
  }
})

// Performance/consumo: nenhum listener/timer deveria se acumular com o tempo (troca de conta,
// reconexão e oscilação de visibilidade repetidas -- o tipo de coisa que acontece muito em
// dispositivos móveis: bloquear/desbloquear a tela, trocar de app, perder e recuperar rede).
test('ciclos repetidos de troca de conta e visibilidade nunca acumulam listeners nem intervalos extras', async (t) => {
  setup()
  t.mock.method(Date, 'now', () => 12_000_000)
  try {
    let cleanup = null
    for (let i = 0; i < 20; i++) {
      if (cleanup) cleanup()
      mod.setAuthState({ user: { id: 'u' + (i % 3) }, profile: { id: 'u' + (i % 3) }, offlineLocal: false })
      mod.mount()
      cleanup = mod.runEffects()
      // oscila visibilidade algumas vezes dentro do mesmo "mount" -- cada troca só liga/desliga
      // UM intervalo (startTicking/stopTicking já são idempotentes), nunca empilha.
      fakeDocument.visibilityState = 'hidden'
      fakeDocument.dispatch('visibilitychange')
      fakeDocument.visibilityState = 'visible'
      fakeDocument.dispatch('visibilitychange')
      assert.ok(fakeWindow.listenerCount('keydown') <= 1, `ciclo ${i}: nunca mais de 1 listener de keydown`)
      assert.ok(fakeWindow.listenerCount('pointerdown') <= 1, `ciclo ${i}: nunca mais de 1 listener de pointerdown`)
    }
    cleanup()
    for (const type of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      assert.equal(fakeWindow.listenerCount(type), 0, `sem vazamento de ${type} depois do cleanup final`)
    }
    assert.equal(fakeDocument.listenerCount('visibilitychange'), 0, 'sem vazamento de visibilitychange depois do cleanup final')
    assert.equal(tick, null, 'nenhum intervalo sobrevive depois de 20 ciclos e do cleanup final')
  } finally {
    teardown()
  }
})
