import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { build } from 'esbuild'

// PR4: o aviso "resolva essas condições antes de confirmar" é sobre uma confirmação
// ainda pendente -- não pode aparecer quando a identificação já está confirmada
// (configured === true), ou parece um bloqueio novo sobre algo já concluído.
let directory
let mount

const STUBS = {
  supplierInfoGateService: `
    export const getSupplierInfoConfigured = () => globalThis.__sigConfigured()
    export const getSupplierInfoActivationSafety = () => globalThis.__sigSafety()
    export const confirmSupplierInfoConfigured = async () => {}
    export const verifySupplierInfoAudit = async () => ({ createdAt: new Date().toISOString() })
  `,
  evocashPricingService: `export const reauthenticatePricingAdmin = async () => {}`,
  AuthCaptcha: `import { forwardRef } from 'react'
    export const AuthCaptcha = forwardRef(function AuthCaptcha(_props, ref) { return null })`,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'supplier-info-gate-'))
  const outfile = join(directory, 'page.cjs')
  const root = new URL('../../', import.meta.url).pathname
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import SupplierInfoGateAdmin from './SupplierInfoGateAdmin.jsx'
        const textOf = (n) => (typeof n === 'string' ? n : (n.children || []).map(textOf).join(''))
        export function mountPage() {
          globalThis.IS_REACT_ACT_ENVIRONMENT = false
          global.window = global.window || {}
          global.window.matchMedia = global.window.matchMedia || (() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }))
          global.document = global.document || { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => {
            renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(SupplierInfoGateAdmin))))
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

test('configurado (true): mostra conclusão, nunca o aviso de "resolva antes de confirmar"', async () => {
  globalThis.__sigConfigured = () => Promise.resolve(true)
  globalThis.__sigSafety = () => Promise.resolve({ safe: false })
  const page = mount()
  await tick()
  assert.match(page.text(), /Estado: confirmado/)
  assert.doesNotMatch(page.text(), /Resolva essas condições antes de confirmar/)
  page.unmount()
})

test('pendente (false) e inseguro: mostra o aviso real de bloqueio', async () => {
  globalThis.__sigConfigured = () => Promise.resolve(false)
  globalThis.__sigSafety = () => Promise.resolve({ safe: false })
  const page = mount()
  await tick()
  assert.match(page.text(), /Estado: pendente/)
  assert.match(page.text(), /Resolva essas condições antes de confirmar/)
  page.unmount()
})

test('pendente (false) e seguro: nenhum aviso de bloqueio aparece', async () => {
  globalThis.__sigConfigured = () => Promise.resolve(false)
  globalThis.__sigSafety = () => Promise.resolve({ safe: true })
  const page = mount()
  await tick()
  assert.match(page.text(), /Estado: pendente/)
  assert.doesNotMatch(page.text(), /Resolva essas condições antes de confirmar/)
  page.unmount()
})
