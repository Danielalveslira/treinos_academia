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
import previousArchive from '../../functions/legal/test-fixtures/1.3.0.json' with { type: 'json' }

let directory
let render
let mount
let act
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'protected-route-tests-'))
  const outfile = join(directory, 'route.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import TestRenderer, { act } from 'react-test-renderer'
        import { MemoryRouter } from 'react-router-dom'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { AuthContext } from '../contexts/AuthContext.jsx'
        import { ProtectedRoute } from './ProtectedRoute.jsx'
        export const render = (authValue) => renderToStaticMarkup(createElement(ThemeProvider, null,
          createElement(BaseStyles, null, createElement(MemoryRouter, null,
            createElement(AuthContext.Provider, { value: authValue },
              createElement(ProtectedRoute, null, createElement('div', null, 'CONTEUDO_PROTEGIDO')))))))
        export { act }
        export const mount = (authValue) => TestRenderer.create(createElement(MemoryRouter, null,
          createElement(AuthContext.Provider, { value: authValue },
            createElement(ProtectedRoute, null, createElement('div', null, 'CONTEUDO_PROTEGIDO')))))
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
  ;({ render, mount, act } = createRequire(import.meta.url)(outfile))
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

test('a user who accepted 1.3.0 sees the 1.4.0 confirmation before protected content', () => {
  const html = render({
    ...baseAuth,
    profile: {
      ...baseAuth.profile,
      legalAcceptance: {
        version: previousArchive.manifest.version,
        digest: digests[previousArchive.manifest.version],
        acceptedAt: {},
      },
    },
  })
  assert.match(html, /Antes de continuar/)
  assert.match(html, /Leia a versão 1\.4\.0/)
  assert.match(html, /Li e aceito os/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('returning to an open tab checks whether the active legal policy changed', () => {
  const previousDocument = globalThis.document
  const listeners = new Map()
  const requestedUsers = []
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener(type, callback) { listeners.set(type, callback) },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type)
    },
  }
  let view
  try {
    act(() => {
      view = mount({
        ...baseAuth,
        refreshLegalAccess: (uid) => requestedUsers.push(uid),
      })
    })
    assert.equal(typeof listeners.get('visibilitychange'), 'function')
    act(() => listeners.get('visibilitychange')())
    assert.deepEqual(requestedUsers, [])
    globalThis.document.visibilityState = 'visible'
    act(() => listeners.get('visibilitychange')())
    assert.deepEqual(requestedUsers, ['u1'])
    act(() => view.unmount())
    assert.equal(listeners.has('visibilitychange'), false)
  } finally {
    globalThis.document = previousDocument
  }
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

// Bug "conta com exclusão bloqueada": a mesma trava do Firestore que bloqueia uma
// exclusão em andamento também nega a leitura do perfil quando o job está
// blocked_financial_review (ver getOwnStatus em deletion-service.js), então profile é
// null e profileError também está preenchido aqui -- sem este gate ter prioridade, a
// tela genérica de "Não foi possível carregar sua conta" apareceria em vez do aviso
// específico (que nunca cita saldo/motivo financeiro).
test('a deletion blocked for financial review shows its own gate, never the generic profile-load error', () => {
  const html = render({
    ...baseAuth,
    profile: null,
    profileError: 'Não foi possível carregar seu perfil.',
    deletionStatus: 'blocked_financial_review',
  })
  assert.match(html, /Exclusão em revisão financeira/)
  assert.match(html, /atendimento/)
  assert.doesNotMatch(html, /Não foi possível carregar sua conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

// Validação final, item 3: a tela precisa dar um caminho de verdade até o atendimento
// (link navegável, não só a palavra no texto) e nunca citar saldo/valor -- getMyDeletionStatus
// já nunca devolve isso, mas a própria cópia da tela reforça essa garantia por conta
// própria. "Sair da conta" precisa existir para permitir encerrar a sessão manualmente
// (ver DisabledAccountGate, mesmo padrão), já que aqui a sessão não é encerrada sozinha.
test('the financial-review gate links to /atendimento, offers a manual sign-out, and never mentions a balance', () => {
  const html = render({
    ...baseAuth,
    profile: null,
    profileError: 'Não foi possível carregar seu perfil.',
    deletionStatus: 'blocked_financial_review',
  })
  assert.match(html, /href="\/atendimento"/)
  assert.match(html, /Sair da conta/)
  assert.doesNotMatch(html, /saldo/i)
  assert.doesNotMatch(html, /R\$/)
})

test('an active account never sees the deletion-blocked gate', () => {
  const html = render(baseAuth)
  assert.doesNotMatch(html, /Exclusão em revisão financeira/)
})
