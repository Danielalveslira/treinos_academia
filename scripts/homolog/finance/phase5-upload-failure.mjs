import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync } from 'node:fs'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase5-access.json')),
  story = JSON.parse(readFileSync('docs/finance-restructure/phase5/evidence/browser.json')),
  base = 'http://127.0.0.1:5173',
  host = 'organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev',
  anon = jwt({ role: 'anon' })
const rpc = async (name, args, session) => {
  const r = await fetch(base + '/_finance_local/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + session.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const data = await r.json()
  assert.ok(r.ok, JSON.stringify(data))
  return data
}
// Restore the test-only pending SEO marker from the approved snapshot for a useful demo.
for (const [i, row] of story.results.entries()) {
  const session = i ? a.establishment : a.professional,
    record = await rpc('get_my_professional_listing', { p_listing_id: row.id }, session),
    p = await rpc('public_get_professional', { p_listing_id: row.id }, session)
  await rpc(
    'save_professional_listing_draft',
    {
      p_listing_id: row.id,
      p_revision: record.draft.version,
      p_draft: {
        kind: p.kind,
        displayName: p.displayName,
        bio: p.bio,
        categoryKey: p.categoryKey,
        modalityKeys: p.modalityKeys,
        specialties: p.specialties,
        city: p.city,
        uf: p.uf,
        serviceMode: p.serviceMode,
        contacts: Object.fromEntries(p.publicContacts.map((c) => [c.type, c.url])),
        mediaId: p.mediaId,
        address: p.address,
        openingHours: p.openingHours,
        linkedCommunityId: p.linkedCommunity?.id || null,
      },
    },
    session
  )
}
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE5_CHROMIUM ||
    '/workspaces/treinos_academia/.finance-local/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  const ctx = await browser.newContext()
  await ctx.addInitScript((s) => {
    if (location.origin === 'http://127.0.0.1:5173')
      localStorage.setItem(
        'sb-organic-goldfish-r7w5rp9g754vhxp4v-5173-auth-token',
        JSON.stringify(s)
      )
  }, a.professional)
  let attempted = false
  await ctx.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === host && url.pathname.startsWith('/_finance_local/')) {
      if (
        url.pathname.endsWith('/functions/v1/storefront-media') &&
        route.request().method() === 'POST'
      ) {
        attempted = true
        return route.abort()
      }
      const response = await route.fetch({ url: base + url.pathname + url.search })
      return route.fulfill({ response })
    }
    if (
      ['127.0.0.1', 'localhost'].includes(url.hostname) ||
      ['blob:', 'data:'].includes(url.protocol)
    )
      return route.continue()
    return route.abort()
  })
  const page = await ctx.newPage()
  await page.goto(base + '/minha-vitrine')
  await page.getByRole('button', { name: 'Salvar rascunho', exact: true }).waitFor()
  const before = await rpc(
      'get_my_professional_listing',
      { p_listing_id: story.results[0].id },
      a.professional
    ),
    png = await page.screenshot({ clip: { x: 0, y: 0, width: 32, height: 32 } })
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: 'network.png', mimeType: 'image/png', buffer: png })
  await page
    .getByText('Não foi possível concluir. Atualize os dados e tente novamente.', { exact: true })
    .waitFor()
  assert.ok(attempted)
  const after = await rpc(
    'get_my_professional_listing',
    { p_listing_id: story.results[0].id },
    a.professional
  )
  assert.equal(after.draft.mediaId, before.draft.mediaId)
  assert.equal(after.draft.version, before.draft.version)
  assert.equal(after.published.mediaId, before.published.mediaId)
  const media = await fetch(
    base + '/_finance_local/functions/v1/storefront-media?id=' + story.results[0].mediaId
  )
  assert.equal(media.status, 200)
  const validBytes = await media.arrayBuffer(),
    form = new FormData()
  form.set('storefrontId', story.results[0].id)
  form.set('image', new Blob([validBytes], { type: 'image/webp' }), 'forbidden.webp')
  const foreign = await fetch(base + '/_finance_local/functions/v1/storefront-media', {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + a.establishment.access_token },
    body: form,
  })
  assert.ok(foreign.status >= 400)
  writeFileSync(
    'docs/finance-restructure/phase5/evidence/upload-failure.json',
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        realNetworkFailure: true,
        draftAndPublicImagePreserved: true,
        noFalseUploadSuccess: true,
        foreignUploadDenied: foreign.status,
        demoDraftRestored: true,
      },
      null,
      2
    ) + '\n'
  )
  console.log('Interrupted upload and foreign upload protection passed')
} finally {
  await browser.close()
}
