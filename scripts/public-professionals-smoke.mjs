import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'

const base = process.env.PUBLIC_PREVIEW_URL || 'http://127.0.0.1:4173'
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/home/codespace/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox'],
})
const id = '52000000-0000-0000-0000-000000000001'
const item = {
  id, kind: 'professional', displayName: 'Ana Teste', categoryKey: 'personal_trainer',
  modalityKeys: ['musculacao'], city: 'São Paulo', uf: 'SP', serviceMode: 'online', avatarPath: null,
}
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const requests = []
  await page.route('**/public-config.js', (route) => route.fulfill({
    contentType: 'application/javascript',
    body: 'window.EVOLUTUS_PUBLIC_CONFIG={url:"https://example.supabase.co",key:"test-anon-key"}',
  }))
  await page.route('**/rest/v1/rpc/public_list_professionals', async (route) => {
    const body = route.request().postDataJSON()
    requests.push(body)
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({
      items: body.p_offset ? [{ ...item, id: '52000000-0000-0000-0000-000000000002', displayName: 'Bia Teste' }] : [item],
      nextOffset: body.p_offset ? null : 20,
    }) })
  })
  const response = await page.goto(`${base}/profissionais?tipo=professional`)
  assert.equal(response.status(), 200)
  assert.equal(await page.locator('meta[name="robots"]').getAttribute('content'), 'noindex,follow')
  await page.getByText('Ana Teste').waitFor()
  assert.equal(await page.locator('.directory-card').count(), 1)
  assert.equal(await page.getByRole('link', { name: 'Ver perfil ↗' }).getAttribute('href'), `/profissionais/${id}`)
  assert.equal(await page.locator('.directory-card').textContent().then((s) => s.includes('Musculação')), true)
  await page.locator('#directory-more').click()
  await page.getByText('Bia Teste').waitFor()
  assert.equal(await page.locator('.directory-card').count(), 2)
  assert.equal(requests[1].p_offset, 20)
  await page.locator('[name="modalidade"]').selectOption('corrida')
  await page.waitForFunction(() => location.search.includes('modalidade=corrida'))
  assert.equal(requests.at(-1).p_modality, 'corrida')
  assert.equal(requests.at(-1).p_offset, 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
  await page.reload()
  assert.equal(await page.locator('[name="modalidade"]').inputValue(), 'corrida')
  const shell = await page.goto(`${base}/profissionais/${id}`)
  assert.equal(shell.status(), 200)
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content'), /noindex/)
  await page.close()
  console.log('PUBLIC_PROFESSIONALS_SMOKE_OK')
} finally {
  await browser.close()
}
