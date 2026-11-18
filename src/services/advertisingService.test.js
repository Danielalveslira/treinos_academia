import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
let dir, service
before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'advertising-service-'))
  await build({
    entryPoints: [new URL('./advertisingService.js', import.meta.url).pathname],
    outfile: join(dir, 'service.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    plugins: [
      {
        name: 'supabase-fixture',
        setup(b) {
          b.onResolve({ filter: /\/supabase\/config$/ }, () => ({
            path: 'client',
            namespace: 'fixture',
          }))
          b.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const supabase = globalThis.__adsClient',
            loader: 'js',
          }))
        },
      },
    ],
  })
  globalThis.__adsClient = {
    rpc: async (name, args) => {
      globalThis.__adsCalls.push({ name, args })
      return { data: { ok: true }, error: null }
    },
  }
  service = await import(join(dir, 'service.mjs'))
})
after(async () => {
  delete globalThis.__adsClient
  delete globalThis.__adsCalls
  await rm(dir, { recursive: true, force: true })
})

test('creating a campaign sends exactly the wizard fields and the idempotency key, nothing else', async () => {
  globalThis.__adsCalls = []
  await service.createAdvertisingCampaign(
    'account-1',
    {
      placement: 'home_banner',
      communityId: '',
      title: 'T',
      description: 'D',
      destination: 'https://x',
    },
    'request-1'
  )
  assert.deepEqual(globalThis.__adsCalls, [
    {
      name: 'create_advertising_campaign',
      args: {
        p_account: 'account-1',
        p_placement: 'home_banner',
        p_community: null,
        p_title: 'T',
        p_description: 'D',
        p_destination: 'https://x',
        p_request_id: 'request-1',
      },
    },
  ])
})

test('editing a campaign without a desired duration leaves the stored preference untouched (p_desired_days null)', async () => {
  globalThis.__adsCalls = []
  await service.editAdvertisingCampaign(
    { ad_id: 'ad-1', version: 2 },
    { title: 'T', description: 'D', destination: 'https://x' },
    false
  )
  assert.deepEqual(globalThis.__adsCalls, [
    {
      name: 'edit_advertising_campaign',
      args: {
        p_id: 'ad-1',
        p_version: 2,
        p_title: 'T',
        p_description: 'D',
        p_destination: 'https://x',
        p_submit: false,
        p_media_id: null,
        p_desired_days: null,
        p_clear_media: false,
      },
    },
  ])
})

test('removing the image sends p_clear_media without p_media_id, even if a stale media_id lingers in values', async () => {
  globalThis.__adsCalls = []
  await service.editAdvertisingCampaign(
    { ad_id: 'ad-1', version: 4 },
    { title: 'T', description: 'D', destination: 'https://x', media_id: 'stale-media' },
    false,
    null,
    true
  )
  assert.equal(globalThis.__adsCalls[0].args.p_media_id, null)
  assert.equal(globalThis.__adsCalls[0].args.p_clear_media, true)
})

test('editing a campaign with a chosen duration forwards it as an integer, and media stays separate from duration', async () => {
  globalThis.__adsCalls = []
  await service.editAdvertisingCampaign(
    { ad_id: 'ad-1', version: 3 },
    { title: 'T', description: 'D', destination: 'https://x', media_id: 'media-1' },
    true,
    7
  )
  assert.deepEqual(globalThis.__adsCalls[0].args.p_media_id, 'media-1')
  assert.deepEqual(globalThis.__adsCalls[0].args.p_desired_days, 7)
  assert.equal(globalThis.__adsCalls[0].args.p_submit, true)
})

test('reading campaigns forwards only the account and cursor, matching the card list and the wizard continuation flow', async () => {
  globalThis.__adsCalls = []
  await service.getAdvertisingCampaigns('account-1')
  await service.getAdvertisingCampaigns('account-1', 'ad-20')
  assert.deepEqual(globalThis.__adsCalls, [
    { name: 'get_advertising_campaigns', args: { p_account: 'account-1', p_after: null } },
    { name: 'get_advertising_campaigns', args: { p_account: 'account-1', p_after: 'ad-20' } },
  ])
})

test('advertiser resume calls its own RPC without an admin revision or reason, carrying the request id and the pause operation it observed', async () => {
  globalThis.__adsCalls = []
  await service.resumeMyAdvertisingCampaign({ ad_id: 'ad-1', pause_operation_id: 42, starts_at: 'period-1' }, 'request-1')
  assert.deepEqual(globalThis.__adsCalls, [
    {
      name: 'resume_my_advertising_campaign',
      args: { p_id: 'ad-1', p_request_id: 'request-1', p_expected_operation_id: 42, p_period_start: 'period-1' },
    },
  ])
})

test('advertiser pause forwards the reason and the request id used for retry idempotency', async () => {
  globalThis.__adsCalls = []
  await service.interruptAdvertisingCampaign({ ad_id: 'ad-1', pause_operation_id: 42, starts_at: 'period-1' }, 'Pausa solicitada', 'request-2')
  assert.deepEqual(globalThis.__adsCalls, [
    {
      name: 'interrupt_advertising_campaign',
      args: { p_id: 'ad-1', p_reason: 'Pausa solicitada', p_request_id: 'request-2', p_expected_operation_id: 42, p_period_start: 'period-1' },
    },
  ])
})
