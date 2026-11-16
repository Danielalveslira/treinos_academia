import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import process from 'node:process'
import { build } from 'esbuild'

let directory
let api

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evocash-history-'))
  const outfile = join(directory, 'history.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { EvoCashPurchaseHistory } from './EvoCashPurchaseHistory.jsx'
        const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('')
        export const mount = (props) => {
          global.window = { matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }) }
          global.document = { addEventListener() {}, removeEventListener() {} }
          let renderer
          act(() => { renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(EvoCashPurchaseHistory, props)))) })
          return {
            text: () => text(renderer.toJSON()),
            articles: () => renderer.root.findAll((node) => node.type === 'article'),
            button: (name) => renderer.root.findAll((node) => node.type === 'button' && text(node).includes(name))[0],
            unmount: () => act(() => renderer.unmount()),
          }
        }
        export { act }
      `,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'jsx',
    },
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    jsx: 'automatic',
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'shared-ui-stubs',
        setup(b) {
          b.onResolve({ filter: /(^|\/)Refunds$/ }, () => ({ path: 'refunds', namespace: 'stub' }))
          b.onResolve({ filter: /(^|\/)CopyButton$/ }, () => ({ path: 'copy', namespace: 'stub' }))
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents:
              args.path === 'refunds'
                ? `import React from 'react'; export const RefundSourceButton = ({ onCreated }) => React.createElement('button', { onClick: () => onCreated({ id: 'request-1' }) }, 'Solicitar reembolso')`
                : `import React from 'react'; export const CopyButton = ({ value }) => React.createElement('button', null, 'Copiar ' + value)`,
            resolveDir: new URL('.', import.meta.url).pathname,
            loader: 'js',
          }))
        },
      },
    ],
  })
  api = createRequire(import.meta.url)(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  for (const handle of process._getActiveHandles()) {
    if (handle.constructor.name === 'MessagePort') handle.unref()
  }
})

const pending = {
  id: 'pending-1',
  purchaseLabel: 'Pacote legado',
  cashAmount: 25,
  amountCentavos: 2500,
  createdAt: '2026-11-01T12:00:00Z',
  status: 'pending',
  paymentProvider: 'infinitepay',
  checkoutUrl: null,
}
const recent = {
  ...pending,
  id: 'recent-1',
  purchaseLabel: '50 EvoCash',
  amountCentavos: 5000,
  createdAt: '2026-11-02T12:00:00Z',
  status: 'credited',
}

test('compact history preserves legacy value, details, refund action and pagination', () => {
  let created
  let loadCount = 0
  const page = api.mount({
    purchases: [recent],
    pendingPurchase: pending,
    loading: false,
    error: '',
    hasMore: true,
    loadMore: () => {
      loadCount++
    },
    refresh: () => {},
    cancellingPurchaseId: null,
    cancelPurchase: () => {},
    focusedPurchaseId: pending.id,
    onRefundCreated: (request) => {
      created = request
    },
  })
  assert.equal(page.articles().length, 2)
  assert.match(page.text(), /Pacote legado/)
  assert.match(page.text(), /R\$\s25,00/)
  assert.equal(page.articles()[1].findByType('details').props.open, true)
  api.act(() => page.button('Solicitar reembolso').props.onClick())
  assert.deepEqual(created, { id: 'request-1' })
  api.act(() => page.button('Carregar mais compras').props.onClick())
  assert.equal(loadCount, 1)
  page.unmount()
})

test('a pending row already in the page is not duplicated', () => {
  const page = api.mount({
    purchases: [recent, pending],
    pendingPurchase: pending,
    loading: false,
    error: '',
    hasMore: false,
    loadMore: () => {},
    refresh: () => {},
    cancellingPurchaseId: null,
    cancelPurchase: () => {},
    focusedPurchaseId: null,
    onRefundCreated: () => {},
  })
  assert.equal(page.articles().length, 2)
  page.unmount()
})
