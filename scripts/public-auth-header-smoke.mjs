import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat, mkdir } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import { chromium } from 'playwright-core'

// Serve the production build with the same public-document / SPA split as Vercel.
// Local runs block all external traffic, including Supabase: no production fixtures.
const root = resolve('dist')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2' }
const server = process.env.PUBLIC_PREVIEW_URL ? null : createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (pathname === '/api/public-catalog-snapshot') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ total_active: 0, revision: '1', updated_at: '2026-10-27T00:00:00Z' }))
      return
    }
    // These scripts are provided by Vercel, rather than the static build.
    if (['/_vercel/insights/script.js', '/_vercel/speed-insights/script.js'].includes(pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(''); return
    }
    let file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!file.startsWith(`${root}${sep}`)) throw new Error('Invalid path')
    if (!extname(file)) {
      try { await stat(`${file}.html`); file += '.html' }
      catch { file = resolve(root, 'app-shell.html') }
    }
    const data = await readFile(file)
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' })
    res.end(data)
  } catch { console.error(`LOCAL_FILE_NOT_FOUND ${req.url}`); res.writeHead(404); res.end() }
})
if (server) await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
const base = process.env.PUBLIC_PREVIEW_URL || `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] })
const staticRoutes = ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais', '/locais']
const routes = ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais', '/locais', '/login', '/cadastro', '/esqueci-senha', '/confirmar-email', '/redefinir-senha', '/termos-de-uso', '/politica-de-privacidade', '/regras-da-comunidade', '/termos-publicacao-vitrine', '/atendimento', '/pagina-inexistente']
let checked = 0
try {
  for (const width of (process.env.HEADER_WIDTHS ? process.env.HEADER_WIDTHS.split(',').map(Number) : [320, 360, 375, 390, 414, 430, 768, 1440])) {
    for (const theme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: theme })
      if (server) await context.route('**/*', route => {
        const url = new URL(route.request().url())
        if (url.origin === base || ['data:', 'blob:'].includes(url.protocol)) return route.continue()
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      })
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
      for (const path of routes) {
        assert.equal((await page.goto(`${base}${path}`, { waitUntil: 'networkidle' })).status(), 200)
        const header = page.locator('header').first()
        await header.waitFor()
        const themeButton = header.getByRole('button', { name: /Ativar tema/ })
        const previousName = (await themeButton.ariaSnapshot()).includes('Ativar tema claro') ? 'Ativar tema claro' : 'Ativar tema escuro'
        const nextName = previousName === 'Ativar tema claro' ? 'Ativar tema escuro' : 'Ativar tema claro'
        await themeButton.click()
        await header.getByRole('button', { name: nextName, exact: true }).waitFor()
        await themeButton.click()
        await header.getByRole('button', { name: previousName, exact: true }).waitFor()
        const controls = header.locator('a:visible, button:visible')
        const boxes = await controls.evaluateAll(elements => elements.map(element => {
          const r = element.getBoundingClientRect()
          const center = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return { label: element.getAttribute('aria-label') || element.textContent.trim(), x: r.x, right: r.right, width: r.width, clickable: element.contains(center) }
        }))
        for (const box of boxes) {
          assert.ok(box.x >= -1 && box.right <= width + 1 && box.width > 0, `${path}/${width}: clipped ${JSON.stringify(box)}`)
          assert.ok(box.clickable, `${path}/${width}: covered ${box.label}`)
        }
        assert.ok(await header.locator('a[href="/login"]').isVisible(), `${path}/${width}: login missing`)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${path}/${width}: document overflow`)
        // The signed-in access label is longer; verify the same layout contract too.
        if (!staticRoutes.includes(path)) {
          const signedInFits = await header.locator('a[href="/login"]').evaluate(element => {
            const guestLabel = element.textContent
            element.textContent = 'Ir para o app'
            const header = element.closest('header')
            const fits = [...header.querySelectorAll('a, button')].filter(item => item.getClientRects().length).every(item => {
              const rect = item.getBoundingClientRect()
              return rect.x >= 0 && rect.right <= innerWidth + 1
            })
            element.textContent = guestLabel
            return fits
          })
          assert.ok(signedInFits, `${path}/${width}: signed-in header overflow`)
        } else {
          const signedInFits = await header.evaluate(element => {
            const root = document.documentElement
            const previous = root.getAttribute('data-public-auth')
            root.dataset.publicAuth = 'authed'
            const fits = [...element.querySelectorAll('a, button')].filter(item => item.getClientRects().length).every(item => {
              const rect = item.getBoundingClientRect()
              return rect.x >= 0 && rect.right <= innerWidth + 1
            })
            if (previous === null) root.removeAttribute('data-public-auth')
            else root.setAttribute('data-public-auth', previous)
            return fits
          })
          assert.ok(signedInFits, `${path}/${width}: signed-in public header overflow`)
        }
        const trigger = header.getByRole('button', { name: 'Menu de navegação' })
        if (width < 768 || staticRoutes.includes(path)) {
          await trigger.click()
          const overlay = page.locator('.public-header-overlay')
          await overlay.waitFor()
          await overlay.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
          const box = await overlay.boundingBox()
          assert.ok(box.x >= -1 && box.x + box.width <= width + 1, `${path}/${width}: menu overflow`)
          assert.ok(await overlay.evaluate(element => getComputedStyle(element).opacity === '1' && /^rgb\(/.test(getComputedStyle(element).backgroundColor)), `${path}: transparent menu`)
          assert.deepEqual(
            await overlay.locator('a[href]').evaluateAll(links => links.map(link => link.getAttribute('href'))),
            ['/', '/como-funciona', '/para-empresas', '/vitrine', '/profissionais', '/locais', '/login', '/cadastro'],
            `${path}: public menu destinations differ from the supported navigation contract`
          )
          assert.ok(await overlay.locator('a[href]').first().evaluate(element => {
            const r = element.getBoundingClientRect()
            return element.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
          }), `${path}: menu covered`)
          if (process.env.HEADER_PROOF_DIR && width === 320 && path === '/') {
            await mkdir(process.env.HEADER_PROOF_DIR, { recursive: true })
            await page.screenshot({ path: `${process.env.HEADER_PROOF_DIR}/menu-320-${theme}.png` })
          }
          await page.keyboard.press('Escape')
          await overlay.waitFor({ state: 'detached' })
          assert.equal(await trigger.evaluate(element => document.activeElement === element), true, `${path}: focus not restored`)
        }
        if (process.env.HEADER_PROOF_DIR && [320, 430].includes(width) && ['/', '/login'].includes(path)) {
          await mkdir(process.env.HEADER_PROOF_DIR, { recursive: true })
          await page.screenshot({ path: `${process.env.HEADER_PROOF_DIR}/${path === '/' ? 'home' : 'login'}-${width}-${theme}.png` })
        }
        if (path === '/') {
          await trigger.click()
          const overlay = page.locator('.public-header-overlay')
          await trigger.click()
          await overlay.waitFor({ state: 'detached' })
          await trigger.click()
          if (width < 768) {
            await page.keyboard.press('Tab')
            assert.ok(await overlay.evaluate(element => element.contains(document.activeElement)), 'menu focus escaped')
          }
          await overlay.locator('a[href="/vitrine"]').click()
          await page.waitForURL(`${base}/vitrine`)
          await overlay.waitFor({ state: 'detached' })
        }
        checked++
      }
      assert.deepEqual(errors, [], `${width}/${theme}: browser errors`)
      await context.close()
      console.log(`HEADER_OK width=${width} theme=${theme} routes=${routes.length}`)
    }
  }
  console.log(`PUBLIC_AUTH_HEADER_OK checks=${checked}`)
} finally {
  await browser.close()
  if (server) await new Promise(resolveClose => server.close(resolveClose))
}
