import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { jwt } from '../keys.mjs'
const access = JSON.parse(readFileSync('.finance-local/phase4-access.json'))
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' }),
  service = JSON.parse(
    execFileSync('docker', ['inspect', 'evolutus_profiles_phase5_edge'], { encoding: 'utf8' })
  )[0]
    .Config.Env.find((v) => v.startsWith('SUPABASE_SERVICE_ROLE_KEY='))
    .slice('SUPABASE_SERVICE_ROLE_KEY='.length)
const sql = (s) =>
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
      s,
    ],
    { encoding: 'utf8' }
  ).trim()
async function rpc(name, args, token = access.owner.access_token) {
  const r = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const data = await r.json()
  assert.equal(r.ok, true, JSON.stringify(data))
  return data
}
const story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence/browser.json'))
const sf = story.results[0].id
const source = sql(
  `select storage_path from public.storefront_media where id='${story.results[0].mediaId}'`
)
assert.ok(source)
const bytes = await fetch(base + '/storage/v1/object/authenticated/storefront-media/' + source, {
  headers: { apikey: anon, Authorization: 'Bearer ' + service },
})
assert.equal(bytes.status, 200)
const blob = await bytes.arrayBuffer()
// A successful upload whose response/association is lost remains a ready orphan.
const form = new FormData()
form.set('storefrontId', sf)
form.set('image', new Blob([blob], { type: 'image/webp' }), 'lost-response.webp')
const completedUpload = await fetch(base + '/functions/v1/storefront-media', {
  method: 'POST',
  headers: { apikey: anon, Authorization: 'Bearer ' + access.owner.access_token },
  body: form,
})
assert.equal(completedUpload.status, 200)
const orphanId = (await completedUpload.json()).mediaId
const allocation = await rpc('allocate_storefront_media', { p_id: sf })
const uploaded = await fetch(base + '/storage/v1/object/storefront-media/' + allocation.path, {
  method: 'POST',
  headers: { apikey: anon, Authorization: 'Bearer ' + service, 'Content-Type': 'image/webp' },
  body: blob,
})
assert.equal(uploaded.ok, true)
sql(
  `update public.storefront_settings set cleanup_enabled=true,cleanup_grace_seconds=3600;update public.storefront_media set unreferenced_since=clock_timestamp()-interval '2 hours',upload_lease_until=clock_timestamp()-interval '1 hour' where id in('${allocation.id}','${orphanId}')`
)
const job = (token) =>
  fetch(base + '/functions/v1/storefront-media-cleanup', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: source }),
  })
assert.equal((await job(access.owner.access_token)).status, 403, 'owner cannot run job')
const response = await job(service)
const result = await response.json()
assert.equal(response.status, 200, JSON.stringify(result))
assert.ok(result.completed >= 1)
assert.equal(sql(`select count(*) from public.storefront_media where id='${allocation.id}'`), '0')
assert.equal(sql(`select count(*) from public.storefront_media where id='${orphanId}'`), '0')
const removed = await fetch(
  base + '/storage/v1/object/authenticated/storefront-media/' + allocation.path,
  { headers: { apikey: anon, Authorization: 'Bearer ' + service } }
)
assert.notEqual(removed.status, 200)
assert.equal(
  (
    await fetch(base + '/storage/v1/object/authenticated/storefront-media/' + source, {
      headers: { apikey: anon, Authorization: 'Bearer ' + service },
    })
  ).status,
  200,
  'caller-supplied referenced path ignored'
)
assert.equal((await job(service)).status, 200, 'bounded repeat safe')
writeFileSync(
  'docs/finance-restructure/phase5/evidence/media-http.json',
  JSON.stringify(
    {
      passed: true,
      localOnly: true,
      ownerDenied: true,
      realStorageDeletion: true,
      allocatedAndReadyOrphansCleaned: true,
      lostUploadAssociationRecovered: true,
      referencedBytesPreserved: true,
      replaySafe: true,
      ...result,
    },
    null,
    2
  ) + '\n'
)
console.log('Media cleanup HTTP passed')
