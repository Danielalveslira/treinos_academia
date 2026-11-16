import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR4: cotação e checkout do EvoCash são guardas independentes no servidor
// (quotingEnabled/checkoutEnabled); o painel não pode mais afirmar um texto fixo sobre
// "cobranças desativadas" desacoplado do estado real retornado por getEvoCashPricing().
let directory
let mount

const STUBS = {
  evocashPricingService: `
    export const getEvoCashPricing = () => globalThis.__ecGetPricing()
    export const listEvoCashPrices = () => Promise.resolve({ items: [], nextCursor: null })
    export const pauseEvoCashQuotes = async () => {}
    export const previewEvoCashPrice = async () => ({})
    export const publishEvoCashPrice = async () => {}
    export const reauthenticatePricingAdmin = async () => {}
  `,
  AuthCaptcha: `import { forwardRef } from 'react'
    export const AuthCaptcha = forwardRef(function AuthCaptcha(_props, ref) { return null })`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evocash-pricing-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { EvoCashPricingPanel } from './EvoCashPricing.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(EvoCashPricingPanel))))
          })
          return {
            text: () => textOf(renderer.toJSON()),
            unmount: () => act(() => renderer.unmount()),
          }
        }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    jsx: 'automatic',
    loader: { '.js': 'jsx', '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    plugins: [
      {
        name: 'stubs',
        setup(b) {
          for (const name of Object.keys(STUBS)) {
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\.jsx?)?$`) }, () => ({
              path: name,
              namespace: 'stub',
            }))
          }
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: STUBS[args.path],
            resolveDir: root,
            loader: 'jsx',
          }))
        },
      },
    ],
  })
  ;({ mountPage: mount } = createRequire(import.meta.url)(outfile))
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 30))

const baseState = {
  revision: '1',
  serverTime: new Date().toISOString(),
  current: null,
  latest: null,
}

test('nunca mais afirma um texto fixo sobre cobranças desativadas', async () => {
  globalThis.__ecGetPricing = () =>
    Promise.resolve({ ...baseState, quotingEnabled: true, checkoutEnabled: true })
  const page = mount()
  await tick()
  assert.doesNotMatch(page.text(), /[Nn]ovas cobranças desativadas/)
  page.unmount()
})

test('cotação e checkout habilitados: nenhum aviso de pausa aparece', async () => {
  globalThis.__ecGetPricing = () =>
    Promise.resolve({ ...baseState, quotingEnabled: true, checkoutEnabled: true })
  const page = mount()
  await tick()
  assert.match(page.text(), /Cotações habilitadas/)
  assert.match(page.text(), /Checkout habilitado/)
  assert.doesNotMatch(page.text(), /pausad[oa]/i)
  page.unmount()
})

test('cotação habilitada mas checkout pausado: avisa só sobre o checkout, não sobre a cotação', async () => {
  globalThis.__ecGetPricing = () =>
    Promise.resolve({ ...baseState, quotingEnabled: true, checkoutEnabled: false })
  const page = mount()
  await tick()
  assert.match(page.text(), /Cotações habilitadas/)
  assert.match(page.text(), /Checkout pausado/)
  assert.match(page.text(), /Checkout de compra está pausado/)
  page.unmount()
})

test('cotação e checkout pausados: ambos os rótulos refletem o estado real', async () => {
  globalThis.__ecGetPricing = () =>
    Promise.resolve({ ...baseState, quotingEnabled: false, checkoutEnabled: false })
  const page = mount()
  await tick()
  assert.match(page.text(), /Cotações pausadas/)
  assert.match(page.text(), /Checkout pausado/)
  page.unmount()
})
