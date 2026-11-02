import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = process.cwd()
const out = '/tmp/evolutus-progress-layout'
await mkdir(out, { recursive: true })
const source = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, BaseStyles } from '@primer/react';
import { ProgressChart } from './src/components/ProgressChart.jsx';
import { BodyMetricChart } from './src/components/BodyMetricChart.jsx';
import { StrengthProgressChart } from './src/components/StrengthProgressChart.jsx';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import './src/styles/app.css';
const dark = new URLSearchParams(location.search).has('dark');
const days = Array.from({length: 5}, (_, i) => ({key: String(i), label: String(i*7+1).padStart(2,'0')+'/11', currentValue: (i+1)*150, previousValue: (i+1)*130, currentDate:'2026-11-01 a 2026-11-07', previousDate:'2026-10-01 a 2026-10-07'}));
const body = Array.from({length: 8}, (_, i) => ({date: new Date(2026, 9, i*4+1), label: String(i*4+1).padStart(2,'0')+'/10', value: 80-i*.2}));
const strength = Array.from({length: 8}, (_, i) => {const date = new Date(2026, 9, i*7+1); return {key:String(i), date, label: date.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'}), maxWeightKg: 60+i, estimated1RMKg: 76+i}});
function App() {return <ThemeProvider colorMode={dark?'night':'day'}><BaseStyles><main className="progress-page dashboard fitness-dashboard"><h1>Progresso</h1><div className="metric-tabs" role="group" aria-label="Indicador"><button type="button" aria-pressed="true" className="is-active">Volume</button><button type="button" aria-pressed="false">Séries</button></div><section className="progress-section"><h2>Volume</h2><ProgressChart data={days} showPrevious formatValue={v=>v+' kg'}/></section><section className="progress-section"><h2>Força</h2><StrengthProgressChart data={strength} showEstimate/></section><section className="progress-section"><h2>Medidas</h2><BodyMetricChart data={body} unit="kg"/></section></main></BaseStyles></ThemeProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`
await build({
  stdin: {
    contents: source,
    resolveDir: root,
    sourcefile: 'progress-layout-fixture.jsx',
    loader: 'jsx',
  },
  outdir: out,
  bundle: true,
  format: 'esm',
  splitting: false,
  jsx: 'automatic',
  loader: { '.css': 'css' },
  logLevel: 'silent',
})
await writeFile(
  join(out, 'index.html'),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/stdin.css"></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>'
)
const server = createServer(async (request, response) => {
  const path = request.url?.split('?')[0] === '/' ? '/index.html' : request.url?.split('?')[0]
  if (!['/index.html', '/stdin.js', '/stdin.css'].includes(path)) {
    response.writeHead(404).end()
    return
  }
  const body = await readFile(join(out, path.slice(1)))
  response
    .writeHead(200, {
      'Content-Type':
        extname(path) === '.js'
          ? 'text/javascript'
          : extname(path) === '.css'
            ? 'text/css'
            : 'text/html',
    })
    .end(body)
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH })
try {
  const lightBackgrounds = new Map()
  for (const width of [320, 360, 390, 768, 1024]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        colorScheme: dark ? 'dark' : 'light',
      })
      page.on('pageerror', (error) => console.error(error))
      await page.goto(`http://127.0.0.1:${server.address().port}/${dark ? '?dark' : ''}`)
      await page.locator('.recharts-surface').first().waitFor({ timeout: 5000 })
      const state = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        width: window.innerWidth,
        charts: [...document.querySelectorAll('.progress-chart-surface')].map((el) => ({
          width: el.getBoundingClientRect().width,
          svg: el.querySelector('svg')?.getBoundingClientRect().width,
        })),
        summary: document.querySelectorAll('.chart-data-table summary').length,
        pressed: document.querySelectorAll('[aria-pressed="true"]').length,
        background: getComputedStyle(document.querySelector('.progress-chart-surface'))
          .backgroundColor,
      }))
      assert.ok(
        state.scroll <= state.width + 1,
        `${width}px ${dark ? 'dark' : 'light'} horizontal overflow: ${state.scroll}`
      )
      assert.equal(state.charts.length, 3)
      assert.ok(state.charts.every((chart) => chart.svg > 0 && chart.svg <= chart.width + 1))
      assert.equal(state.summary, 3)
      assert.equal(state.pressed, 1)
      if (dark)
        assert.notEqual(state.background, lightBackgrounds.get(width), 'dark theme changes surface')
      else lightBackgrounds.set(width, state.background)
      await page.locator('.metric-tabs button').first().focus()
      await page.keyboard.press('Tab')
      assert.equal(
        await page
          .locator('.metric-tabs button')
          .nth(1)
          .evaluate((el) => el === document.activeElement),
        true
      )
      if (width === 320)
        await page.screenshot({
          path: join(out, dark ? 'progress-320-dark.png' : 'progress-320-light.png'),
          fullPage: true,
        })
      await page.close()
    }
  }
  console.log(
    'Progress charts: 320, 360, 390, 768, 1024 px; light/dark; no overflow; text alternatives present'
  )
} finally {
  await browser.close()
  await new Promise((done) => server.close(done))
}
