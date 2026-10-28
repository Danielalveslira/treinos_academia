import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let directory, service
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'professional-service-'))
  await build({
    entryPoints: [new URL('./professionalListingsService.js', import.meta.url).pathname],
    outfile: join(directory, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'fixture',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents:
              'export const supabase={rpc:async(name,args)=>{globalThis.__proCalls.push({name,args});return {data:globalThis.__proResult,error:globalThis.__proError}}}',
          }))
        },
      },
    ],
  })
  service = await import(join(directory, 'service.mjs'))
})
after(async () => {
  await rm(directory, { recursive: true, force: true })
  delete globalThis.__proCalls
  delete globalThis.__proResult
  delete globalThis.__proError
})
test('editorial service sends CAS and approved editable fields only', async () => {
  globalThis.__proCalls = []
  await service.saveProfessionalListing(
    'profile',
    {
      kind: 'professional',
      displayName: 'Name',
      ownerId: 'other',
      approved: true,
      expiresAt: '2099',
      balance: 100,
      mediaId: 'private-media',
    },
    '9007199254740993'
  )
  assert.deepEqual(globalThis.__proCalls, [
    {
      name: 'save_professional_listing_draft',
      args: {
        p_listing_id: 'profile',
        p_revision: '9007199254740993',
        p_draft: { kind: 'professional', displayName: 'Name', mediaId: 'private-media' },
      },
    },
  ])
})
test('moderation and history bind the exact resource and revision without financial mutation', async () => {
  globalThis.__proCalls = []
  await service.setProfessionalListingEditorial('profile', 12, 'approved', 'Reviewed')
  await service.listListingCommercialOrders('profile', '2026-10-27')
  assert.deepEqual(
    globalThis.__proCalls.map((c) => c.name),
    ['set_professional_listing_editorial', 'list_listing_commercial_orders']
  )
  assert.equal(globalThis.__proCalls[0].args.p_revision, 12)
  assert.equal(globalThis.__proCalls[1].args.p_id, 'profile')
  assert.doesNotMatch(JSON.stringify(globalThis.__proCalls), /wallet|debit|confirm_commercial/)
})
test('server authorization failures are propagated rather than converted to success', async () => {
  globalThis.__proError = { message: 'EDITORIAL_REVISION_CONFLICT' }
  await assert.rejects(
    service.saveProfessionalListing('profile', {}, 1),
    (e) => e.message === 'EDITORIAL_REVISION_CONFLICT'
  )
  globalThis.__proError = null
})
