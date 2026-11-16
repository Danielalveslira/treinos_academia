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
const require = createRequire(import.meta.url)
const settings = {
  enabled: true,
  priceVersionId: 'price-1',
  minQuantity: '1',
  maxQuantity: '500',
  unitPriceCentavos: '100',
  dailyQuantityLimit: '1000',
  totalQuantityLimit: '5000',
}
const terms = {
  documentId: 'evocash-terms',
  version: '1',
  digest: 'digest',
  conditionsDigest: 'conditions',
  current: true,
}

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'evocash-purchase-'))
  const outfile = join(directory, 'purchase.cjs')
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import TestRenderer, { act } from 'react-test-renderer'
        import { ThemeProvider, BaseStyles } from '@primer/react'
        import { MemoryRouter } from 'react-router-dom'
        import { EvoCashQuantityPurchase } from './EvoCashQuantityPurchase.jsx'
        let renderer
        const text = (node) => typeof node === 'string' ? node : (node.children || []).map(text).join('')
        export const mount = (props) => {
          global.window = { matchMedia: () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} }), location: { assign: () => {} } }
          global.document = { addEventListener() {}, removeEventListener() {} }
          global.sessionStorage = { getItem: (key) => globalThis.__store.get(key) || null, setItem: (key, value) => globalThis.__store.set(key, value) }
          act(() => { renderer = TestRenderer.create(React.createElement(ThemeProvider, null, React.createElement(BaseStyles, null, React.createElement(MemoryRouter, null, React.createElement(EvoCashQuantityPurchase, props))))) })
          return {
            text: () => text(renderer.toJSON()),
            input: () => renderer.root.findAll((node) => node.type === 'input' && node.props.inputMode === 'numeric')[0],
            checkbox: () => renderer.root.findAll((node) => node.type === 'input' && node.props.type === 'checkbox')[0],
            form: () => renderer.root.findByType('form'),
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
        name: 'finance-stubs',
        setup(b) {
          const stubs = {
            cashPurchaseService: `export const getCashPurchaseSettings = () => globalThis.__settings(); export const requestCashPurchase = (args) => globalThis.__checkout(args);`,
            commercialService: `export const acceptCommercialTerms = (...args) => globalThis.__accept(...args);`,
            evocashPricingService: `export const createEvoCashQuote = (...args) => globalThis.__quote(...args);`,
          }
          for (const name of Object.keys(stubs)) {
            b.onResolve({ filter: new RegExp(`(^|/)${name}(\\.js)?$`) }, () => ({
              path: name,
              namespace: 'finance-stub',
            }))
          }
          b.onLoad({ filter: /.*/, namespace: 'finance-stub' }, (args) => ({
            contents: stubs[args.path],
            loader: 'js',
          }))
        },
      },
    ],
  })
  api = require(outfile)
})

after(async () => {
  if (directory) await rm(directory, { recursive: true, force: true })
  for (const handle of process._getActiveHandles()) {
    if (handle.constructor.name === 'MessagePort') handle.unref()
  }
})

function quoteFor(quantity, requestId, ttl = 1_000) {
  const now = Date.now()
  return {
    quoteId: requestId,
    quantity,
    unitPriceCentavos: '100',
    totalCentavos: (BigInt(quantity) * 100n).toString(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    terms,
  }
}

async function setup(options = {}) {
  globalThis.__store = new Map()
  globalThis.__settings = async () => options.settings || settings
  globalThis.__quote = options.quote || ((quantity, id) => Promise.resolve(quoteFor(quantity, id)))
  globalThis.__accept = options.accept || (async () => {})
  globalThis.__checkout =
    options.checkout || (async () => ({ checkoutUrl: 'https://checkout.infinitepay.io/test' }))
  const page = api.mount({
    userId: 'user-1',
    hasPendingPurchase: false,
    onPurchaseChanged: options.refresh || (async () => ({ ok: true, pendingPurchase: null })),
  })
  await api.act(async () => {})
  return page
}

test('paused purchases show a concise notice without the quantity form', async () => {
  const page = await setup({ settings: { ...settings, enabled: false } })
  assert.match(page.text(), /temporariamente pausada/)
  assert.equal(page.button('Revisar compra'), undefined)
  page.unmount()
})

async function quantity(page, value) {
  await api.act(async () => page.input().props.onChange({ target: { value } }))
}

async function review(page) {
  await api.act(async () => page.form().props.onSubmit({ preventDefault() {} }))
}

test('expired quote receives a new request ID and requires fresh acceptance', async () => {
  const ids = []
  const page = await setup({
    quote: async (amount, id) => {
      ids.push(id)
      return quoteFor(amount, id, ids.length === 1 ? 20 : 1_000)
    },
  })
  await quantity(page, '25')
  await review(page)
  await api.act(async () => page.checkbox().props.onChange({ target: { checked: true } }))
  await new Promise((resolve) => setTimeout(resolve, 40))
  assert.ok(page.button('Gerar nova cotação'))
  await api.act(async () =>
    page.button('Gerar nova cotação').props.onClick({ preventDefault() {} })
  )
  assert.equal(ids.length, 2)
  assert.notEqual(ids[0], ids[1])
  assert.equal(page.checkbox().props.checked, false)
  page.unmount()
})

test('editing quantity starts a new quote and discards a delayed old response', async () => {
  const ids = []
  let resolveOld
  const page = await setup({
    quote: (amount, id) => {
      ids.push(id)
      if (amount === '25')
        return new Promise((resolve) => {
          resolveOld = () => resolve(quoteFor(amount, id))
        })
      return Promise.resolve(quoteFor(amount, id))
    },
  })
  await quantity(page, '25')
  let pending
  api.act(() => {
    pending = page.form().props.onSubmit({ preventDefault() {} })
  })
  await quantity(page, '50')
  resolveOld()
  await api.act(async () => pending)
  assert.doesNotMatch(page.text(), /Revise sua compra/)
  await review(page)
  assert.notEqual(ids[0], ids[1])
  assert.match(page.text(), /50 EvoCash/)
  page.unmount()
})

test('transient quote retry reuses its ID and double review starts one request', async () => {
  const ids = []
  const page = await setup({
    quote: async (amount, id) => {
      ids.push(id)
      if (ids.length === 1) throw new Error('NETWORK')
      return quoteFor(amount, id)
    },
  })
  await quantity(page, '25')
  await review(page)
  await review(page)
  assert.deepEqual(ids, [ids[0], ids[0]])
  page.unmount()
})

test('checkout uncertainty stays blocked after a failed check and clears only after a successful check', async () => {
  const events = []
  let outcome = { ok: false }
  const page = await setup({
    accept: async (...args) => events.push(['accept', ...args]),
    checkout: async (args) => {
      events.push(['checkout', args])
      throw new Error('NETWORK')
    },
    refresh: async () => outcome,
  })
  await quantity(page, '25')
  await review(page)
  assert.equal(page.button('Ir para pagamento seguro').props.disabled, true)
  await api.act(async () => page.checkbox().props.onChange({ target: { checked: true } }))
  await api.act(async () => page.button('Ir para pagamento seguro').props.onClick())
  assert.equal(events.length, 2)
  assert.equal(events[0][0], 'accept')
  assert.equal(events[0][1], 'evocash_quote')
  assert.equal(events[0][3].version, terms.version)
  assert.equal(events[1][0], 'checkout')
  assert.ok(page.button('Conferir pedido'))
  await api.act(async () => page.button('Conferir pedido').props.onClick())
  assert.ok(page.button('Conferir pedido'))
  outcome = { ok: true, pendingPurchase: { id: 'pending' } }
  await api.act(async () => page.button('Conferir pedido').props.onClick())
  assert.ok(page.button('Conferir pedido'))
  outcome = { ok: true, pendingPurchase: null }
  await api.act(async () => page.button('Conferir pedido').props.onClick())
  assert.match(page.text(), /Nenhuma compra em andamento/)
  assert.equal(events.filter(([kind]) => kind === 'checkout').length, 1)
  page.unmount()
})

test('simultaneous review and payment clicks cannot create duplicate financial calls', async () => {
  let resolveQuote
  let resolveCheckout
  const quoteIds = []
  const checkouts = []
  const page = await setup({
    quote: (amount, id) => {
      quoteIds.push(id)
      return new Promise((resolve) => {
        resolveQuote = () => resolve(quoteFor(amount, id))
      })
    },
    checkout: (args) => {
      checkouts.push(args)
      return new Promise((resolve) => {
        resolveCheckout = () => resolve({ checkoutUrl: 'https://checkout.infinitepay.io/test' })
      })
    },
  })
  await quantity(page, '25')
  let firstReview
  api.act(() => {
    firstReview = page.form().props.onSubmit({ preventDefault() {} })
    page.form().props.onSubmit({ preventDefault() {} })
  })
  assert.equal(quoteIds.length, 1)
  resolveQuote()
  await api.act(async () => firstReview)
  await api.act(async () => page.checkbox().props.onChange({ target: { checked: true } }))
  let firstPayment
  api.act(() => {
    firstPayment = page.button('Ir para pagamento seguro').props.onClick()
    page.button('Ir para pagamento seguro').props.onClick()
  })
  assert.equal(checkouts.length, 0)
  await api.act(async () => {})
  assert.equal(checkouts.length, 1)
  resolveCheckout()
  await api.act(async () => firstPayment)
  assert.equal(checkouts.length, 1)
  page.unmount()
})
