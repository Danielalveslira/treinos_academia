// Real Home panel/hooks/cache/services with a synthetic Supabase HTTP boundary.
// Security and aggregation are verified by PostgreSQL, never by this fixture.
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const root = resolve(import.meta.dirname, '..')
const dir = await mkdtemp(join(tmpdir(), 'home-v2-browser-'))
const baselineRef = process.env.HOME_VISUAL_BASELINE
// CPU throttling belongs in the isolated CI runner, keeping Codespace preview responsive.
const cpuSlowdown = process.env.CI ? 4 : 1
const evidence = join(
  root,
  baselineRef ? '.finance-local/home-v3-before' : '.finance-local/home-v3-after'
)
await mkdir(evidence, { recursive: true })
let server,
  browser,
  reads = 0,
  activity = 1,
  fail = false,
  variant = 'normal'
const errors = [],
  results = []
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
    import{SponsoredAdBanner}from'./src/components/SponsoredAdBanner';
    import{invalidateWorkoutCache}from'./src/utils/pageCache';
    import './src/styles/app.css';import '@primer/primitives/dist/css/functional/themes/light.css';import '@primer/primitives/dist/css/functional/themes/dark.css';
    window.__invalidate=invalidateWorkoutCache;
    createRoot(document.getElementById('root')).render(<ThemeProvider colorMode="auto" dayScheme="light" nightScheme="dark"><BaseStyles><ThemeSync/><BrowserRouter><main style={{padding:"16px 16px 80px",maxWidth:1200,margin:'auto'}}><SponsoredAdBanner placement="home_banner" ads={[{id:"fixture-ad",partnerName:"Academia Evolutus",title:"Seu próximo treino começa aqui",ctaLabel:"Conhecer",ctaType:"external",ctaTarget:"https://example.com/fitness"}]}/><RecommendedSheetPanel/></main><nav style={{position:'fixed',bottom:0,height:48,background:'var(--bgColor-default)',width:'100%'}}>Navegação</nav></BrowserRouter></BaseStyles></ThemeProvider>);
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
        name: 'visual-baseline',
        setup(b) {
          if (!baselineRef) return
          b.onLoad(
            {
              filter:
                /src\/(styles\/app\.css|features\/home\/RecommendedSheetPanel\.jsx|components\/SponsoredAdBanner\.jsx)$/,
            },
            ({ path }) => ({
              contents: execFileSync(
                'git',
                ['show', `${baselineRef}:${path.slice(root.length + 1)}`],
                { cwd: root, encoding: 'utf8' }
              ),
              loader: path.endsWith('.css') ? 'css' : 'jsx',
              resolveDir: path.slice(0, path.lastIndexOf('/')),
            })
          )
        },
      },
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
          sheets:
            variant === 'empty'
              ? []
              : [
                  {
                    id: 's1',
                    name:
                      variant === 'long'
                        ? 'Ficha de fortalecimento completo de membros superiores, mobilidade e condicionamento — progressão personalizada'
                        : 'Ficha A — Peito e tríceps',
                    weekdays: [],
                    sort_order: 0,
                    exercise_count: 3,
                    available: true,
                    archived_at: null,
                    last_date: variant === 'historyless' ? null : '2026-10-24',
                    last_registered_at: variant === 'historyless' ? null : '2026-10-24T15:00:00Z',
                    month_days: variant === 'historyless' ? 0 : activity,
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
      if (baselineRef) {
        await page.screenshot({
          path: join(evidence, `before-${width}-${theme}.png`),
          fullPage: true,
        })
        results.push({
          width,
          theme,
          heroHeight: await page
            .locator('.workout-hero')
            .evaluate((el) => el.getBoundingClientRect().height),
        })
        await context.close()
        continue
      }
      const client = await context.newCDPSession(page)
      await client.send('Emulation.setCPUThrottlingRate', { rate: cpuSlowdown })
      const ad = page.locator('.sponsored-ad-banner')
      await ad.getByText('Patrocinado', { exact: true }).waitFor()
      assert.equal(
        await ad.getByRole('link', { name: 'Conhecer' }).getAttribute('href'),
        'https://example.com/fitness'
      )
      assert.ok((await ad.getByRole('link', { name: 'Conhecer' }).boundingBox()).height >= 40)
      if (width < 768)
        assert.ok((await ad.boundingBox()).height <= 110, 'compact home advertisement')
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
      assert.match(await disclosure.innerText(), /salvos apenas offline/)
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
            width >= 768 && (selected === 'capa' || selected === 'sexo_mulher')
              ? 'contain'
              : 'cover'
          )
          assert.equal(
            await page.getByRole('link', { name: 'Iniciar ficha' }).getAttribute('href'),
            '/novo-treino?ficha=s1'
          )
          // A background must cover both disclosure states without replacing/reloading it.
          const photoHandle = await page.locator('.workout-hero img').elementHandle()
          const photoBox = await photoHandle.boundingBox()
          const requestsBeforeDisclosure = images.length
          const readsBeforeDisclosure = reads
          const assertBackground = async () => {
            const bounds = await page.evaluate(() => {
              const hero = document.querySelector('.workout-hero')
              const img = hero.querySelector('img')
              return {
                hero: hero.getBoundingClientRect().toJSON(),
                image: img.getBoundingClientRect().toJSON(),
                shade: hero.querySelector('.workout-hero-shade').getBoundingClientRect().toJSON(),
                fit: getComputedStyle(img).objectFit,
                position: getComputedStyle(img).objectPosition,
                overflow: getComputedStyle(
                  innerWidth < 768 ? hero : hero.closest('.workout-recommendation')
                ).overflow,
              }
            })
            assert.equal(bounds.overflow, 'hidden')
            if (width < 768) {
              assert.equal(bounds.fit, 'cover', 'mobile photo must fill the card')
              for (const edge of ['left', 'top', 'right', 'bottom']) {
                assert.ok(
                  Math.abs(bounds.hero[edge] - bounds.image[edge]) < 1,
                  `photo must fill ${edge}`
                )
                assert.ok(
                  Math.abs(bounds.hero[edge] - bounds.shade[edge]) < 1,
                  `gradient must fill ${edge}`
                )
              }
              if (selected === 'capa' || selected === 'sexo_mulher') {
                assert.equal(bounds.position, '50% 22%', 'keep athlete framing near the top')
              }
            }
          }
          await assertBackground()
          await disclosure.locator('summary').click()
          assert.notEqual(await disclosure.getAttribute('open'), null)
          await assertBackground()
          assert.deepEqual(
            await photoHandle.boundingBox(),
            photoBox,
            'disclosure must not change photo framing'
          )
          assert.deepEqual(
            await page.locator('.workout-hero').boundingBox(),
            {
              x: layout.hero.x,
              y: layout.hero.y,
              width: layout.hero.width,
              height: layout.hero.height,
            },
            'opening metrics must not resize or move hero'
          )
          if (day === 0)
            await page.screenshot({
              path: join(evidence, `${sexo}-disclosure-open-${width}-${theme}.png`),
              fullPage: true,
            })
          await disclosure.locator('summary').click()
          assert.equal(await disclosure.getAttribute('open'), null)
          await assertBackground()
          assert.deepEqual(
            await page.locator('.workout-hero').boundingBox(),
            {
              x: layout.hero.x,
              y: layout.hero.y,
              width: layout.hero.width,
              height: layout.hero.height,
            },
            'disclosure round trip must restore card geometry'
          )
          assert.equal(
            await page
              .locator('.workout-hero img')
              .evaluate((img, original) => img === original, photoHandle),
            true
          )
          assert.equal(images.length, requestsBeforeDisclosure, 'disclosure must not reload photos')
          assert.equal(reads, readsBeforeDisclosure, 'disclosure must not query the backend')
          await photoHandle.dispose()
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
      ;((fail = false), (variant = 'normal'))
      await page.getByRole('button', { name: /Tentar novamente/ }).click()
      await page.getByRole('heading', { name: 'Ficha A — Peito e tríceps' }).waitFor()
      for (const state of ['long', 'historyless', 'empty']) {
        variant = state
        await page.evaluate(() => window.__invalidate('alice'))
        if (state === 'empty')
          await page.getByRole('button', { name: 'Criar primeira ficha' }).waitFor()
        else {
          await page
            .getByRole('heading', {
              name:
                state === 'long'
                  ? 'Ficha de fortalecimento completo de membros superiores, mobilidade e condicionamento — progressão personalizada'
                  : 'Ficha A — Peito e tríceps',
            })
            .waitFor()
          if (state === 'historyless')
            assert.equal(await page.locator('.sheet-insight-card').count(), 0)
          assert.ok(
            (await page.getByRole('link', { name: 'Iniciar ficha' }).boundingBox()).height >= 44
          )
        }
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `overflow ${state}/${width}`
        )
        await page.screenshot({
          path: join(evidence, `${state}-${width}-${theme}.png`),
          fullPage: true,
        })
      }
      variant = 'normal'
      await context.close()
    }
  assert.deepEqual(errors, [])
  await writeFile(join(evidence, 'browser-results.json'), JSON.stringify(results, null, 2))
  console.log(
    JSON.stringify({
      passed: results.length,
      photoCases: baselineRef ? 0 : 120,
      cpuSlowdown: baselineRef ? 1 : cpuSlowdown,
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
