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
const evidence = join(root, '.finance-local/home-v2-photos')
await mkdir(evidence, { recursive: true })
let server,
  browser,
  reads = 0,
  activity = 1,
  fail = false,
  v4 = null
const errors = [],
  results = [],
  completionResults = []
const stubs = {
  '/supabase/config': `import {createClient} from '@supabase/supabase-js'; export const supabase=createClient(location.origin,'fixture',{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}})`,
  '/hooks/useAuth': `import {useSyncExternalStore} from 'react'; const subscribe=f=>{window.addEventListener('account',f);return()=>window.removeEventListener('account',f)}; export function useAuth(){const [uid,sexo]=JSON.parse(useSyncExternalStore(subscribe,()=>JSON.stringify([window.__uid||'alice',window.__sexo??null])));return {user:{uid},profile:{sexo},offlineLocal:false}}`,
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
          sheets: v4
            ? [
                {
                  id: 'a',
                  name: 'Treino A',
                  weekdays: [1, 3, 5],
                  sort_order: 0,
                  exercise_count: 3,
                  available: true,
                  last_date: v4 === 'not_started' ? null : '2026-10-26',
                  completed_today: v4 === 'completed',
                },
                {
                  id: 'b',
                  name: 'Treino B',
                  weekdays: [2, 4, 6],
                  sort_order: 1,
                  exercise_count: 3,
                  available: true,
                },
              ]
            : [
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
      await page.clock.setFixedTime(new Date('2026-10-26T12:00:00-03:00'))
      await page.addInitScript(() => {
        window.__sexo = localStorage.getItem('fixture-sexo') || 'masculino'
      })
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
      assert.deepEqual(
        new Set(images.map((u) => u.match(/\/img\/(.+)-\d+\./)?.[1])),
        new Set(['capa']),
        'only selected photo loaded'
      )
      const geometry = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: innerWidth,
        hero: document.querySelector('.workout-hero').getBoundingClientRect().toJSON(),
      }))
      assert.ok(geometry.scroll <= width, `horizontal overflow ${width}/${theme}`)
      assert.ok(geometry.hero.bottom < 852, 'content clears bottom navigation')
      const disclosure = page.locator('.sheet-insights-disclosure')
      assert.equal(await disclosure.getAttribute('open'), null)
      await disclosure.locator('summary').focus()
      await page.keyboard.press('Enter')
      assert.match(await disclosure.innerText(), /não comprova conclusão/)
      assert.match(await disclosure.innerText(), /após sincronização/)
      await page.keyboard.press('Enter')
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
      const imageNames = (from) => images.slice(from).map((u) => u.match(/\/img\/(.+)-\d+\./)?.[1])
      const selectProfile = (sexo) =>
        page.evaluate((value) => {
          window.__sexo = value
          localStorage.setItem('fixture-sexo', value)
          window.dispatchEvent(new Event('account'))
        }, sexo)
      const selectDay = async (date) => {
        await page.clock.setFixedTime(new Date(`${date}T12:00:00-03:00`))
        await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
      }
      const expectPhoto = async (name) => {
        await page.waitForFunction(
          (name) =>
            document.querySelector('.workout-hero img')?.getAttribute('src').includes(`/${name}-`),
          name
        )
        await page.locator('.workout-hero img').evaluate((img) => img.decode())
      }
      const expected = {
        masculino: ['capa', 'home-banner-anilhas', 'capa', 'home-banner-equipe'],
        feminino: ['sexo_mulher', 'home-banner-anilhas', 'sexo_mulher', 'home-banner-equipe'],
        nao_informar: [
          'home-banner-anilhas',
          'home-banner-equipe',
          'home-banner-anilhas',
          'home-banner-equipe',
        ],
      }
      for (let day = 0; day < 4; day++) {
        await selectDay(`2026-10-${26 + day}`)
        for (const sexo of Object.keys(expected)) {
          const beforeImages = images.length
          await selectProfile(sexo)
          const selected = expected[sexo][day]
          await expectPhoto(selected)
          assert.ok(
            imageNames(beforeImages).every((name) => name === selected),
            'no unselected image download'
          )
          const layout = await page.evaluate(() => ({
            width: innerWidth,
            scroll: document.documentElement.scrollWidth,
            hero: document.querySelector('.workout-hero').getBoundingClientRect().toJSON(),
            fit: getComputedStyle(document.querySelector('.workout-hero img')).objectFit,
          }))
          assert.ok(layout.scroll <= width)
          assert.ok(layout.hero.bottom < 852)
          assert.equal(
            layout.fit,
            selected === 'capa' || selected === 'sexo_mulher' ? 'contain' : 'cover'
          )
          assert.equal(
            await page.getByRole('link', { name: 'Iniciar ficha' }).getAttribute('href'),
            '/novo-treino?ficha=s1'
          )
          await page.screenshot({
            path: join(evidence, `${sexo}-day${day + 1}-${width}-${theme}.png`),
            fullPage: true,
          })
        }
      }
      // Changing profile within the same day never triggers another aggregate/database read.
      const profileReads = reads
      await selectProfile('masculino')
      await expectPhoto('home-banner-equipe')
      await selectProfile('feminino')
      await expectPhoto('home-banner-equipe')
      assert.equal(reads, profileReads)
      await selectDay('2026-10-30')
      await expectPhoto('sexo_mulher')
      // Reload retains the registered visual group and day, without a random choice.
      const reloadImages = images.length
      await page.reload()
      await expectPhoto('sexo_mulher')
      assert.ok(imageNames(reloadImages).every((name) => name === 'sexo_mulher'))
      await page.screenshot({ path: join(evidence, `home-${width}-${theme}.png`), fullPage: true })
      results.push({ width, theme, requests: reads - before, images: images.length, geometry })
      // A mounted view receives writes/ACKs, coalesces the batch, and ignores another account.
      const initial = reads
      const originalImage = await page.locator('.workout-hero img').elementHandle()
      const imageRequestsBefore = images.length
      activity = 2
      await page.evaluate(() => {
        window.__invalidate('bob')
        window.__invalidate('alice')
        window.__invalidate('alice')
      })
      await page.getByText('2 dias com registros neste mês').waitFor()
      assert.equal(reads - initial, 1)
      assert.equal(
        await originalImage.evaluate((el) => el === document.querySelector('.workout-hero img')),
        true
      )
      assert.equal(
        images.length,
        imageRequestsBefore,
        'training data refresh does not reload photo'
      )
      activity = 1
      // Personal fallback tries only neutral photos; three failures settle without a loop.
      const boxBefore = await page.locator('.workout-hero').boundingBox()
      const fallbackRequests = images.length
      const failTo = async (next) => {
        await page.locator('.workout-hero img').dispatchEvent('error')
        if (next) await expectPhoto(next)
        else await page.locator('.workout-hero img').waitFor({ state: 'detached' })
        assert.deepEqual(await page.locator('.workout-hero').boundingBox(), boxBefore)
      }
      await failTo('home-banner-anilhas')
      await failTo('home-banner-equipe')
      await failTo(null)
      assert.ok(
        imageNames(fallbackRequests).every((name) =>
          ['home-banner-anilhas', 'home-banner-equipe'].includes(name)
        )
      )
      await selectProfile('masculino')
      await expectPhoto('capa')
      await selectProfile('feminino')
      await expectPhoto('sexo_mulher')
      // Same neutral selection, different group: previous errors must be cleared.
      await selectDay('2026-10-31')
      await expectPhoto('home-banner-anilhas')
      await page.locator('.workout-hero img').dispatchEvent('error')
      await expectPhoto('home-banner-equipe')
      await selectProfile('masculino')
      await expectPhoto('home-banner-anilhas')
      // Simulated device suspension across midnight/month, without reload.
      await page.clock.setFixedTime(new Date('2026-11-01T12:00:00-03:00'))
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
      await expectPhoto('capa')
      // Network failures surface honestly and explicit retry recovers.
      fail = true
      await page.evaluate(() => window.__invalidate('alice'))
      await page.getByRole('heading', { name: 'Não foi possível carregar suas fichas' }).waitFor()
      fail = false
      await page.getByRole('button', { name: /Tentar novamente/ }).click()
      await page.getByRole('heading', { name: 'Ficha A — Peito e tríceps' }).waitFor()
      await context.close()
    }
  // Critical V4 regression with the real panel, cache invalidation, slow CPU and both themes.
  for (const theme of ['light', 'dark']) {
    v4 = 'not_started'
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: theme,
    })
    const page = await context.newPage()
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
    await page.clock.setFixedTime(new Date('2026-10-26T15:00:00Z'))
    await page.goto(url)
    await page.getByRole('link', { name: 'Iniciar ficha' }).waitFor()
    v4 = 'in_progress'
    const progressStart = performance.now()
    await page.evaluate(() => window.__invalidate('alice'))
    await page.getByRole('link', { name: 'Continuar ficha' }).waitFor()
    const progressMs = performance.now() - progressStart
    v4 = 'completed'
    const completionStart = performance.now()
    await page.evaluate(() => window.__invalidate('alice'))
    await page.getByRole('heading', { name: 'Treino B' }).waitFor()
    const completionMs = performance.now() - completionStart
    await page.getByText('Treino de hoje concluído', { exact: true }).waitFor()
    assert.match(await page.locator('.workout-hero').innerText(), /terça-feira, 27\/10/)
    assert.equal(await page.getByRole('link', { name: 'Iniciar ficha' }).count(), 0)
    assert.equal(
      await page.getByRole('link', { name: 'Ver próximo treino' }).getAttribute('href'),
      '/fichas/b'
    )
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    assert.equal(overflow, false)
    completionResults.push({ theme, width: 390, cpuSlowdown: 4, progressMs, completionMs, overflow })
    await page.screenshot({ path: join(evidence, `v4-completed-${theme}.png`) })
    await context.close()
  }
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify(results, null, 2))
  await writeFile(join(evidence, 'v4-results.json'), JSON.stringify(completionResults, null, 2))
  console.log(
    JSON.stringify({
      passed: results.length,
      photoCases: 120,
      profiles: ['masculino', 'feminino', 'nao_informar'],
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
