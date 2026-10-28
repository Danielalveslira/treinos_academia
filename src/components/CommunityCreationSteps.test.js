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
        import { PaymentStep, RetentionStep } from './communityCreation/CreationSteps.jsx'

        const wrap = (child) => renderToStaticMarkup(createElement(StaticRouter, { location: '/' },
          createElement(ThemeProvider, null, createElement(BaseStyles, null, child))))
        export const renderPanel = (props) => wrap(createElement(EligibilityPanel, props))
        export const renderRetention = (props) => wrap(createElement(RetentionStep, props))
        export const renderPayment = (props) => wrap(createElement(PaymentStep, props))
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

const base = {
  eligible: false,
  accountDays: 24,
  requiredAccountDays: 30,
  qualifiedDays: 16,
  requiredQualifiedDays: 20,
  emailVerified: true,
  accountStanding: 'regular',
  activeOwnedCommunities: 1,
  communityLimit: 3,
  evoCoinsBalance: 420,
  evoCashBalance: 0,
  qualifiedToday: false,
}

test('mostra o progresso mesmo sem elegibilidade, com o que falta e o botão bloqueado', () => {
  const html = render.renderPanel({ eligibility: base, onContinue() {} })
  assert.match(html, /Sua elegibilidade/)
  assert.match(html, /24 \/ 30 dias/)
  assert.match(html, /16 \/ 20 dias ativos/)
  assert.match(html, /1 \/ 3/)
  assert.match(html, /420/)
  assert.match(html, /Você ainda não pode criar uma comunidade\./)
  assert.match(html, /Faltam 6 dias de conta e 4 dias ativos para liberar a criação\./)
  assert.match(html, /role="progressbar"|aria-valuenow="80"/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>(?:<[^>]+>)*Continuar/)
})

test('elegível: botão liberado e sem mensagem de pendência', () => {
  const html = render.renderPanel({
    eligibility: {
      ...base,
      eligible: true,
      accountDays: 31,
      qualifiedDays: 22,
      qualifiedToday: true,
    },
    onContinue() {},
  })
  assert.match(html, /Você já pode criar uma comunidade/)
  assert.match(html, /Você usou o Evolutus o suficiente hoje\./)
  assert.doesNotMatch(html, /Faltam/)
  assert.doesNotMatch(html, /<button[^>]*disabled=""[^>]*>(?:<[^>]+>)*Continuar/)
  assert.match(html, /<button[^>]*>(?:<[^>]+>)*Continuar/)
})

test('restrição: texto genérico, atendimento, e nenhum motivo sensível', () => {
  const html = render.renderPanel({
    eligibility: { ...base, accountStanding: 'unavailable' },
    onContinue() {},
  })
  assert.match(html, /Sua conta não está elegível para criar comunidades neste momento\./)
  assert.match(html, /href="\/atendimento"/)
  assert.doesNotMatch(html, /suspens|banimento|moderaç|fraude|automa/i)
})

test('retenção: três cartões; Arquivo sem preço aparece como "em breve" e desabilitado', () => {
  const html = render.renderRetention({
    tier: 'essential',
    products: [
      { tier: 'essential', postRetentionMode: '24h', evoCoinsPrice: 300, evoCashPrice: null },
      { tier: 'plus', postRetentionMode: '30d', evoCoinsPrice: 600, evoCashPrice: null },
      {
        tier: 'archive',
        postRetentionMode: 'no_auto_expiration',
        evoCoinsPrice: null,
        evoCashPrice: null,
      },
    ],
    onSelect() {},
    onBack() {},
    onNext() {},
  })
  assert.match(html, /24 horas/)
  assert.match(html, /30 dias/)
  assert.match(html, /Sem expiração automática/)
  assert.match(html, /em breve/)
  assert.match(html, /aria-checked="true"/)
  assert.match(html, /<button[^>]*role="radio"[^>]*disabled[^>]*>.*?Sem expiração automática/s)
})

test('pagamento: só opções válidas, saldo exibido, insuficiente desabilitado', () => {
  const html = render.renderPayment({
    product: { tier: 'essential', postRetentionMode: '24h', evoCoinsPrice: 300, evoCashPrice: 50 },
    eligibility: { ...base, evoCoinsBalance: 420, evoCashBalance: 10 },
    method: 'evocoins',
    onSelect() {},
    onBack() {},
    onNext() {},
  })
  assert.match(html, /300 EvoCoins/)
  assert.match(html, /Saldo: 420 EvoCoins/)
  assert.match(html, /50 EvoCash/)
  assert.match(html, /Saldo insuficiente/)
  assert.match(html, /href="\/evocash"/)
})
