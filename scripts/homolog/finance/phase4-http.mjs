// Adversarial HTTP checks, fixed loopback stack, synthetic fixtures only.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase4-access.json', 'utf8')),
  b = JSON.parse(readFileSync('docs/finance-restructure/phase4/evidence/browser.json', 'utf8'))
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' }),
  results = []
const refreshed = await fetch(base + '/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: a.other.user.email, password: a.password }),
})
assert.equal(refreshed.status, 200)
a.other = await refreshed.json()
const sql = (source) =>
  execFileSync(
    'docker',
    [
      'exec',
      'evolutus_price_phase1_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      source,
    ],
    { encoding: 'utf8' }
  ).trim()
async function rpc(name, args, token = a.owner.access_token) {
  const response = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}
async function check(name, fn) {
  await fn()
  results.push({ name, passed: true })
}
async function upload(token, storefrontId, bytes, type = 'image/webp') {
  const form = new FormData()
  form.set('storefrontId', storefrontId)
  form.set('image', new Blob([bytes], { type }), 'upload.webp')
  return fetch(base + '/functions/v1/storefront-media', {
    method: 'POST',
    headers: { apikey: anon, ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: form,
  })
}
const current = await rpc('list_managed_storefronts', {})
const item = current.body.items.find((x) => x.id === b.storefrontId)
assert.ok(item)
const bytes = await (
  await fetch(base + '/functions/v1/storefront-media?id=' + b.mediaId)
).arrayBuffer()
await check(
  'public RPC GET also sets no-store and never grants direct private table access',
  async () => {
    const result = await fetch(
      base + '/rest/v1/rpc/public_product_catalog?p_mode=items&p_brand=' + item.id,
      { headers: { apikey: anon } }
    )
    assert.equal(result.status, 200)
    assert.match(result.headers.get('cache-control'), /no-store/)
    const direct = await fetch(base + '/rest/v1/product_storefronts?select=*', {
      headers: { apikey: anon, Authorization: 'Bearer ' + a.owner.access_token },
    })
    assert.ok(direct.status >= 400)
  }
)
await check(
  'public image is privately stored and uncached at the authorization gateway',
  async () => {
    const response = await fetch(base + '/functions/v1/storefront-media?id=' + b.mediaId)
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.equal(response.headers.get('content-type'), 'image/webp')
    const path = b.storefrontId + '/' + b.mediaId + '.webp'
    const permanent = await fetch(base + '/storage/v1/object/public/storefront-media/' + path)
    assert.notEqual(permanent.status, 200)
    const direct = await fetch(base + '/storage/v1/object/authenticated/storefront-media/' + path, {
      headers: { apikey: anon, Authorization: 'Bearer ' + a.owner.access_token },
    })
    assert.notEqual(
      direct.status,
      200,
      'owner must use audited authorization gateway, not raw Storage'
    )
  }
)
await check('another owner cannot edit storefront or borrow its upload anchor', async () => {
  const edit = await rpc(
    'save_product_storefront',
    {
      p_id: item.id,
      p_revision: item.revision,
      p_name: 'Stolen storefront',
      p_description: 'Unauthorized change',
      p_contact: 'x',
      p_logo_media_id: null,
    },
    a.other.access_token
  )
  assert.ok(edit.status >= 400)
  assert.match(edit.body.message, /STOREFRONT_NOT_FOUND/)
  const response = await upload(a.other.access_token, item.id, bytes)
  assert.equal(response.status, 403)
})
await check('anonymous and invalid media uploads fail before allocation', async () => {
  assert.equal((await upload(null, item.id, bytes)).status, 401)
  assert.equal(
    (await upload(a.owner.access_token, item.id, new TextEncoder().encode('not an image'))).status,
    400
  )
  assert.equal((await upload(a.owner.access_token, item.id, new Uint8Array(1100001))).status, 413)
})
await check('client cannot attest media bytes or modify expiry through RPC/REST', async () => {
  const confirm = await rpc('confirm_storefront_media_internal', {
    p_media_id: b.mediaId,
    p_width: 1,
    p_height: 1,
    p_size: 30,
  })
  assert.ok(confirm.status >= 400)
  const response = await fetch(
    base + '/rest/v1/visibility_entitlements?resource_id=eq.' + item.id,
    {
      method: 'PATCH',
      headers: {
        apikey: anon,
        Authorization: 'Bearer ' + a.owner.access_token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expires_at: '2099-01-01' }),
    }
  )
  assert.ok(response.status >= 400)
})
await check('foreign media and commercial IDs cannot change ownership or publication', async () => {
  const existing = (
    await rpc('list_managed_storefronts', {}, a.other.access_token)
  ).body.items.find((s) => s.name === 'Other private HTTP fixture')
  const own = existing
    ? { status: 200, body: existing.id }
    : await rpc(
        'create_product_storefront',
        { p_name: 'Other private HTTP fixture', p_request_id: crypto.randomUUID() },
        a.other.access_token
      )
  assert.equal(own.status, 200)
  const product = await rpc(
    'save_storefront_product',
    {
      p_storefront_id: own.body,
      p_revision: '1',
      p_product_id: null,
      p_data: { name: 'Foreign media attempt', mediaId: b.mediaId },
    },
    a.other.access_token
  )
  assert.ok(product.status >= 400)
  assert.match(product.body.message, /INVALID_STOREFRONT_MEDIA/)
  const anchor = await rpc(
    'quote_commercial_order',
    { p_resource_id: item.id, p_duration_days: '1', p_request_id: crypto.randomUUID() },
    a.other.access_token
  )
  assert.ok(anchor.status >= 400)
  assert.match(anchor.body.message, /RESOURCE_NOT_ELIGIBLE/)
})
await check(
  'revoked session is rejected by PostgreSQL even when its JWT remains signed',
  async () => {
    const sessionId = JSON.parse(
      Buffer.from(a.other.access_token.split('.')[1], 'base64url')
    ).session_id
    sql(`delete from auth.sessions where id='${sessionId}'`)
    const response = await rpc('list_managed_storefronts', {}, a.other.access_token)
    assert.ok(response.status >= 400)
    assert.match(response.body.message, /APP_ACCESS_DENIED/)
  }
)
writeFileSync(
  'docs/finance-restructure/phase4/evidence/http.json',
  JSON.stringify(
    { localOnly: true, realAuth: true, realStorage: true, realEdge: true, results },
    null,
    2
  ) + '\n'
)
console.log(JSON.stringify(results))
