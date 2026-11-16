// Etapa A: medição reproduzível de performance do Início da Central Comercial, antes
// (4 consultas: getAdvertisingCampaigns/listStorefronts/listRefundRequests/
// getCommercialPendingCounts) e depois (só getCommercialPendingCounts) da simplificação
// de CommercialOverview.jsx. Mesma técnica de build-stub-servir-localmente já usada em
// *-browser-smoke.mjs (ver commercial-central-nav-browser-smoke.mjs); nenhuma
// infraestrutura nova, nenhum serviço de rede real, nenhum ambiente de CI novo.
//
// IMPORTANTE: os serviços são stubs locais (globalThis.__perfCalls), não chamadas reais
// à rede/Supabase -- este script mede tempo de render em navegador local (Chromium
// headless na mesma máquina), não latência de produção. "localBrowserTimeToDataMs" é um
// proxy comparável ENTRE as duas versões do mesmo componente, não uma medição de rede.
//
//   node scripts/commercial-overview-performance.mjs <antes.jsx> <rotuloAntes> <depois.jsx> <rotuloDepois>
//
// Cada versão é medida com 1 execução de aquecimento (descartada) + 5 amostras válidas,
// mesma máquina/navegador/dados simulados, reportando a mediana. A condição de conclusão
// espera o rótulo numérico real (ex. "3 pendentes"), que só existe depois que o estado
// vira "ready" -- nunca o título estático do cartão, que aparece antes da consulta
// resolver nas duas versões.
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

async function measure(componentPath, label) {
  const dir = await mkdtemp(join(tmpdir(), 'commercial-overview-perf-'))
  await build({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{MemoryRouter}from'react-router-dom';import{ThemeProvider,BaseStyles}from'@primer/react';import CommercialOverview from '${componentPath}';createRoot(document.getElementById('root')).render(<ThemeProvider colorMode='day' dayScheme='light' nightScheme='dark'><BaseStyles><MemoryRouter><CommercialOverview/></MemoryRouter></BaseStyles></ThemeProvider>)`,
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
          // Stub nas mesmas quatro origens que a RPC de contagem já substitui (ou não),
          // dependendo de qual versão do componente está sendo medida -- cada um conta
          // suas próprias chamadas via globalThis.__perfCalls, lido pela página de teste.
          const stubs = {
            advertisingService: `export const getAdvertisingCampaigns = () => { globalThis.__perfCalls.push('getAdvertisingCampaigns'); return Promise.resolve([]) }`,
            storefrontService: `export const listStorefronts = () => { globalThis.__perfCalls.push('listStorefronts'); return Promise.resolve({ items: [] }) }`,
            refundService: `export const listRefundRequests = () => { globalThis.__perfCalls.push('listRefundRequests'); return Promise.resolve([]) }`,
            commercialOverviewService: `export const getCommercialPendingCounts = () => { globalThis.__perfCalls.push('getCommercialPendingCounts'); return Promise.resolve({ pendingAds: 1, pendingStorefronts: 1, pendingBoosts: 1, openRefunds: 1 }) }`,
          }
          for (const name of Object.keys(stubs)) {
            b.onResolve({ filter: new RegExp(`(^|/)${name}$`) }, () => ({
              path: name,
              namespace: 'stub',
            }))
          }
          b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
            contents: `globalThis.__perfCalls=globalThis.__perfCalls||[];\n${stubs[args.path]}`,
            loader: 'jsx',
            resolveDir: root,
          }))
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

  // Uma amostra: carrega a página do zero (novo contexto, sem cache entre amostras) e
  // espera o rótulo NUMÉRICO real de algum cartão (ex. "3 pendentes") -- esse texto só
  // existe depois que o estado de pendências virou "ready", nunca antes (diferente do
  // título estático "Aprovações pendentes"/"Reembolsos em andamento", que é renderizado
  // incondicionalmente e não prova que os dados chegaram). Falha explicitamente, sem
  // declarar sucesso, se em vez disso aparecer a mensagem de erro de consulta.
  async function sampleOnce() {
    const context = await browser.newContext()
    const page = await context.newPage()
    const errorText = page.getByText('Não foi possível consultar estes dados.')
    const dataLabel = page.getByText(/\d+\s*pendente/)
    const startedAt = performance.now()
    await page.goto(origin + '/')
    const dataWait = dataLabel
      .first()
      .waitFor()
      .then(() => 'data')
    const errorWait = errorText.waitFor().then(() => 'error')
    const winner = await Promise.race([dataWait, errorWait])
    // A promessa perdedora segue pendente até seu próprio timeout; nada a tratar além de
    // evitar um "unhandled rejection" quando ela expirar sem que ninguém mais a observe.
    dataWait.catch(() => {})
    errorWait.catch(() => {})
    if (winner === 'error') {
      throw new Error(`${label}: estado de erro apareceu em vez dos contadores reais`)
    }
    const localBrowserTimeToDataMs = performance.now() - startedAt
    const rpcCalls = await page.evaluate(() => globalThis.__perfCalls || [])
    await context.close()
    return { localBrowserTimeToDataMs, rpcCalls }
  }

  for (let i = 0; i < WARMUP_RUNS; i++) await sampleOnce()
  const samples = []
  for (let i = 0; i < SAMPLE_RUNS; i++) samples.push(await sampleOnce())

  await browser.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })

  const timings = samples.map((s) => s.localBrowserTimeToDataMs)
  return {
    label,
    rpcCalls: samples[0].rpcCalls,
    rpcCallCount: samples[0].rpcCalls.length,
    samplesMs: timings,
    medianLocalBrowserTimeToDataMs: median(timings),
  }
}

const [, , fileA, labelA, fileB, labelB] = process.argv
if (!fileA || !fileB) {
  console.error(
    'uso: node scripts/commercial-overview-performance.mjs <antes.jsx> <rotuloAntes> <depois.jsx> <rotuloDepois>'
  )
  process.exit(1)
}
const before = await measure(resolve(fileA), labelA)
const after = await measure(resolve(fileB), labelB)
console.log(JSON.stringify({ before, after }, null, 2))
