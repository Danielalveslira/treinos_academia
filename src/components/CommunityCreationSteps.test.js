import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Mesmo padrão de CommercialAdmin.test.js: renderToStaticMarkup com ThemeProvider do Primer.
let directory
let render
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'community-creation-steps-tests-'))
  const outfile = join(directory, 'panel.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { StaticRouter } from 'react-router'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { EligibilityPanel } from './communityCreation/EligibilityPanel.jsx'
        import { ConfigStep } from './communityCreation/CreationSteps.jsx'

        const wrap = (child) => renderToStaticMarkup(createElement(StaticRouter, { location: '/' },
          createElement(ThemeProvider, null, createElement(BaseStyles, null, child))))
        export const renderPanel = (props) => wrap(createElement(EligibilityPanel, props))
        export const renderConfig = (props) => wrap(createElement(ConfigStep, props))
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
  })
  render = createRequire(import.meta.url)(outfile)
})
after(() => rm(directory, { recursive: true, force: true }))

// Dias de conta/dias ativos não são mais requisito (eligibility_simplify) -- base já reflete
// isso: eligible=true por padrão.
const base = {
  eligible: true,
  accountDays: 2,
  requiredAccountDays: 30,
  qualifiedDays: 0,
  requiredQualifiedDays: 20,
  emailVerified: true,
  accountStanding: 'regular',
  activeOwnedCommunities: 1,
  communityLimit: 3,
  evoCoinsBalance: 420,
  evoCashBalance: 0,
  freeCommunityAvailable: true,
}

test('elegível: só a mensagem de sucesso, sem checklist nem botão (o botão vive na etapa Informações)', () => {
  const html = render.renderPanel({ eligibility: base })
  assert.match(html, /Tudo certo! Você já pode criar uma comunidade\./)
  assert.doesNotMatch(html, /community-eligibility-item/)
  assert.doesNotMatch(html, /<button/)
})

test('não elegível por e-mail: mostra só a pendência de e-mail (sem dias, que não são mais requisito)', () => {
  const html = render.renderPanel({ eligibility: { ...base, eligible: false, emailVerified: false } })
  assert.match(html, /E-mail confirmado/)
  assert.match(html, /Confirme seu e-mail/)
  assert.doesNotMatch(html, /dias de conta|dias ativos/)
  assert.match(html, /Falta confirmar seu e-mail para liberar a criação\./)
})

test('restrição: texto genérico, atendimento, e nenhum motivo sensível', () => {
  const html = render.renderPanel({
    eligibility: { ...base, eligible: false, accountStanding: 'unavailable' },
  })
  assert.match(html, /Sua conta não está elegível para criar comunidades neste momento\./)
  assert.match(html, /href="\/atendimento"/)
  assert.doesNotMatch(html, /suspens|banimento|moderaç|fraude|automa/i)
})

const products = [
  { tier: 'starter', postRetentionMode: '24h', evoCoinsPrice: null, evoCashPrice: null, free: true },
  { tier: 'essential', postRetentionMode: '24h', evoCoinsPrice: 300, evoCashPrice: null, free: false },
  { tier: 'plus', postRetentionMode: '30d', evoCoinsPrice: 600, evoCashPrice: null, free: false },
  {
    tier: 'archive',
    postRetentionMode: 'no_auto_expiration',
    evoCoinsPrice: null,
    evoCashPrice: null,
    free: false,
  },
]

test('modalidade: grátis em destaque, Arquivo sem preço "em breve" e desabilitado, post_access sempre visível', () => {
  const html = render.renderConfig({
    products,
    eligibility: base,
    tier: 'starter',
    postAccess: 'everyone',
    paymentMethod: null,
    onSelectTier() {},
    onSelectPostAccess() {},
    onSelectPayment() {},
    onBack() {},
    onNext() {},
  })
  assert.match(html, /Grátis/)
  assert.match(html, /em breve/)
  assert.match(html, /community-choice-free/)
  assert.match(html, /<button[^>]*role="radio"[^>]*disabled[^>]*>.*?Sem expiração automática/s)
  assert.match(html, /Quem pode publicar\?/)
  assert.match(html, /Somente moderadores/)
  // tier grátis selecionado: nenhuma seção de forma de pagamento é exibida.
  assert.doesNotMatch(html, /Forma de pagamento/)
})

test('modalidade grátis fica desabilitada quando o benefício já foi usado (mesmo com preço free)', () => {
  const html = render.renderConfig({
    products,
    eligibility: { ...base, freeCommunityAvailable: false },
    tier: null,
    postAccess: 'everyone',
    paymentMethod: null,
    onSelectTier() {},
    onSelectPostAccess() {},
    onSelectPayment() {},
    onBack() {},
    onNext() {},
  })
  assert.match(html, /benefício já usado/)
  assert.match(html, /<button[^>]*role="radio"[^>]*disabled[^>]*>(?:<[^>]+>)*Grátis/s)
})

test('modalidade paga: forma de pagamento aparece, só opções com preço válido, saldo insuficiente marcado', () => {
  const html = render.renderConfig({
    products: [
      { tier: 'essential', postRetentionMode: '24h', evoCoinsPrice: 300, evoCashPrice: 50, free: false },
    ],
    eligibility: { ...base, evoCoinsBalance: 420, evoCashBalance: 10 },
    tier: 'essential',
    postAccess: 'everyone',
    paymentMethod: 'evocoins',
    onSelectTier() {},
    onSelectPostAccess() {},
    onSelectPayment() {},
    onBack() {},
    onNext() {},
  })
  assert.match(html, /Forma de pagamento/)
  assert.match(html, /300 EvoCoins/)
  assert.match(html, /Saldo: 420 EvoCoins/)
  assert.match(html, /50 EvoCash/)
  assert.match(html, /Faltam 40 EvoCash/)
  assert.match(html, /href="\/evocash"/)
})
