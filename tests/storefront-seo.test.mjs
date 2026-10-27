import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import catalog from '../api/storefront-catalog.js'
import sitemap from '../api/storefront-sitemap.js'
import detail from '../api/storefront.js'
const originalFetch = globalThis.fetch
const originalUrl = process.env.SUPABASE_URL,
  originalKey = process.env.SUPABASE_ANON_KEY
process.env.SUPABASE_URL = 'https://synthetic.invalid'
process.env.SUPABASE_ANON_KEY = 'public-fixture'
after(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
  else process.env.SUPABASE_ANON_KEY = originalKey
})
const id = '74500000-0000-0000-0000-000000000001'
const response = () => ({
  headers: {},
  setHeader(k, v) {
    this.headers[k] = v
  },
  end(b) {
    this.body = b
  },
})
const template =
  '<html><head><meta name="robots" content="noindex,follow"></head><body><section><div id="vitrine-root"><p>Loading</p></div></section></body></html>'
const page = {
  serverTime: new Date().toISOString(),
  validUntil: '2035-01-01',
  groups: [
    {
      key: id,
      brand: 'Approved <name>',
      description: 'Approved useful description',
      items: [
        {
          name: 'Approved item',
          description: 'Description',
          media_id: id,
          store_url: 'https://example.invalid',
        },
      ],
    },
  ],
  items: [],
}
test('crawler receives useful approved catalog HTML, escaped schema and no-store', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify(page))
  const res = response()
  await catalog({ method: 'GET', url: '/vitrine' }, res, { html: template })
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Robots-Tag'], 'index, follow')
  assert.match(res.body, /Approved &lt;name&gt;/)
  assert.match(res.body, /Approved item/)
  assert.match(res.body, /application\/ld\+json/)
  assert.doesNotMatch(res.body, /<p>Loading/)
  assert.match(res.headers['Cache-Control'], /no-store/)
  const filtered = response()
  await catalog({ method: 'GET', url: '/vitrine?q=x' }, filtered, { html: template })
  assert.equal(filtered.headers['X-Robots-Tag'], 'noindex, follow')
})
test('empty catalog and unavailable detail cannot be indexed', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ groups: [], items: [] }))
  const res = response()
  await catalog({ method: 'GET', url: '/vitrine' }, res, { html: template })
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, follow')
  assert.doesNotMatch(res.body, /application\/ld\+json/)
  const unavailable = response()
  await detail({ method: 'GET', query: { id } }, unavailable)
  assert.equal(unavailable.statusCode, 404)
  assert.doesNotMatch(unavailable.body, /application\/ld\+json/)
})
test('sitemap excludes expired entries and fails closed when backend unavailable', async () => {
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        serverTime: new Date().toISOString(),
        items: [
          { id, updatedAt: '2026-10-27', expiresAt: '2035-01-01' },
          { id: 'expired', expiresAt: '2020-01-01' },
        ],
      })
    )
  const res = response()
  await sitemap({ method: 'GET' }, res, { staticXml: '<urlset></urlset>' })
  assert.equal(res.statusCode, 200)
  assert.match(res.body, new RegExp(id))
  assert.doesNotMatch(res.body, /expired/)
  assert.match(res.headers['Cache-Control'], /no-store/)
  globalThis.fetch = async () => {
    throw Error('private config')
  }
  const failure = response()
  await sitemap({ method: 'GET' }, failure)
  assert.equal(failure.statusCode, 503)
  assert.doesNotMatch(failure.body, /private config/)
})
test('a lease ending during upstream IO cannot leak through HTML, schema or bootstrap', async () => {
  globalThis.fetch = async () => {
    const serverTime = new Date().toISOString()
    await new Promise((resolve) => setTimeout(resolve, 30))
    return new Response(
      JSON.stringify({
        ...page,
        serverTime,
        validUntil: serverTime,
        groups: page.groups.map((g) => ({ ...g, expiresAt: serverTime })),
        items: page.groups[0].items,
      })
    )
  }
  const list = response()
  await catalog({ method: 'GET', url: '/vitrine' }, list, { html: template })
  assert.equal(list.headers['X-Robots-Tag'], 'noindex, follow')
  assert.doesNotMatch(list.body, /Approved item|Approved useful description/)
  const store = response()
  await detail({ method: 'GET', query: { id } }, store)
  assert.equal(store.statusCode, 404)
  assert.doesNotMatch(store.body, /Approved item|Approved useful description/)
})
