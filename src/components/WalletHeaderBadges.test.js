import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// Testa só a view pura (WalletHeaderBadgesView), com props diretas -- sem precisar
// mockar useAuth/useWallet/Supabase (mesmo espírito de PromoteDialogBody vs
// PromoteDialog). O wrapper com hooks (WalletHeaderBadges) só passa adiante o que
// useAuth()/useWallet() já devolvem, sem lógica própria pra testar aqui.
let directory
let renderStatic
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'wallet-header-badges-tests-'))
  const outfile = join(directory, 'wallet-header-badges.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import { WalletHeaderBadgesView } from './WalletHeaderBadges.jsx'
        export const renderStatic = (props) => renderToStaticMarkup(
          createElement(MemoryRouter, {}, createElement(WalletHeaderBadgesView, props))
        )
      `,
      resolveDir: new URL('.', import.meta.url).pathname.replace(/^\/(.:)/, '$1'),
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    // WalletHeaderBadges.jsx importa useAuth/useWallet no topo do arquivo -- mesmo só
    // usando WalletHeaderBadgesView (que não chama nenhum hook), o bundle inteiro é
    // avaliado, incluindo a cadeia até supabase/config.js, que lê import.meta.env.VITE_*
    // (só existe via Vite em dev/build real). Mesmo stub de SuperAdminRoute.test.js --
    // só precisa não explodir ao carregar o módulo, useAuth/useWallet nunca são
    // chamados por esta view.
    define: {
      'import.meta.env': JSON.stringify({
        VITE_SUPABASE_URL: 'https://test.supabase.co',
        VITE_SUPABASE_ANON_KEY: 'test',
        DEV: false,
      }),
    },
  })
  ;({ renderStatic } = createRequire(import.meta.url)(outfile))
})
after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('renders nothing when there is no authenticated user -- never shows a balance without a signed-in owner', () => {
  const html = renderStatic({ visible: false, loading: false, coinBalance: 999, cashBalance: 999 })
  assert.equal(html, '')
})

test('shows the real coinBalance/cashBalance values, formatted with thousands grouping', () => {
  const html = renderStatic({ visible: true, loading: false, coinBalance: 1234, cashBalance: 56 })
  assert.match(html, /1\.234/)
  assert.match(html, />56</)
})

test('o saldo do cabeçalho abre a central educativa sem criar outro item de menu', () => {
  const html = renderStatic({ visible: true, loading: false, coinBalance: 2, cashBalance: 5 })
  assert.match(html, /href="\/entenda-suas-moedas"/)
  assert.match(html, /aria-label="Entenda suas moedas e veja seus saldos de EvoCoins e EvoCash"/)
})

test('shows a discreet placeholder while loading, never a stale or invented number', () => {
  const html = renderStatic({ visible: true, loading: true, coinBalance: 42, cashBalance: 100 })
  assert.doesNotMatch(html, />42</)
  assert.doesNotMatch(html, />100</)
  assert.equal((html.match(/>—</g) || []).length, 2, 'um placeholder pra cada indicador')
})

test('never renders an emoji anywhere in the balance indicators', () => {
  const html = renderStatic({ visible: true, loading: false, coinBalance: 5, cashBalance: 5 })
  // Faixa comum de emoji (inclui símbolos/pictogramas) -- nenhum caractere nessa faixa
  // deveria aparecer no HTML gerado.
  assert.doesNotMatch(html, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u)
})

test('a zero balance still renders as "0", never hidden or blank (never invents/omits real data)', () => {
  const html = renderStatic({ visible: true, loading: false, coinBalance: 0, cashBalance: 0 })
  assert.equal((html.match(/>0</g) || []).length, 2)
})

test('mostra o progresso diário vindo do servidor no indicador de EvoCoins, sem alterar o saldo', () => {
  const html = renderStatic({
    visible: true,
    loading: false,
    coinBalance: 12,
    cashBalance: 3,
    dailyProgress: 'EvoCoins de hoje: 7 / 10',
  })
  assert.match(html, /title="12 EvoCoins · EvoCoins de hoje: 7 \/ 10"/)
  assert.match(html, />12</)
})

test('sem progresso diário o indicador segue idêntico ao anterior', () => {
  const html = renderStatic({ visible: true, loading: false, coinBalance: 12, cashBalance: 3 })
  assert.match(html, /title="12 EvoCoins"/)
})
