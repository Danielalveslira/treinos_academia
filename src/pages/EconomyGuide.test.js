import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
let directory
let render

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'economy-guide-test-'))
  const outfile = join(directory, 'guide.cjs')
  await build({
    stdin: {
      contents: `
        import { createElement } from 'react'
        import { renderToStaticMarkup } from 'react-dom/server'
        import { MemoryRouter } from 'react-router-dom'
        import EconomyGuide from './EconomyGuide.jsx'
        import { setWallet } from '../hooks/useWallet'
        export function render(state) {
          setWallet(state)
          return renderToStaticMarkup(createElement(MemoryRouter, {}, createElement(EconomyGuide)))
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [
      {
        name: 'guide-stubs',
        setup(ctx) {
          ctx.onResolve(
            { filter: /^(react|react\/jsx-runtime|react-dom\/server|react-router-dom)$/ },
            ({ path }) => ({ path: require.resolve(path) })
          )
          ctx.onResolve({ filter: /hooks\/useWallet$/ }, () => ({
            path: 'wallet',
            namespace: 'stub',
          }))
          ctx.onResolve({ filter: /hooks\/useAuth$/ }, () => ({ path: 'auth', namespace: 'stub' }))
          ctx.onResolve({ filter: /services\/economyService$/ }, () => ({
            path: 'service',
            namespace: 'stub',
          }))
          ctx.onLoad({ filter: /^wallet$/, namespace: 'stub' }, () => ({
            contents:
              'let value; export const setWallet = (next) => { value = next }; export const useWallet = () => value',
          }))
          ctx.onLoad({ filter: /^auth$/, namespace: 'stub' }, () => ({
            contents: "export const useAuth = () => ({ user: { uid: 'self' } })",
          }))
          ctx.onLoad({ filter: /^service$/, namespace: 'stub' }, () => ({
            contents: 'export const listMyEconomyTransactions = async () => []',
          }))
          ctx.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }))
        },
      },
    ],
  })
  render = require(outfile).render
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

test('zero balance and actions render without promising unavailable EvoCash community payment', () => {
  const html = render({
    display: { coinBalance: 0, cashBalance: 0, source: 'server' },
    loading: false,
    error: null,
  })
  assert.match(html, /EvoCoins<\/span><strong>0<\/strong>/)
  assert.match(html, /EvoCash<\/span><strong>0<\/strong>/)
  assert.match(html, /href="\/evocash"/)
  assert.match(html, /href="\/minhas-promocoes"/)
  assert.doesNotMatch(html, /pagar comunidades com EvoCash/)
})

test('existing balances render and offline snapshot is identified', () => {
  const html = render({
    display: { coinBalance: 1250, cashBalance: 25, source: 'snapshot' },
    loading: false,
    error: null,
  })
  assert.match(html, /1\.250/)
  assert.match(html, /<strong>25<\/strong>/)
  assert.match(html, /Saldo salvo neste aparelho/)
})

test('daily limit comes from wallet context rather than a hardcoded promise', () => {
  const html = render({
    display: { coinBalance: 5, cashBalance: 0, source: 'server' },
    loading: false,
    error: null,
    dailyCoins: { earned: 2, limit: 7 },
  })
  assert.match(html, /EvoCoins de hoje: 2 \/ 7/)
})

test('loading and unavailable balances do not invent zero', () => {
  const loading = render({ display: null, loading: true, error: null })
  const failed = render({ display: null, loading: false, error: new Error('network') })
  const incompleteSnapshot = render({
    display: { coinBalance: 3, source: 'snapshot' },
    loading: false,
    error: null,
  })
  assert.match(loading, /Carregando…/)
  assert.match(failed, /Indisponível/)
  assert.match(failed, /Não foi possível consultar o saldo/)
  assert.match(incompleteSnapshot, /EvoCash<\/span><strong>Indisponível<\/strong>/)
})
