import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Regressão do bug relatado: uma conta em exclusão (deletionJobs/account_{uid} já
// criado, ver firestore.rules isSignedIn()) nega a leitura do próprio perfil MUITO
// antes da conta do Firebase Auth em si ser desativada (isso só acontece num estágio
// posterior do job, minutos depois -- ver deletion-service.js). O detector antigo de
// "sessão fantasma" só deslogava quando getIdToken(true) FALHAVA -- nessa janela, o
// token continua renovando normalmente, então o app nunca percebia a exclusão e ficava
// preso em "Não foi possível carregar sua conta" (ver ProtectedRoute.jsx) sem nunca
// encerrar a sessão. Estes testes cobrem exatamente essa janela.

let directory
let mount
let act
let useAuth

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'auth-context-tests-'))
  const outfile = join(directory, 'auth.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement, useContext } from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { AuthContext, AuthProvider } from './AuthContext.jsx'
        export { act }
        function Probe() {
          globalThis.__authProbe = useContext(AuthContext)
          return null
        }
        export const useAuth = () => globalThis.__authProbe
        export const mount = () =>
          TestRenderer.create(createElement(AuthProvider, null, createElement(Probe)))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'auth-context-dependencies',
        setup(buildApi) {
          const mocked = new Map([
            ['../firebase/config', 'export const auth = {}; export const db = {}'],
            [
              'firebase/auth',
              `
            export const onAuthStateChanged = (_auth, callback) => {
              globalThis.__authMocks.registerAuthCallback(callback)
              return () => {}
            }
          `,
            ],
            [
              'firebase/firestore',
              `
            export const doc = (_db, ...parts) => ({ path: parts.join('/') })
            export const getDoc = (ref) => globalThis.__authMocks.getDoc(ref)
            export const onSnapshot = (ref, onNext, onError) => {
              globalThis.__authMocks.registerProfileListener({ ref, onNext, onError })
              return () => {}
            }
          `,
            ],
            [
              '../services/usersService',
              `
            export const ensureUserProfile = (...args) => globalThis.__authMocks.ensureUserProfile(...args)
            export const updateUserProfile = (...args) => globalThis.__authMocks.updateUserProfile(...args)
          `,
            ],
            [
              '../services/authService',
              'export const logoutUser = (...args) => globalThis.__authMocks.logoutUser(...args)',
            ],
            [
              '../services/legalService',
              'export const getLegalAccess = async () => null',
            ],
            [
              '../utils/pageCache',
              'export const clearPageCache = () => {}',
            ],
            [
              '../utils/photoBlobCache',
              'export const clearPhotoCache = () => {}',
            ],
            ['../utils/legal', 'export const clearCachedLegalAccess = () => {}'],
            ['../services/economyService', 'export const clearCachedWallet = () => {}'],
          ])
          buildApi.onResolve({ filter: /.*/ }, (args) => {
            if (mocked.has(args.path)) return { path: args.path, namespace: 'auth-context-mock' }
            return undefined
          })
          buildApi.onLoad({ filter: /.*/, namespace: 'auth-context-mock' }, (args) => ({
            contents: mocked.get(args.path),
            loader: 'js',
            resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
          }))
        },
      },
    ],
  })
  ;({ mount, act, useAuth } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  delete globalThis.__authMocks
  delete globalThis.__authProbe
  if (directory) await rm(directory, { recursive: true, force: true })
})

function makeFirebaseUser({ getIdToken }) {
  return { uid: 'user-1', getIdToken }
}

async function setup({ getIdToken, getDocAfterRefresh, ensureUserProfile }) {
  const calls = { logoutUser: 0, getDocCalls: 0 }
  let authCallback
  let profileListener
  globalThis.__authMocks = {
    registerAuthCallback: (cb) => {
      authCallback = cb
    },
    registerProfileListener: (listener) => {
      profileListener = listener
    },
    ensureUserProfile: ensureUserProfile || (async (uid) => ({ id: uid, role: 'user' })),
    updateUserProfile: async () => ({}),
    logoutUser: async () => {
      calls.logoutUser++
    },
    getDoc: async () => {
      calls.getDocCalls++
      if (getDocAfterRefresh instanceof Error) throw getDocAfterRefresh
      return getDocAfterRefresh
    },
  }
  let view
  act(() => {
    view = mount()
  })
  // react-test-renderer's act(async () => {}) never reliably settles for this
  // component (Node's test runner reports "Promise resolution is still pending" and
  // hangs until its own timeout) -- mesmo padrão já usado em MyProfessionalListing.test.js:
  // dispara dentro de um act() síncrono e dá alguns ticks de macrotask (com act(() =>
  // {}) entre eles) para as promises internas assentarem e o próximo render refletir.
  async function flush(times = 3) {
    for (let i = 0; i < times; i++) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      act(() => {})
    }
  }
  const firebaseUser = makeFirebaseUser({ getIdToken })
  act(() => {
    authCallback(firebaseUser)
  })
  await flush()
  return {
    calls,
    firebaseUser,
    triggerProfileError: async (error) => {
      act(() => {
        profileListener.onError(error)
      })
      await flush()
    },
    close: () => act(() => view.unmount()),
  }
}

test('a still-valid token (Auth not yet disabled) but a permission-denied that survives a refresh still ends the session', async () => {
  const ctx = await setup({
    getIdToken: async () => 'fresh-token', // Auth account still fully enabled.
    getDocAfterRefresh: Object.assign(new Error('denied'), { code: 'permission-denied' }),
  })
  try {
    assert.equal(useAuth().verifyingSession, false)
    await ctx.triggerProfileError(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    assert.equal(ctx.calls.getDocCalls, 1, 'should have retried the read once with the fresh token')
    assert.equal(ctx.calls.logoutUser, 1, 'a fence that survives a token refresh must end the session')
  } finally {
    ctx.close()
  }
})

test('a transient permission-denied that clears on retry does not log the user out', async () => {
  const ctx = await setup({
    getIdToken: async () => 'fresh-token',
    getDocAfterRefresh: { exists: () => true, data: () => ({ role: 'user' }) },
  })
  try {
    await ctx.triggerProfileError(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    assert.equal(ctx.calls.getDocCalls, 1)
    assert.equal(ctx.calls.logoutUser, 0, 'a read that succeeds after refresh is not a ghost session')
  } finally {
    ctx.close()
  }
})

test('an Auth account already disabled/deleted ends the session without ever retrying the read', async () => {
  const ctx = await setup({
    getIdToken: async () => {
      throw Object.assign(new Error('disabled'), { code: 'auth/user-disabled' })
    },
    getDocAfterRefresh: { exists: () => true, data: () => ({ role: 'user' }) },
  })
  try {
    await ctx.triggerProfileError(Object.assign(new Error('denied'), { code: 'permission-denied' }))
    assert.equal(ctx.calls.logoutUser, 1)
    assert.equal(ctx.calls.getDocCalls, 0, 'no point retrying the read once the Auth account itself is gone')
  } finally {
    ctx.close()
  }
})

test('a non permission-denied error on the profile listener is left alone (no refresh, no logout)', async () => {
  const ctx = await setup({
    getIdToken: async () => 'fresh-token',
    getDocAfterRefresh: { exists: () => true, data: () => ({ role: 'user' }) },
  })
  try {
    await ctx.triggerProfileError(Object.assign(new Error('offline'), { code: 'unavailable' }))
    assert.equal(ctx.calls.getDocCalls, 0)
    assert.equal(ctx.calls.logoutUser, 0)
  } finally {
    ctx.close()
  }
})
