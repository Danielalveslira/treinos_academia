import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const { storefrontId } = JSON.parse(
  readFileSync('docs/finance-restructure/phase4/evidence41/browser.json')
)
const base = 'http://127.0.0.1:5173'
const access = JSON.parse(readFileSync('.finance-local/phase4-access.json'))
const { jwt } = await import('../keys.mjs')
const anon = jwt({ role: 'anon' })
async function ownerRpc(name, args) {
  const response = await fetch('http://127.0.0.1:55554/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + access.owner.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  assert.equal(response.ok, true)
  const raw = await response.text()
  return raw ? JSON.parse(raw) : null
}
const current = (await ownerRpc('list_managed_storefronts', {})).items.find(
  (s) => s.id === storefrontId
)
await ownerRpc('save_product_storefront', {
  p_id: storefrontId,
  p_revision: current.revision,
  p_name: current.name,
  p_description: 'SEO_PRIVATE_DRAFT_DO_NOT_INDEX',
  p_contact: current.contact,
  p_logo_media_id: current.logoMediaId,
})
const responses = []
for (const [path, status] of [
  ['/vitrine', 200],
  ['/vitrine/' + storefrontId, 200],
  ['/sitemap.xml', 200],
  ['/vitrine/00000000-0000-0000-0000-000000000000', 404],
]) {
  const response = await fetch(base + path, { headers: { 'User-Agent': 'Googlebot' } })
  const html = await response.text()
  assert.equal(response.status, status, path)
  assert.match(response.headers.get('cache-control'), /no-store/)
  if (path === '/sitemap.xml') assert.match(html, new RegExp(storefrontId))
  else if (status === 200) {
    assert.equal(response.headers.get('x-robots-tag'), 'index, follow')
    assert.match(html, /<h2>Produto browser<\/h2>/)
    assert.match(html, /application\/ld\+json/)
    assert.doesNotMatch(html, /SEO_PRIVATE_DRAFT_DO_NOT_INDEX|ownerUserId|cash_balance/)
    assert.equal((html.match(/rel="canonical"/g) || []).length, 1)
  } else assert.equal(response.headers.get('x-robots-tag'), 'noindex, follow')
  responses.push({
    path,
    status,
    cacheControl: response.headers.get('cache-control'),
    robots: response.headers.get('x-robots-tag'),
  })
}
const browser = await chromium.launch({
  executablePath:
    process.env.PHASE4_CHROMIUM ||
    '/tmp/evolutus-phase3-browser/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox'],
})
try {
  const context = await browser.newContext({ javaScriptEnabled: false })
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.startsWith('/_finance_local/'))
      return route.fulfill({
        response: await route.fetch({ url: base + url.pathname + url.search }),
      })
    return url.hostname === '127.0.0.1' ? route.continue() : route.abort()
  })
  const page = await context.newPage()
  await page.goto(base + '/vitrine/' + storefrontId)
  await page.getByRole('heading', { name: 'Produto browser', exact: true }).waitFor()
  assert.ok(await page.getByRole('link', { name: 'Ver na loja', exact: true }).count())
  await page.goto(base + '/vitrine')
  await page.getByRole('heading', { name: 'Produto browser', exact: true }).first().waitFor()
  writeFileSync(
    'docs/finance-restructure/phase4/evidence41/seo-http.json',
    JSON.stringify(
      { passed: true, realHttp: true, usefulWithoutJavaScript: true, responses },
      null,
      2
    ) + '\n'
  )
} finally {
  await browser.close()
}
