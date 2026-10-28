import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/listings.js'
const saved = {
  fetch: globalThis.fetch,
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_ANON_KEY,
}
process.env.SUPABASE_URL = 'https://synthetic.invalid'
process.env.SUPABASE_ANON_KEY = 'public-fixture'
after(() => {
  globalThis.fetch = saved.fetch
  for (const [key, value] of [
    ['SUPABASE_URL', saved.url],
    ['SUPABASE_ANON_KEY', saved.key],
  ])
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})
const id = '75200000-0000-0000-0000-000000000001'
const template =
  '<html><head><title>Directory</title><meta name="robots" content="noindex,follow"><meta name="description" content="Directory"><link rel="canonical" href="https://www.evolutus.com.br/profissionais"></head><body><h1>Directory</h1><div id="public-listings-root" data-kind="professional"></div></body></html>'
const response = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v
  },
  end(body) {
    this.body = body
  },
})
const row = (kind = 'professional') => ({
  id,
  kind,
  displayName: 'Approved <name>',
  bio: 'Approved useful description',
  categoryKey: 'personal_trainer',
  city: 'São Paulo',
  uf: 'SP',
  modalityKeys: ['musculacao'],
  publicContacts: [{ type: 'website', url: 'https://example.invalid' }],
  expiresAt: '2035-01-01',
  serverTime: new Date().toISOString(),
})
test('crawler gets approved HTML, canonical and Person schema without executing JS', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(row()))
  const res = response()
  await handler({ method: 'GET', url: '/profissionais/' + id }, res, { html: template })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Robots-Tag'], 'index, follow')
  assert.match(res.body, /Approved &lt;name&gt;/)
  assert.match(res.body, /Approved useful description/)
  assert.match(res.body, /"@type":"Person"/)
  assert.match(res.body, new RegExp('https://www.evolutus.com.br/profissionais/' + id))
  assert.match(res.headers['Cache-Control'], /no-store/)
  assert.doesNotMatch(res.body, /ownerId|cash_balance|<name>/)
})
test('LocalBusiness schema requires a complete reviewed commercial address', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ...row('space'), address: 'Rua de Teste, 100' }))
  const res = response()
  await handler({ method: 'GET', url: '/locais/' + id }, res, { html: template })
  assert.match(res.body, /"@type":"LocalBusiness"/)
  assert.match(res.body, /"@type":"PostalAddress"/)
  globalThis.fetch = async () => new Response(JSON.stringify(row('space')))
  const partial = response()
  await handler({ method: 'GET', url: '/locais/' + id }, partial, { html: template })
  assert.doesNotMatch(partial.body, /LocalBusiness|PostalAddress/)
})
test('legacy professional URL of an eligible establishment redirects to its stable canonical', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(row('space')))
  const res = response()
  await handler({ method: 'GET', url: '/profissionais/' + id }, res, { html: template })
  assert.equal(res.statusCode, 308)
  assert.equal(res.headers.Location, '/locais/' + id)
  assert.equal(res.body, undefined)
})
test('expired resources return neutral 404 and never ship old metadata or names', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ ...row(), expiresAt: '2020-01-01' }))
  const res = response()
  await handler({ method: 'GET', url: '/profissionais/' + id }, res, { html: template })
  assert.equal(res.statusCode, 404)
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, follow')
  assert.doesNotMatch(res.body, /Approved|Person|application\/ld\+json/)
})
test('catalog returns useful HTML and consumes rewrite parameters without suppressing indexing', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        serverTime: new Date().toISOString(),
        validUntil: '2035-01-01',
        items: [row()],
        nextOffset: null,
      })
    )
  const res = response()
  await handler(
    { method: 'GET', url: '/api/listings?kind=professional', query: { kind: 'professional' } },
    res,
    { html: template }
  )
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Robots-Tag'], 'index, follow')
  assert.match(res.body, /public-listings-initial/)
  assert.match(res.body, /Approved &lt;name&gt;/)
  const filtered = response()
  await handler({ method: 'GET', url: '/profissionais?cidade=São%20Paulo' }, filtered, {
    html: template,
  })
  assert.equal(filtered.headers['X-Robots-Tag'], 'noindex, follow')
})
test('empty catalog and backend failures cannot create indexable empty pages', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ items: [], nextOffset: null }))
  const res = response()
  await handler({ method: 'GET', url: '/locais' }, res, { html: template })
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, follow')
  globalThis.fetch = async () => {
    throw Error('private config')
  }
  const failure = response()
  await handler({ method: 'GET', url: '/locais' }, failure, { html: template })
  assert.equal(failure.statusCode, 503)
  assert.doesNotMatch(failure.body, /private config/)
})
