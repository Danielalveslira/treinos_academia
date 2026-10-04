import { after, before, beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

let directory
let mod

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'logout-tests-'))
  const outfile = join(directory, 'logout.cjs')
  await build({
    stdin: {
      contents: `
        import { useLogout, logoutErrorMessage, logoutAllErrorMessage, confirmAndLogoutAll, LOGOUT_ALL_OTHERS_ERROR } from './useLogout.js'
        import { logoutUser } from '../services/authService.js'
        import { consumeLogoutReason } from '../utils/logoutReason.js'
        export { useLogout, logoutErrorMessage, logoutAllErrorMessage, confirmAndLogoutAll, LOGOUT_ALL_OTHERS_ERROR, logoutUser, consumeLogoutReason }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'stubs',
        setup(ctx) {
          ctx.onResolve({ filter: /^react$/ }, () => ({ path: 'react', namespace: 'stub' }))
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^react$/, namespace: 'stub' }, () => ({
            contents: `
              const slots = []
              let index = 0
              export const __reset = () => { slots.length = 0; index = 0 }
              export const __render = () => { index = 0 }
              export const useRef = (value) => {
                const i = index++
                if (!(i in slots)) slots[i] = { current: value }
                return slots[i]
              }
              export const useState = (initial) => {
                const i = index++
                if (!(i in slots)) slots[i] = { value: initial }
                return [slots[i].value, (v) => { slots[i].value = v }]
              }
              export const useCallback = (fn) => fn
              export const useEffect = () => {}
            `,
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = { auth: { signOut: (...a) => globalThis.__signOut(...a), getSession: () => globalThis.__getSession() } }`,
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

let store
beforeEach(() => {
  store = new Map()
  globalThis.sessionStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  }
})

test('logoutUser compartilha UMA requisição entre chamadas concorrentes', async () => {
  let calls = 0
  let finish
  globalThis.__signOut = () => {
    calls += 1
    return new Promise((resolve) => (finish = () => resolve({ error: null })))
  }
  const a = mod.logoutUser()
  const b = mod.logoutUser()
  finish()
  await Promise.all([a, b])
  assert.equal(calls, 1)
  // terminada a primeira, um novo logout pode acontecer
  globalThis.__signOut = () => Promise.resolve({ error: null })
  await mod.logoutUser()
})

test('duplo toque em "Sair" chama o signOut uma única vez e deixa o aviso para o Login', async () => {
  let calls = 0
  let finish
  globalThis.__signOut = () => {
    calls += 1
    return new Promise((resolve) => (finish = () => resolve({ error: null })))
  }
  const { logout } = mod.useLogout()
  const first = logout()
  const second = logout()
  finish()
  await Promise.all([first, second])
  assert.equal(calls, 1)
  assert.equal(mod.consumeLogoutReason().message, 'Você saiu da conta.')
})

test('falha do signOut COM sessão local ainda existente libera o botão, mostra erro e não deixa aviso', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  const originalError = console.error
  console.error = () => {}
  try {
    const { logout } = mod.useLogout()
    await logout()
  } finally {
    console.error = originalError
  }
  assert.equal(mod.consumeLogoutReason(), null)
  // nova tentativa é possível (não ficou preso em "Saindo…")
  globalThis.__signOut = () => Promise.resolve({ error: null })
  await mod.useLogout().logout()
})

test('SDK remove a sessão local mesmo se a revogação no servidor falha: conta como logout, sem erro', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: null } })
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    await mod.logoutUser() // não lança
  } finally {
    console.warn = originalWarn
  }
})

test('mensagem de erro distingue offline de falha genérica', () => {
  assert.match(mod.logoutErrorMessage(false), /Sem conexão/)
  assert.match(mod.logoutErrorMessage(true), /Não foi possível sair/)
})

// Modelo mínimo do Auth: others mantém a sessão, local a remove.
function fakeAuth({ othersFails = false } = {}) {
  const state = { session: { access_token: 'x' }, calls: [] }
  globalThis.__signOut = (options) => {
    state.calls.push(options.scope)
    if (options.scope === 'others') {
      return Promise.resolve({ error: othersFails ? new Error('network') : null })
    }
    state.session = null
    return Promise.resolve({ error: null })
  }
  globalThis.__getSession = () => Promise.resolve({ data: { session: state.session } })
  return state
}

test('"Sair de todos os dispositivos": others → local, aviso próprio para o Login', async () => {
  const auth = fakeAuth()
  await mod.useLogout().logoutAll()
  assert.deepEqual(auth.calls, ['others', 'local'])
  assert.equal(auth.session, null)
  assert.equal(mod.consumeLogoutReason().message, 'Você saiu da conta em todos os dispositivos.')
})

test('others falha: nenhum logout local, usuário segue logado, mensagem específica e sem aviso residual', async () => {
  const auth = fakeAuth({ othersFails: true })
  const originalError = console.error
  console.error = () => {}
  try {
    const hook = mod.useLogout()
    await hook.logoutAll()
  } finally {
    console.error = originalError
  }
  assert.deepEqual(auth.calls, ['others'], 'local não foi chamado')
  assert.deepEqual(auth.session, { access_token: 'x' }, 'sessão atual intacta')
  assert.equal(mod.consumeLogoutReason(), null)
})

test('mensagem da falha de others é exatamente a pedida; falha só do local usa a mensagem comum', () => {
  assert.equal(
    mod.LOGOUT_ALL_OTHERS_ERROR,
    'Não foi possível sair dos outros dispositivos. Tente novamente.'
  )
  assert.equal(mod.logoutAllErrorMessage({ logoutStep: 'others' }), mod.LOGOUT_ALL_OTHERS_ERROR)
  assert.equal(mod.logoutAllErrorMessage(new Error('x')), mod.logoutErrorMessage(true))
})

test('múltiplos cliques: uma única sequência (others → local), mesmo misturando com "Sair"', async () => {
  const auth = fakeAuth()
  let release
  const gate = new Promise((resolve) => (release = resolve))
  const inner = globalThis.__signOut
  globalThis.__signOut = async (options) => {
    if (options.scope === 'others') await gate
    return inner(options)
  }
  const hook = mod.useLogout()
  const clicks = [hook.logoutAll(), hook.logoutAll(), hook.logout(), hook.logoutAll()]
  release()
  await Promise.all(clicks)
  assert.deepEqual(auth.calls, ['others', 'local'])
})

test('cancelar a confirmação: zero requests; confirmar: exatamente uma sequência', async () => {
  const auth = fakeAuth()
  const hook = mod.useLogout()
  const asked = []
  const confirmNo = async (options) => (asked.push(options.title), false)
  assert.equal(await mod.confirmAndLogoutAll(confirmNo, hook.logoutAll), false)
  assert.deepEqual(asked, ['Sair de todos os dispositivos?'])
  assert.deepEqual(auth.calls, [], 'nenhuma requisição ao cancelar')
  assert.equal(mod.consumeLogoutReason(), null)

  const confirmYes = async () => true
  assert.equal(await mod.confirmAndLogoutAll(confirmYes, hook.logoutAll), true)
  assert.deepEqual(auth.calls, ['others', 'local'])
})

test('o "Sair" comum usa o escopo local', async () => {
  const scopes = []
  globalThis.__signOut = (options) => {
    scopes.push(options?.scope)
    return Promise.resolve({ error: null })
  }
  await mod.useLogout().logout()
  assert.deepEqual(scopes, ['local'])
})

test('logout local não confirmado no servidor não vira aviso (o usuário já saiu deste aparelho)', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: null } })
  const warn = console.warn
  console.warn = () => {}
  try {
    await mod.useLogout().logout()
  } finally {
    console.warn = warn
  }
  assert.equal(mod.consumeLogoutReason().message, 'Você saiu da conta.')
})

test('logout e logout global compartilham a trava: toques simultâneos fazem uma única chamada', async () => {
  let calls = 0
  let finish
  globalThis.__signOut = () => {
    calls += 1
    return new Promise((resolve) => (finish = () => resolve({ error: null })))
  }
  const hook = mod.useLogout()
  const a = hook.logout()
  const b = hook.logoutAll()
  finish()
  await Promise.all([a, b])
  assert.equal(calls, 1)
})
