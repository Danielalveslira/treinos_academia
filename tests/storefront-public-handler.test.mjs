import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import handler from '../api/storefront.js'
const originalFetch = globalThis.fetch,
  originalUrl = process.env.SUPABASE_URL,
  originalKey = process.env.SUPABASE_ANON_KEY
process.env.SUPABASE_URL = 'https://fixture.invalid'
process.env.SUPABASE_ANON_KEY = 'synthetic-public-key'
after(() => {
  globalThis.fetch = originalFetch
  if (originalUrl === undefined) delete process.env.SUPABASE_URL
  else process.env.SUPABASE_URL = originalUrl
  if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY
  else process.env.SUPABASE_ANON_KEY = originalKey
})
const id = '74500000-0000-0000-0000-000000000001'
function response() {
  return {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    end(body) {
      this.body = body
    },
  }
}
test('direct expired or unknown storefront responds 404, no-store and no commercial data', async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ groups: [], items: [] }), { status: 200 })
  const res = response()
  await handler({ method: 'GET', query: { id } }, res)
  assert.equal(res.statusCode, 404)
  assert.match(res.headers['Cache-Control'], /no-store/)
  assert.equal(res.headers['X-Robots-Tag'], 'noindex, follow')
  assert.doesNotMatch(res.body, /owner|cash_balance|service_role/)
})
test('server detail escapes approved public fields and never publishes arbitrary HTML', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.cache, 'no-store')
    assert.equal(JSON.parse(init.body).p_mode, 'detail')
    return new Response(
      JSON.stringify({
        groups: [
          {
            key: id,
            brand: '<script>bad()</script>',
            description: 'A safe description',
            contact: 'Public only',
            expiresAt: '2030-01-01',
          },
        ],
        items: [
          {
            name: 'Item <b>unsafe</b>',
            description: 'Description',
            media_id: id,
            store_url: 'https://example.invalid/product',
          },
        ],
      })
    )
  }
  const res = response()
  await handler({ method: 'GET', query: { id } }, res)
  assert.equal(res.statusCode, 200)
  assert.match(res.body, /&lt;script&gt;/)
  assert.doesNotMatch(res.body, /<script>bad/)
  assert.match(res.body, /storefront-detail.js/)
  assert.match(res.body, /canonical/)
})
test('backend failure and non-read requests fail safely without exposing configuration', async () => {
  globalThis.fetch = async () => {
    throw Error('sensitive upstream')
  }
  const unavailable = response()
  await handler({ method: 'GET', query: { id } }, unavailable)
  assert.equal(unavailable.statusCode, 503)
  assert.doesNotMatch(unavailable.body, /sensitive|key|fixture/)
  const mutation = response()
  await handler({ method: 'POST', query: { id } }, mutation)
  assert.equal(mutation.statusCode, 405)
})
