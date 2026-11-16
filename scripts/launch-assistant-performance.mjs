// PR4b: medição reproduzível de consultas/tempo do assistente de lançamento, nas
// mesmas condições do benchmark da Etapa A (commercial-overview-performance.mjs) --
// Chromium headless local, serviços stubados (não é rede real), 1 execução de
// aquecimento descartada + 5 amostras por cenário, mediana reportada.
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')
const WARMUP_RUNS = 1
const SAMPLE_RUNS = 5

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const dir = await mkdtemp(join(tmpdir(), 'launch-assistant-perf-'))
await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import CommercialOverview from './src/components/CommercialOverview.jsx';createRoot(document.getElementById('root')).render(<ThemeProvider colorMode='day' dayScheme='light' nightScheme='dark'><BaseStyles><MemoryRouter><CommercialOverview/></MemoryRouter></BaseStyles></ThemeProvider>)`,
    resolveDir: root,
    loader: 'jsx',
  },
  bundle: true,
  format: 'esm',
  outfile: join(dir, 'app.js'),
  jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
  plugins: [
    {
      name: 'fixtures',
      setup(b) {
        const map = [
          [/services\/commercialOverviewService$/, 'getCommercialPendingCounts'],
          [/services\/launchAssistantService$/, null],
          [/services\/evocashPricingService$/, 'reauthenticatePricingAdmin'],
          [/(^|\/)AuthCaptcha$/, 'AuthCaptcha'],
        ]
        for (const [filter] of map)
          b.onResolve({ filter }, () => ({ path: filter.source, namespace: 'fixture' }))
        b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => {
          const [, name] = map.find(([f]) => f.source === args.path)
          const base = `
            globalThis.__perfCalls = globalThis.__perfCalls || []
            const push = (n) => (r) => { globalThis.__perfCalls.push(n); return r }
          `
          if (args.path.includes('launchAssistantService')) {
            return {
              contents:
                base +
                `
                export const getLaunchVerification = () => Promise.resolve(globalThis.__perfVerify()).then(push('verify'))
                export const activateOffering = () => Promise.resolve({}).then(push('activateOffering'))
                export const activatePlacement = () => Promise.resolve({}).then(push('activatePlacement'))
              `,
              loader: 'jsx',
              resolveDir: root,
            }
          }
          if (args.path.includes('authCaptcha')) {
            return {
              contents:
                'export const authCaptchaRequired = false\nexport function takeCaptchaToken() { return null }',
              loader: 'jsx',
              resolveDir: root,
            }
          }
          if (name === 'AuthCaptcha') {
            return {
              contents: `import { forwardRef } from 'react'\nexport const AuthCaptcha = forwardRef(function AuthCaptcha(_p, ref) { return null })`,
              loader: 'jsx',
              resolveDir: root,
            }
          }
          return {
            contents:
              base +
              `export const ${name} = () => Promise.resolve(globalThis.__perfCounts ? globalThis.__perfCounts() : { pendingAds: 1, pendingStorefronts: 0, pendingBoosts: 1, openRefunds: 2 }).then(push('counts'))`,
            loader: 'jsx',
            resolveDir: root,
          }
        })
      },
    },
  ],
  logLevel: 'silent',
})

const server = createServer(async (req, res) => {
  res.setHeader('Content-Type', req.url.startsWith('/app.js') ? 'text/javascript' : 'text/html')
  res.end(
    req.url === '/app.js'
      ? await readFile(join(dir, 'app.js'))
      : '<!doctype html><div id="root"></div><script type="module" src="/app.js"></script>'
  )
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const origin = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
})

async function sampleOnce() {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.addInitScript(() => {
    globalThis.__perfVerify = () => ({
      supplier: { state: 'ready', value: true },
      evocash: { state: 'ready', value: { quotingEnabled: true, checkoutEnabled: true } },
      catalog: {
        state: 'ready',
        value: {
          items: [
            {
              code: 'post_boost',
              name: 'Impulsionar publicação',
              integrationReady: true,
              salesEnabled: false,
              revision: '5',
              currentPrice: { unitPriceCash: '7', minDays: 1, maxDays: 5 },
            },
          ],
        },
      },
      inventory: { state: 'ready', value: { placements: [] } },
    })
  })
  await page.goto(origin + '/')
  await page
    .getByText(/\d+\s*pendente/)
    .first()
    .waitFor()
  const callsClosed = await page.evaluate(() => globalThis.__perfCalls.length)

  const startedAt = performance.now()
  await page.getByRole('button', { name: 'Abrir assistente' }).click()
  await page
    .getByText('tudo pronto')
    .or(page.getByText(/pendência/))
    .first()
    .waitFor()
  const openMs = performance.now() - startedAt
  const callsOpen = await page.evaluate(() => globalThis.__perfCalls.length)

  await page.getByRole('button', { name: 'Verificar novamente' }).click()
  await page.waitForTimeout(50)
  const callsValidated = await page.evaluate(() => globalThis.__perfCalls.length)

  await context.close()
  return {
    queriesClosed: callsClosed,
    queriesAfterOpen: callsOpen - callsClosed,
    queriesAfterValidate: callsValidated - callsOpen,
    openToContentMs: openMs,
  }
}

await page_warmup()
async function page_warmup() {
  for (let i = 0; i < WARMUP_RUNS; i++) await sampleOnce()
}
const samples = []
for (let i = 0; i < SAMPLE_RUNS; i++) samples.push(await sampleOnce())

await browser.close()
await new Promise((r) => server.close(r))
await rm(dir, { recursive: true, force: true })

const openTimings = samples.map((s) => s.openToContentMs)
console.log(
  JSON.stringify(
    {
      methodology:
        'Chromium headless local, serviços stubados (não é rede real). 1 aquecimento descartado + 5 amostras, mediana reportada.',
      queriesClosed: samples[0].queriesClosed,
      queriesAfterOpen: samples[0].queriesAfterOpen,
      queriesAfterValidate: samples[0].queriesAfterValidate,
      queriesAfterEditDisclaimer:
        'Reabrir após configurar é o mesmo caminho de "abrir" (remontagem busca dados novos; não há cache a invalidar) -- mesma contagem de queriesAfterOpen.',
      openToContentSamplesMs: openTimings,
      medianOpenToContentMs: median(openTimings),
    },
    null,
    2
  )
)
