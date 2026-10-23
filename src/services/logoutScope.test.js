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
  directory = await mkdtemp(join(tmpdir(), 'logout-scope-tests-'))
  const outfile = join(directory, 'scope.cjs')
  await build({
    stdin: {
      contents: `
        export { logoutUser, logoutAllDevices } from './authService.js'
        export { touchUserActivity } from './activityService.js'
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
        name: 'supabase-stub',
        setup(ctx) {
          ctx.onResolve({ filter: /supabase\/config$/ }, () => ({
            path: 'supabase',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^supabase$/, namespace: 'stub' }, () => ({
            contents: `export const supabase = {
              auth: {
                signOut: (...a) => globalThis.__signOut(...a),
                getSession: () => globalThis.__getSession(),
              },
              rpc: (...a) => globalThis.__rpc(...a),
            }`,
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

let signOutCalls
beforeEach(() => {
  signOutCalls = []
  globalThis.__signOut = (options) => {
    signOutCalls.push(options)
    return Promise.resolve({ error: null })
  }
  globalThis.__getSession = () => Promise.resolve({ data: { session: null } })
})

const quiet = async (fn) => {
  const warn = console.warn
  console.warn = () => {}
  try {
    return await fn()
  } finally {
    console.warn = warn
  }
}

test('o logout padrão (logoutUser) é LOCAL: só encerra esta sessão', async () => {
  const result = await mod.logoutUser()
  assert.deepEqual(signOutCalls, [{ scope: 'local' }])
  assert.deepEqual(result, { revoked: true })
})

test('"Sair de todos os dispositivos": others primeiro, depois local (nunca global)', async () => {
  const result = await mod.logoutAllDevices()
  assert.deepEqual(signOutCalls, [{ scope: 'others' }, { scope: 'local' }])
  assert.deepEqual(result, { revoked: true })
})

test('others falha: local NÃO é chamado, a sessão continua e o erro indica a etapa', async () => {
  globalThis.__signOut = (options) => {
    signOutCalls.push(options)
    return Promise.resolve({ error: new Error('network') })
  }
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  await assert.rejects(mod.logoutAllDevices(), (error) => error.logoutStep === 'others')
  assert.deepEqual(signOutCalls, [{ scope: 'others' }])
  // destravou: nova tentativa executa a sequência inteira
  globalThis.__signOut = (options) => {
    signOutCalls.push(options)
    return Promise.resolve({ error: null })
  }
  await mod.logoutAllDevices()
  assert.deepEqual(
    signOutCalls.map((c) => c.scope),
    ['others', 'others', 'local']
  )
})

test('others ok, local falha: identifica a limpeza local sem negar a revogação confirmada', async () => {
  globalThis.__signOut = (options) => {
    signOutCalls.push(options)
    return Promise.resolve({ error: options.scope === 'local' ? new Error('lock') : null })
  }
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  await assert.rejects(mod.logoutAllDevices(), (error) => error.logoutStep === 'local-cleanup')
  assert.deepEqual(
    signOutCalls.map((c) => c.scope),
    ['others', 'local']
  )
})

// Cenário A da auditoria: logoutUser() (local) termina PRIMEIRO e some com a sessão do cliente;
// logoutAllDevices() só é chamado depois disso. supabase-js não tem mais token para autenticar
// signOut({scope:'others'}) -- a chamada falha "de verdade" (aqui simulada), mas o importante é
// que isto NUNCA vira sucesso falso: rejeita com logoutStep:'others', nunca relata outras sessões
// revogadas sem o terem sido.
test('Cenário A: local esgota a sessão antes de all ser pedido -- all falha honestamente, nunca finge sucesso', async () => {
  await mod.logoutUser() // sessão local encerrada; signOutCalls = [{scope:'local'}]
  globalThis.__signOut = (options) => {
    signOutCalls.push(options)
    // Sem sessão no cliente para autenticar o pedido de 'others' -- erro real do SDK.
    return options.scope === 'others'
      ? Promise.resolve({ error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' }) })
      : Promise.resolve({ error: null })
  }
  await assert.rejects(mod.logoutAllDevices(), (error) => error.logoutStep === 'others')
  assert.deepEqual(
    signOutCalls.map((c) => c.scope),
    ['local', 'others']
  )
})

test('escopos nunca se misturam e global nunca é usado', async () => {
  await mod.logoutUser()
  await mod.logoutAllDevices()
  await mod.logoutUser()
  assert.deepEqual(
    signOutCalls.map((c) => c.scope),
    ['local', 'others', 'local', 'local']
  )
})

test('múltiplos cliques: uma única sequência others → local (mesmo misturando com o logout comum)', async () => {
  let release
  const gate = new Promise((resolve) => (release = resolve))
  globalThis.__signOut = async (options) => {
    signOutCalls.push(options)
    if (options.scope === 'others') await gate
    return { error: null }
  }
  const calls = [
    mod.logoutAllDevices(),
    mod.logoutAllDevices(),
    mod.logoutUser(),
    mod.logoutAllDevices(),
  ]
  release()
  await Promise.all(calls)
  assert.deepEqual(
    signOutCalls.map((c) => c.scope),
    ['others', 'local']
  )
})

test('falha de revogação do logout local com sessão já removida: resolve com revoked:false', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('network') })
  assert.deepEqual(await quiet(() => mod.logoutUser()), { revoked: false })
})

test('falha do logout local com a sessão ainda existindo: rejeita e destrava', async () => {
  globalThis.__signOut = () => Promise.resolve({ error: new Error('lock') })
  globalThis.__getSession = () => Promise.resolve({ data: { session: { access_token: 'x' } } })
  await assert.rejects(mod.logoutUser(), /lock/)
  globalThis.__signOut = () => Promise.resolve({ error: null })
  assert.deepEqual(await mod.logoutUser(), { revoked: true })
})

test('touchUserActivity chama a RPC sem nenhum argumento (usuário/sessão/horário são do servidor)', async () => {
  const calls = []
  globalThis.__rpc = (...args) => {
    calls.push(args)
    return Promise.resolve({ error: null })
  }
  await mod.touchUserActivity()
  assert.deepEqual(calls, [['touch_user_activity']])
  globalThis.__rpc = () => Promise.resolve({ error: new Error('boom') })
  await assert.rejects(mod.touchUserActivity(), /boom/)
})
