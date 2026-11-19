import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import manifest from '../../legal/manifest.json' with { type: 'json' }
import documents from '../../legal/documents.json' with { type: 'json' }
import digests from '../../legal/approved-digests.json' with { type: 'json' }
import previousArchive from '../../legal/test-fixtures/1.3.0.json' with { type: 'json' }
import archive14 from '../../legal/test-fixtures/1.4.0.json' with { type: 'json' }

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
    // ProtectedRoute -> LegalGate -> legalService.js -> supabase/config.js, que lê
    // import.meta.env.VITE_* (só existe via Vite em dev/build real). getLegalAccess()
    // nunca chega a ser chamado num renderToStaticMarkup (useEffect não roda em SSR) --
    // só createClient() precisa não explodir na hora de montar o módulo.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
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
    // ProfileCompletionGate (ver ProtectedRoute.jsx) dispara por !profile.username --
    // toda conta simulada aqui é "completa" por padrão (como a maioria dos cenários
    // reais já é). Os testes do próprio gate, mais abaixo, sobrescrevem isto de
    // propósito para testar username ausente.
    username: 'maria',
    createdAt: { toDate: () => new Date('2020-01-01') },
    legalAcceptance: {
      version: manifest.version,
      digest: digests[manifest.version],
      acceptedAt: {},
    },
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

// Achado #2 da auditoria de segurança: setAccountStatus (RPC) só grava
// accountStatus:'disabled' na tabela users, nunca revoga o token do Auth -- sem este gate,
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

test('sessão auth_setup não monta conteúdo protegido nem depende de leitura de perfil', () => {
  const html = render({ ...baseAuth, restrictedScope: 'auth_setup', profile: null, serverAccessAllowed: false })
  assert.match(html, /Conclua seu cadastro/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
  assert.doesNotMatch(html, /Não foi possível carregar sua conta/)
})

test('sessão de recuperação não monta perfil, termos ou conteúdo protegido', () => {
  const html = render({ ...baseAuth, restrictedScope: 'auth_recovery', profile: null, serverAccessAllowed: false })
  assert.match(html, /Continue a verificação da conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

// ProfileCompletionGate (ver ProtectedRoute.jsx): dispara por !profile.username, depois
// das guardas de bloqueio/exclusão e antes do LegalGate.
test('a loaded profile without username shows ProfileCompletionGate, never LegalGate nor protected content', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, username: null },
  })
  // O formulário do gate é carregado sob demanda (lazy): no render estático aparece o fallback
  // dele -- o que importa aqui é que é o gate, e não o LegalGate nem o conteúdo protegido.
  assert.match(html, /Complete seu cadastro|profile-completion-loading/)
  // id="legal-gate-title", não o texto "Antes de continuar" -- esse texto também
  // aparece (coincidentemente) no corpo do próprio ProfileCompletionGate.
  assert.doesNotMatch(html, /legal-gate-title/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a blocked account without username still sees the block gate, never ProfileCompletionGate (block guards come first)', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, username: null, accountStatus: 'disabled', disabledReason: 'Spam' },
  })
  assert.match(html, /Conta desativada/)
  assert.doesNotMatch(html, /Complete seu cadastro/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a profile with username goes straight to LegalGate/protected content, never ProfileCompletionGate', () => {
  const html = render(baseAuth)
  assert.doesNotMatch(html, /Complete seu cadastro/)
  assert.match(html, /CONTEUDO_PROTEGIDO/)
})

// F1/F1.2 fecharam o gate de autorização no servidor (has_app_access()) para contas em
// exclusão, suspensas e banidas; o frontend ainda não tinha uma tela dedicada pra nenhum
// dos 3 -- caíam no genérico "Acesso indisponível" (sem logout nem link de atendimento) ou,
// no caso de 'deleting', nem isso (nenhum gate reconhecia esse accountStatus).
test('an account in deletion sees the account-blocked gate, never the protected content', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, accountStatus: 'deleting' },
  })
  assert.match(html, /Conta em exclusão/)
  assert.match(html, /href="\/atendimento"/)
  assert.match(html, /Sair da conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a temporarily suspended account sees the account-blocked gate with the suspension deadline', () => {
  const html = render({
    ...baseAuth,
    legalAccess: {
      ...baseAuth.legalAccess,
      restriction: { action: 'temporary_suspension', until: '2099-01-01T12:00:00Z' },
    },
  })
  assert.match(html, /Conta suspensa temporariamente/)
  assert.match(html, /href="\/atendimento"/)
  assert.match(html, /Sair da conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('an expired temporary suspension never triggers the account-blocked gate', () => {
  const html = render({
    ...baseAuth,
    legalAccess: {
      ...baseAuth.legalAccess,
      restriction: { action: 'temporary_suspension', until: '2020-01-01T12:00:00Z' },
    },
  })
  assert.doesNotMatch(html, /Conta suspensa temporariamente/)
  assert.match(html, /CONTEUDO_PROTEGIDO/)
})

test('a permanently banned account sees the account-blocked gate and the appeal-prefilled support link', () => {
  const html = render({
    ...baseAuth,
    legalAccess: { ...baseAuth.legalAccess, restriction: { action: 'system_ban', until: null } },
  })
  assert.match(html, /Conta banida/)
  assert.match(html, /href="\/atendimento\?tipo=appeal"/)
  assert.match(html, /Sair da conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('accountStatus deleting/disabled take priority over an account_restrictions row (defensive, should never coexist)', () => {
  const html = render({
    ...baseAuth,
    profile: { ...baseAuth.profile, accountStatus: 'disabled', disabledReason: 'Spam' },
    legalAccess: { ...baseAuth.legalAccess, restriction: { action: 'system_ban', until: null } },
  })
  assert.match(html, /Conta desativada/)
  assert.doesNotMatch(html, /Conta banida/)
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

const currentVersionPattern = new RegExp(`Leia a versão ${manifest.version.replace(/\./g, '\\.')}`)

test('a user who accepted 1.3.0 sees the current-version confirmation before protected content', () => {
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
  assert.match(html, currentVersionPattern)
  assert.match(html, /Li e aceito os/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('a user who accepted 1.4.0 sees the current-version confirmation; one who accepted the current version goes straight in', () => {
  const accepted = (version) => ({
    ...baseAuth,
    profile: { ...baseAuth.profile, legalAcceptance: { version, digest: digests[version], acceptedAt: {} } },
  })
  const html = render(accepted(archive14.manifest.version))
  assert.match(html, /Antes de continuar/)
  assert.match(html, currentVersionPattern)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

test('returning to an open tab checks the legal policy in the background, at most once per interval', () => {
  const previousDocument = globalThis.document
  const realNow = Date.now
  let now = realNow()
  Date.now = () => now
  const listeners = new Map()
  const requestedUsers = []
  globalThis.document = {
    visibilityState: 'hidden',
    addEventListener(type, callback) {
      listeners.set(type, callback)
    },
    removeEventListener(type, callback) {
      if (listeners.get(type) === callback) listeners.delete(type)
    },
  }
  let view
  try {
    act(() => {
      view = mount({
        ...baseAuth,
        refreshLegalAccess: (uid, options) => requestedUsers.push([uid, options]),
      })
    })
    assert.equal(typeof listeners.get('visibilitychange'), 'function')
    act(() => listeners.get('visibilitychange')())
    assert.deepEqual(requestedUsers, [])
    globalThis.document.visibilityState = 'visible'
    // logo após o boot (dados legais acabaram de ser lidos): nada a revalidar
    act(() => listeners.get('visibilitychange')())
    assert.deepEqual(requestedUsers, [])
    now += 60 * 1000
    act(() => listeners.get('visibilitychange')())
    // silent: não liga o spinner global nem desmonta a tela atual
    assert.deepEqual(requestedUsers, [['u1', { silent: true }]])
    act(() => listeners.get('visibilitychange')())
    assert.equal(requestedUsers.length, 1)
    act(() => view.unmount())
    assert.equal(listeners.has('visibilitychange'), false)
  } finally {
    globalThis.document = previousDocument
    Date.now = realNow
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

// Bug "conta com exclusão bloqueada": a mesma trava do Postgres que bloqueia uma
// exclusão em andamento também nega a leitura do perfil quando o job está
// blocked_financial_review (ver run_deletion_job na migration do deletion worker), então profile é
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
  assert.match(html, /Exclusão em análise/)
  assert.match(html, /Em revisão financeira/)
  assert.match(html, /atendimento/)
  assert.doesNotMatch(html, /Não foi possível carregar sua conta/)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})

// Validação final, item 3: a tela precisa dar um caminho de verdade até o atendimento
// (link navegável, não só a palavra no texto) e nunca citar saldo/valor -- getMyDeletionStatus
// já nunca devolve isso, mas a própria cópia da tela reforça essa garantia por conta
// própria. "Sair da conta" precisa existir para permitir encerrar a sessão manualmente
// (ver AccountBlockedGate, mesmo padrão), já que aqui a sessão não é encerrada sozinha.
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
  assert.doesNotMatch(html, /Exclusão em análise/)
})

// Exclusão em análise (revisão completa): protocolo da solicitação e andamento, sem nunca
// citar saldo/valor -- o servidor (get_my_deletion_review) nem devolve esses dados.
test('the deletion gate shows the protocol and progress while the financial review is open', () => {
  const html = render({
    ...baseAuth,
    profile: null,
    profileError: 'Não foi possível carregar seu perfil.',
    deletionStatus: 'blocked_financial_review',
    deletionReview: {
      state: 'blocked_financial_review',
      protocol: 'EXC-000042',
      requestedAt: '2026-10-01T12:00:00Z',
      financialCaseSeparated: false,
      financialCaseProtocol: null,
    },
  })
  assert.match(html, /Exclusão em análise/)
  assert.match(html, /EXC-000042/)
  assert.match(html, /Situação atual: <strong>Em revisão financeira/)
  assert.match(html, /Andamento da exclusão/)
  assert.doesNotMatch(html, /Pendência financeira separada/)
  assert.doesNotMatch(html, /continuará sendo tratado separadamente/)
  assert.doesNotMatch(html, /saldo/i)
  assert.doesNotMatch(html, /R\$/)
})

test('once the financial case is separated the gate says the process continues separately and shows the case protocol', () => {
  const html = render({
    ...baseAuth,
    profile: null,
    profileError: 'Não foi possível carregar seu perfil.',
    deletionStatus: 'pending',
    deletionReview: {
      state: 'pending',
      protocol: 'EXC-000042',
      requestedAt: '2026-10-01T12:00:00Z',
      financialCaseSeparated: true,
      financialCaseProtocol: 'FIN-000007',
    },
  })
  assert.match(
    html,
    /Seu processo financeiro continuará sendo tratado separadamente\. A exclusão da conta seguirá normalmente\./
  )
  assert.match(html, /Situação atual: <strong>Exclusão em andamento/)
  assert.match(html, /Pendência financeira separada/)
  assert.match(html, /FIN-000007/)
  assert.match(html, /href="\/atendimento"/)
  assert.doesNotMatch(html, /saldo/i)
  assert.doesNotMatch(html, /CONTEUDO_PROTEGIDO/)
})
