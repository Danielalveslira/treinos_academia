import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import manifest from '../../functions/legal/manifest.json' with { type: 'json' }
import documents from '../../functions/legal/documents.json' with { type: 'json' }
import digests from '../../functions/legal/approved-digests.json' with { type: 'json' }

let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'protected-route-tests-'))
  const outfile = join(directory, 'route.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { AuthContext } from '../contexts/AuthContext.jsx'
        import { ProtectedRoute } from './ProtectedRoute.jsx'
        export const render = (authValue) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null,
            createElement(AuthContext.Provider, { value: authValue },
              createElement(ProtectedRoute, null, createElement('div', null, 'CONTEUDO_PROTEGIDO')))))))
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    // ProtectedRoute -> LegalGate -> legalService.js -> firebase/config.js, que lê
    // import.meta.env.VITE_* (só existe via Vite em dev/build real). getLegalAccess()
    // nunca chega a ser chamado num renderToStaticMarkup (useEffect não roda em SSR) --
    // só initializeApp() precisa não explodir na hora de montar o módulo.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_FIREBASE_API_KEY: 'test',
        VITE_FIREBASE_AUTH_DOMAIN: 'test',
        VITE_FIREBASE_PROJECT_ID: 'test',
        VITE_FIREBASE_STORAGE_BUCKET: 'test',
        VITE_FIREBASE_MESSAGING_SENDER_ID: 'test',
        VITE_FIREBASE_APP_ID: 'test',
        VITE_USE_FIREBASE_EMULATOR: 'false',
        DEV: false,
      }),
    },
  })
  ;({ render } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const baseAuth = {
  user: { uid: 'u1', emailVerified: true },
  profile: {
    role: 'user',
    createdAt: { toDate: () => new Date('2020-01-01') },
    legalAcceptance: { version: manifest.version, digest: digests[manifest.version], acceptedAt: {} },
  },
  profileError: '',
  legalAccess: {
    policy: { version: manifest.version, published: true, digest: digests[manifest.version] },
    legalBundle: { manifest, documents, digest: digests[manifest.version] },
  },
  legalLoading: false,
  legalError: '',
  loading: false,
  verifyingSession: false,
}

// Achado #2 da auditoria de segurança: setAccountStatus (Cloud Function) só grava
// accountStatus:'disabled' no Firestore, nunca revoga o token do Auth -- sem este gate,
// o usuário via os próprios children normalmente (a única coisa que de fato bloqueava
// era cada leitura subsequente falhando com um erro genérico, sem nunca dizer o motivo).
test('a disabled account sees the disabled-account gate, never the protected content', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, accountStatus: 'disabled', disabledReason: 'Spam' },
  })
  assert.match(html, /Conta desativada/)
  assert.match(html, /Spam/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('an active account never sees the disabled-account gate', () => {
  const html = render(baseAuth)
  assert.doesNotMatch(html, /Conta desativada/)
  assert.doesNotMatch(html, /Antes de continuar/)
  assert.match(html, /CONTEUDO_PROTEGIDO/)
})

test('legal state still loading shows only a neutral spinner', () => {
  const html = render({ ...baseAuth, legalAccess: null, legalLoading: true })
  assert.match(html, /Verificando acesso/)
  assert.doesNotMatch(html, /Antes de continuar/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a user without the current acceptance sees the legal form', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, legalAcceptance: undefined },
  })
  assert.match(html, /Antes de continuar/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a legal network error has a specific screen', () => {
  const html = render({
    ...baseAuth,
    legalAccess: null,
    legalError: 'Não foi possível consultar a policy e as restrições atuais.',
  })
  assert.match(html, /Não foi possível verificar seu acesso/)
  assert.match(html, /Verifique sua conexão/)
  assert.doesNotMatch(html, /documentos estão sendo atualizados/i)
})

test('a profile load failure never turns into a legal acceptance request', () => {
  const html = render({
    ...baseAuth,
    profile: null,
    profileError: 'Não foi possível carregar seu perfil.',
  })
  assert.match(html, /Não foi possível carregar sua conta/)
  assert.doesNotMatch(html, /Antes de continuar/)
})
