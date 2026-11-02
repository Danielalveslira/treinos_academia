import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join } from 'node:path'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const output = '/tmp/evolutus-body-chart-check'
await mkdir(output, { recursive: true })
const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {ThemeProvider,BaseStyles} from '@primer/react';
import {BodyMetricChart} from './src/components/BodyMetricChart.jsx';
import {getBodyMetricSeries} from './src/utils/bodyComposition.js';
import '@primer/primitives/dist/css/functional/themes/light.css';
import '@primer/primitives/dist/css/functional/themes/dark.css';
import './src/styles/app.css';
const dark = new URLSearchParams(location.search).has('dark');
const now = new Date('2027-01-02T15:00:00Z');
const measurements = [
  ['2026-01-10T15:00:00Z',84,92], ['2026-10-10T15:00:00Z',83,91],
  ['2026-12-05T15:00:00Z',82,90], ['2026-12-12T15:00:00Z',81,89],
  ['2026-12-30T15:00:00Z',80,88], ['2027-01-01T15:00:00Z',79,87],
].map(([date,weightKg,waistCm],id)=>({id,date,createdAt:date,weightKg,waistCm}));
measurements.push({id:'old-same-day',date:'2026-12-30T15:00:00Z',createdAt:'2026-12-30T14:00:00Z',weightKg:147.332,waistCm:140});
const sections = [['month','weightKg',30],['quarter','weightKg',90],['year','weightKg',365],['waist-year','waistCm',365]];
function App(){return <ThemeProvider colorMode={dark?'night':'day'}><BaseStyles><main className="progress-page">{sections.map(([name,field,days])=><section data-period={name} key={name}><h2>{name}</h2><BodyMetricChart data={getBodyMetricSeries(measurements,field,days,now)} unit={field==='weightKg'?'kg':'cm'}/></section>)}</main></BaseStyles></ThemeProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`
await build({
  stdin: {
    contents: source,
    resolveDir: process.cwd(),
    sourcefile: 'body-chart-fixture.jsx',
    loader: 'jsx',
  },
  outdir: output,
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  loader: { '.css': 'css' },
  logLevel: 'silent',
})
await writeFile(
  join(output, 'index.html'),
  '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/stdin.css"></head><body><div id="root"></div><script type="module" src="/stdin.js"></script></body></html>'
)
const server = createServer(async (request, response) => {
  const path = request.url?.split('?')[0] === '/' ? '/index.html' : request.url?.split('?')[0]
  if (!['/index.html', '/stdin.js', '/stdin.css'].includes(path))
    return response.writeHead(404).end()
  const body = await readFile(join(output, path.slice(1)))
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
  const colors = new Map()
  for (const width of [320, 390, 1024]) {
    for (const dark of [false, true]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.goto(`http://127.0.0.1:${server.address().port}/${dark ? '?dark' : ''}`)
      await page.locator('[data-period="month"] .recharts-line-curve').waitFor()
      const result = await page.evaluate(() => {
        const sections = [...document.querySelectorAll('[data-period]')].map((section) => {
          const svg = section.querySelector('svg')
          return {
            name: section.dataset.period,
            dots: [...section.querySelectorAll('.recharts-line-dots circle')].map((dot) => ({
              x: Number(dot.getAttribute('cx')),
              y: Number(dot.getAttribute('cy')),
            })),
            path: section.querySelector('.recharts-line-curve')?.getAttribute('d'),
            height: svg?.getBoundingClientRect().height,
            rows: section.querySelectorAll('.chart-data-table tbody tr').length,
            yTicks: [
              ...section.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick text'),
            ].map((tick) => tick.textContent),
            color: getComputedStyle(section.querySelector('.body-metric-chart-surface'))
              .backgroundColor,
          }
        })
        return { scroll: document.documentElement.scrollWidth, width: innerWidth, sections }
      })
      assert.ok(result.scroll <= result.width + 1, `${width}px horizontal overflow`)
      assert.deepEqual(
        result.sections.map((section) => section.dots.length),
        [4, 5, 6, 6]
      )
      assert.ok(
        result.sections
          .slice(0, 3)
          .every((section) =>
            section.yTicks.every((tick) => Number(tick.replaceAll('.', '').replace(',', '.')) < 100)
          ),
        'weight axis uses measured values only'
      )
      assert.ok(
        result.sections.every(
          (section) =>
            section.rows === section.dots.length && (section.path?.match(/M/g) || []).length === 1
        ),
        'one continuous path through real points'
      )
      assert.ok(
        result.sections.every((section) =>
          section.dots.every((dot) => dot.y > 10 && dot.y < section.height - 10)
        ),
        'vertical padding keeps dots away from edges'
      )
      const month = result.sections[0].dots
      assert.equal(
        new Set(month.map((dot) => dot.x)).size,
        month.length,
        'one point per business date'
      )
      const ratio = (month[2].x - month[1].x) / (month[1].x - month[0].x)
      assert.ok(ratio > 2.4 && ratio < 2.75, `date spacing must be proportional: ${ratio}`)
      if (dark) assert.notEqual(result.sections[0].color, colors.get(width), 'dark surface')
      else colors.set(width, result.sections[0].color)
      await page.locator('[data-period="month"] .recharts-line-dots circle').last().hover()
      assert.match(
        await page.locator('[data-period="month"] .recharts-tooltip-wrapper').innerText(),
        /01\/01\/2027[\s\S]*79 kg/
      )
      await page.close()
    }
  }
  console.log(
    'Body charts: continuous real points, proportional dates, padded Y axis, tooltips; 320/390/1024 px, light/dark'
  )
} finally {
  await browser.close()
  await new Promise((done) => server.close(done))
}
