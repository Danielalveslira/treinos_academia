// Etapa A: medição reproduzível de performance do Início da Central Comercial, antes
// (4 consultas: getAdvertisingCampaigns/listStorefronts/listRefundRequests/
// getCommercialPendingCounts) e depois (só getCommercialPendingCounts) da simplificação
// de CommercialOverview.jsx. Mesma técnica de build-stub-servir-localmente já usada em
// *-browser-smoke.mjs (ver commercial-central-nav-browser-smoke.mjs); nenhuma
// infraestrutura nova, nenhum serviço de rede real, nenhum ambiente de CI novo.
//
//   node scripts/commercial-overview-performance.mjs <arquivo.jsx> <rótulo>
//
// Compara dois estados reproduzindo o componente de cada arquivo isoladamente: as
// chamadas de rede (RPC) feitas ao montar, e o tempo até o conteúdo útil (texto real)
// aparecer na tela, sob as mesmas condições (mesmo navegador, mesma rede local, sem
// variação de usuário/máquina entre as duas medições de uma mesma execução).
import { build } from 'esbuild'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright-core'

const root = resolve(import.meta.dirname, '..')

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
  const page = await browser.newPage()
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  const startedAt = Date.now()
  await page.goto(origin + '/')
  // "Conteúdo útil": o primeiro texto real de dados (não o spinner de carregamento).
  await page
    .getByText(/pendente/)
    .first()
    .waitFor()
  const timeToContentMs = Date.now() - startedAt
  const rpcCalls = await page.evaluate(() => globalThis.__perfCalls || [])
  await browser.close()
  await new Promise((r) => server.close(r))
  await rm(dir, { recursive: true, force: true })

  return { label, rpcCalls, rpcCallCount: rpcCalls.length, timeToContentMs }
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
