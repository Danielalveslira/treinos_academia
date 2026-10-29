// Browser check for the real Primer AccountMenu, with only account data stubbed.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const directory = await mkdtemp(join(tmpdir(), 'app-menu-viewport-'))
const evidenceDirectory = process.env.APP_MENU_EVIDENCE_DIR
if (evidenceDirectory) await mkdir(evidenceDirectory, { recursive: true })
const stubs = {
  '/hooks/useAuth':
    'export const useAuth=()=>({isSuperAdmin:true,profile:{usageProfile:"professional"}})',
  '/hooks/useColorMode':
    'export const useColorMode=()=>({dark:window.__theme === "dark",toggleColorMode:()=>{}})',
  '/hooks/usePendingNotice': 'export const useLogoutNotice=()=>null',
  '/hooks/useWallet': 'export const useWallet=()=>({dailyCoins:0,display:null})',
}
let server
let browser
try {
  await build({
    stdin: {
      contents: `
        import React from 'react'
        import { createRoot } from 'react-dom/client'
        import { BrowserRouter, Link } from 'react-router-dom'
        import { BaseStyles, ThemeProvider } from '@primer/react'
        import { AccountMenu } from './src/components/AccountMenu.jsx'
        import { BrandMark } from './src/components/BrandMark.jsx'
        import { WalletHeaderBadgesView } from './src/components/WalletHeaderBadges.jsx'
        import './src/styles/app.css'
        import './src/styles/navigation.css'
        import '@primer/primitives/dist/css/functional/themes/light.css'
        import '@primer/primitives/dist/css/functional/themes/dark.css'
        createRoot(document.getElementById('root')).render(
          <ThemeProvider colorMode={window.__theme === 'dark' ? 'night' : 'day'} dayScheme="light" nightScheme="dark">
            <BaseStyles><BrowserRouter><div className="app-shell">
              <header className="app-header"><div className="header-top">
                <Link className="brand" to="/app" aria-label="Evolutus — início"><span className="brand-mark"><BrandMark size={25}/></span><span>Evolutus</span></Link>
                <nav className="desktop-nav"><Link className="nav-link" to="/app">Início</Link></nav>
                <div className="header-actions">
                  <WalletHeaderBadgesView visible loading={false} coinBalance={123456789} cashBalance={987654321}/>
                  <button className="notification-trigger" aria-label="Notificações">Sino</button>
                  <AccountMenu onLogout={()=>{}} onLogoutAll={()=>{}} signingOut={false}/>
                </div>
              </div></header>
              <main className="main-content" style={{minHeight:3000}}>Conteúdo extenso</main>
              <nav className="mobile-nav" aria-label="Navegação inferior">Início</nav>
            </div></BrowserRouter></BaseStyles>
          </ThemeProvider>
        )
      `,
      resolveDir: root,
      loader: 'jsx',
    },
    outfile: join(directory, 'app.js'),
    bundle: true,
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'account-stubs',
        setup(building) {
          building.onResolve({ filter: /.*/ }, ({ path }) => {
            const key = Object.keys(stubs).find((item) => path.endsWith(item))
            return key ? { path: key, namespace: 'stub' } : undefined
          })
          building.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents: stubs[path],
            resolveDir: root,
          }))
        },
      },
    ],
  })
  server = createServer(async (request, response) => {
    if (request.url === '/app.js' || request.url === '/app.css') {
      response.setHeader(
        'Content-Type',
        request.url.endsWith('.js') ? 'text/javascript' : 'text/css'
      )
      response.end(await readFile(join(directory, request.url)))
    } else {
      response.setHeader('Content-Type', 'text/html')
      response.end(
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>'
      )
    }
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  const url = `http://127.0.0.1:${server.address().port}/app`
  const viewports = [
    { width: 320, height: 700 },
    { width: 320, height: 420 },
    { width: 390, height: 700 },
    { width: 390, height: 420 },
    { width: 768, height: 700 },
    { width: 844, height: 390 },
    { width: 1024, height: 700 },
    { width: 1440, height: 700 },
  ]
  for (const theme of ['light', 'dark'])
    for (const { width, height } of viewports) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme: theme })
      page.on('pageerror', (error) => console.error(error.message))
      await page.addInitScript((mode) => {
        window.__theme = mode
      }, theme)
      await page.goto(url)
      const trigger = page.getByRole('button', { name: 'Menu da conta' })
      await trigger.waitFor({ timeout: 5000 })
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        `${theme} ${width}x${height}: header causes horizontal overflow`
      )
      assert.ok(
        await page.evaluate(() => {
          const brand = document.querySelector('.app-header .brand').getBoundingClientRect()
          const wallet = document.querySelector('.wallet-header-badges').getBoundingClientRect()
          const bell = document.querySelector('.notification-trigger').getBoundingClientRect()
          const menu = document.querySelector('.account-menu-trigger').getBoundingClientRect()
          return brand.right <= wallet.left && wallet.right <= bell.left && bell.right <= menu.left
        }),
        `${theme} ${width}x${height}: header actions overlap`
      )
      for (const position of ['top', 'bottom']) {
        await page.evaluate(
          (where) => window.scrollTo(0, where === 'bottom' ? document.body.scrollHeight : 0),
          position
        )
        await page.waitForTimeout(50)
        const triggerBox = await trigger.boundingBox()
        assert.ok(
          triggerBox && triggerBox.y >= 0 && triggerBox.y + triggerBox.height <= height + 1,
          `${theme} ${width}x${height} ${position}: trigger left viewport ${JSON.stringify(triggerBox)}`
        )
        assert.ok(
          await trigger.evaluate((button) => {
            const box = button.getBoundingClientRect()
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
            return button === hit || button.contains(hit)
          }),
          `${theme} ${width} ${position}: trigger covered`
        )
        await trigger.click()
        const overlay = page.locator('.account-menu-overlay')
        await overlay.waitFor()
        await page.waitForTimeout(250)
        assert.ok(
          await overlay.evaluate((element) => element.contains(document.activeElement)),
          `${theme} ${width}x${height} ${position}: focus did not enter menu`
        )
        const box = await overlay.boundingBox()
        assert.ok(
          box && box.y >= 0 && box.y + box.height <= height + 1,
          `${theme} ${width}x${height} ${position}: overlay outside viewport ${JSON.stringify(box)}`
        )
        assert.equal(await overlay.evaluate((element) => getComputedStyle(element).position), 'fixed')
        const headerBottom = await page
          .locator('.app-header')
          .evaluate((element) => element.getBoundingClientRect().bottom)
        assert.ok(
          box.y >= headerBottom + 3 && box.y <= headerBottom + 12,
          `${theme} ${width} ${position}: overlay not below header`
        )
        if (width < 768) {
          assert.equal(await overlay.getAttribute('data-variant'), 'anchored')
          assert.ok(
            (await overlay.getByRole('menuitem').first().boundingBox()).height >= 44,
            `${theme} ${width}x${height}: first menu target is too small`
          )
          await overlay.getByText('Ferramentas administrativas', { exact: false }).click()
          await overlay.evaluate((element) => {
            element.scrollTop = element.scrollHeight
          })
          assert.ok(
            await overlay.evaluate((element) => element.scrollTop > 0),
            `${theme} ${width} ${position}: mobile menu did not scroll`
          )
          const lastAction = await overlay.getByText('Sair de todos os dispositivos').boundingBox()
          const scroller = await overlay.boundingBox()
          assert.ok(
            lastAction && lastAction.y >= scroller.y && lastAction.y + lastAction.height <= scroller.y + scroller.height,
            `${theme} ${width} ${position}: last mobile action remains clipped`
          )
        }
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2))
        await page.waitForTimeout(50)
        const moved = await overlay.boundingBox()
        assert.ok(
          moved && moved.y >= 0 && moved.y + moved.height <= height + 1,
          `${theme} ${width}x${height} ${position}: open menu left viewport during scroll`
        )
        if (
          evidenceDirectory &&
          position === 'bottom' &&
          (([320, 390, 1440].includes(width) && height === 700) ||
            (width === 320 && height === 420))
        )
          await page.screenshot({ path: join(evidenceDirectory, `app-menu-${width}x${height}-${theme}.png`) })
        await trigger.click()
        await overlay.waitFor({ state: 'detached', timeout: 1500 })
        await trigger.click()
        await overlay.waitFor()
        await page.keyboard.press('Escape')
        await overlay.waitFor({ state: 'detached', timeout: 1500 })
        assert.ok(await trigger.evaluate((button) => document.activeElement === button))
        await trigger.click()
        await overlay.waitFor()
        await page.mouse.click(4, 400)
        await overlay.waitFor({ state: 'detached', timeout: 1500 })
      }
      await trigger.click()
      await page.getByText('Meu perfil', { exact: true }).click()
      assert.equal(new URL(page.url()).pathname, '/perfil')
      await page.locator('.account-menu-overlay').waitFor({ state: 'detached' })
      await page.close()
    }
  console.log('App menu viewport check passed: 32 scenarios')
} finally {
  await browser?.close()
  await new Promise((done) => server?.close(done))
  await rm(directory, { recursive: true, force: true })
}
