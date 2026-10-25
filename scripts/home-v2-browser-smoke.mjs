// Real Home panel/hooks/cache/services with a synthetic Supabase HTTP boundary.
// Security and aggregation are verified by PostgreSQL, never by this fixture.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'home-v2-browser-'))
const evidence = join(root, '.finance-local/home-v2-review')
await mkdir(evidence, { recursive: true })
let server,
  browser,
  reads = 0,
  activity = 1,
  fail = false
const errors = [],
  results = []
const stubs = {
  '/supabase/config': `import {createClient} from '@supabase/supabase-js'; export const supabase=createClient(location.origin,'fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})`,
  '/hooks/useAuth': `import {useSyncExternalStore} from 'react'; const subscribe=f=>{window.addEventListener('account',f);return()=>window.removeEventListener('account',f)}; export function useAuth(){return {user:{uid:useSyncExternalStore(subscribe,()=>window.__uid||'alice')},offlineLocal:false}}`,
}
try {
  await build({
    stdin: {
      contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{BrowserRouter}from'react-router-dom';
    import{ThemeProvider,BaseStyles}from'@primer/react';import{ThemeSync}from'./src/components/ThemeSync';
    import{RecommendedSheetPanel}from'./src/features/home/RecommendedSheetPanel';
    import{invalidateWorkoutCache}from'./src/utils/pageCache';
    import './src/styles/app.css';import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';
    window.__invalidate=invalidateWorkoutCache;
    createRoot(document.getElementById('root')).render(<ThemeProvider colorMode="auto" dayScheme="light" nightScheme="dark"><BaseStyles><ThemeSync/><BrowserRouter><main style={{padding:16,maxWidth:1200,margin:'auto'}}><RecommendedSheetPanel/></main><nav style={{position:'fixed',bottom:0,height:48,background:'var(--bgColor-default)',width:'100%'}}>Navegação</nav></BrowserRouter></BaseStyles></ThemeProvider>);
  `,
      resolveDir: root,
      loader: 'jsx',
    },
    outfile: join(dir, 'app.js'),
    bundle: true,
    minify: true,
    jsx: 'automatic',
    define: { 'import.meta.env': '{}' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'boundaries',
        setup(b) {
          b.onResolve({ filter: /.*/ }, ({ path }) => {
            const key = Object.keys(stubs).find((s) => path.endsWith(s))
            return key ? { path: key, namespace: 'stub' } : undefined
          })
          b.onLoad({ filter: /.*/, namespace: 'stub' }, ({ path }) => ({
            contents: stubs[path],
            resolveDir: root,
          }))
        },
      },
    ],
  })
  server = createServer(async (req, res) => {
    if (req.url.startsWith('/rest/v1/rpc/')) {
      reads++
      assert.equal(req.url, '/rest/v1/rpc/get_my_sheet_insights')
      res.setHeader('Content-Type', 'application/json')
      if (fail) {
        res.statusCode = 503
        res.end(JSON.stringify({ message: 'fixture offline' }))
        return
      }
      res.end(
        JSON.stringify({
          today: '2026-10-25',
          sheets: [
            {
              id: 's1',
              name: 'Ficha A — Peito e tríceps',
              weekdays: [],
              sort_order: 0,
              exercise_count: 3,
              available: true,
              archived_at: null,
              last_date: '2026-10-24',
              last_registered_at: '2026-10-24T15:00:00Z',
              month_days: activity,
            },
          ],
        })
      )
      return
    }
    const path = req.url.split('?')[0]
    if (path === '/app.js' || path === '/app.css') {
      res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css')
      res.end(await readFile(join(dir, path)))
      return
    }
    if (path.startsWith('/img/')) {
      try {
        res.setHeader('Content-Type', path.endsWith('.avif') ? 'image/avif' : 'image/webp')
        res.end(await readFile(join(root, 'public', path)))
      } catch {
        res.statusCode = 404
        res.end()
      }
      return
    }
    res.setHeader('Content-Type', 'text/html')
    res.end(
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script type="module" src="/app.js"></script></body></html>'
    )
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${server.address().port}`
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  for (const theme of ['light', 'dark'])
    for (const width of [320, 360, 390, 768, 1280]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: theme,
        timezoneId: 'Asia/Tokyo',
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      page.on('pageerror', (e) => errors.push(e.message))
      const images = []
      page.on('request', (r) => {
        if (r.url().includes('/img/')) images.push(r.url())
      })
      const before = reads
      await page.goto(url)
      await page.getByRole('heading', { name: 'Ficha A — Peito e tríceps' }).waitFor()
      await page.locator('.workout-hero img').evaluate((img) => img.decode())
      assert.equal(reads - before, 1, 'one aggregate RPC; no duplicate sheet load')
      assert.equal(
        new Set(images.map((u) => u.match(/home-banner-[a-z]+/)?.[0])).size,
        1,
        'only selected photo loaded'
      )
      const geometry = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
        hero: document.querySelector('.workout-hero').getBoundingClientRect().toJSON(),
      }))
      assert.ok(geometry.scroll <= width, `horizontal overflow ${width}/${theme}`)
      assert.ok(geometry.hero.bottom < 852, 'content clears bottom navigation')
      assert.match(
        await page.locator('.sheet-insights-disclosure').innerText(),
        /não comprova conclusão/
      )
      assert.equal(
        await page.getByRole('link', { name: 'Iniciar ficha' }).getAttribute('href'),
        '/novo-treino?ficha=s1'
      )
      const startLink = page.getByRole('link', { name: 'Iniciar ficha' })
      await startLink.focus()
      assert.equal(await startLink.evaluate((el) => el === document.activeElement), true)
      await page.keyboard.press('Tab')
      assert.match(await page.evaluate(() => document.activeElement.textContent), /Ver fichas/)
      const secondary = page.getByRole('link', { name: 'Ver fichas' })
      const contrast = await secondary.evaluate((el) => ({
        text: getComputedStyle(el).color,
        icon: getComputedStyle(el.querySelector('[data-component="leadingVisual"]')).color,
      }))
      assert.equal(contrast.text, 'rgb(255, 255, 255)')
      assert.equal(contrast.icon, contrast.text)
      assert.ok(await page.locator('.workout-hero img').getAttribute('alt'))
      await page.screenshot({ path: join(evidence, `home-${width}-${theme}.png`), fullPage: true })
      results.push({ width, theme, requests: reads - before, images: images.length, geometry })
      // A mounted view receives writes/ACKs, coalesces the batch, and ignores another account.
      const initial = reads
      activity = 2
      await page.evaluate(() => {
        window.__invalidate('bob')
        window.__invalidate('alice')
        window.__invalidate('alice')
      })
      await page.getByText('2 dias com registros neste mês').waitFor()
      assert.equal(reads - initial, 1)
      activity = 1
      // Both photo failures settle on a fixed-size themed background without retry loops.
      const boxBefore = await page.locator('.workout-hero').boundingBox()
      await page.locator('.workout-hero img').dispatchEvent('error')
      await page.locator('.workout-hero img').dispatchEvent('error')
      assert.equal(await page.locator('.workout-hero img').count(), 0)
      assert.deepEqual(await page.locator('.workout-hero').boundingBox(), boxBefore)
      // Network failures surface honestly and explicit retry recovers.
      fail = true
      await page.evaluate(() => window.__invalidate('alice'))
      await page.getByRole('heading', { name: 'Não foi possível carregar suas fichas' }).waitFor()
      fail = false
      await page.getByRole('button', { name: /Tentar novamente/ }).click()
      await page.getByRole('heading', { name: 'Ficha A — Peito e tríceps' }).waitFor()
      await context.close()
    }
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify(results, null, 2))
  console.log(
    JSON.stringify({
      passed: results.length,
      viewports: [320, 360, 390, 768, 1280],
      themes: ['light', 'dark'],
      errors,
    })
  )
} finally {
  await browser?.close()
  await new Promise((r) => (server ? server.close(r) : r()))
  await rm(dir, { recursive: true, force: true })
}
