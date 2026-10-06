import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { pathToFileURL } from 'node:url'

// Budget do custo inicial do app (o que o Service Worker baixa na instalação). Lê a lista
// real de precache do sw.js gerado pelo build (scripts/pwa-plugin.js), então nunca diverge
// do que o usuário de fato baixa. Chunks de rota (lazy) ficam fora de propósito: só carregam
// quando a tela é aberta.
//
//   npm run build && npm run budget            confere contra scripts/bundle-budget.json
//   npm run build && npm run budget -- --update  grava um novo baseline (justifique no commit)

const BASELINE_PATH = new URL('./bundle-budget.json', import.meta.url)
const DEFAULT_TOLERANCE = 0.03

export function parseBootAssets(swSource) {
  const match = /const BOOT_ASSETS = (\[[^\]]*\])/.exec(swSource)
  if (!match) throw new Error('BOOT_ASSETS não encontrado no sw.js (rode o build antes)')
  const assets = JSON.parse(match[1])
  if (!Array.isArray(assets) || assets.length === 0) throw new Error('BOOT_ASSETS vazio no sw.js')
  return assets
}

export function measure(distDir, read = (file) => readFileSync(file)) {
  const base = distDir.replace(/\/+$/, '')
  const assets = parseBootAssets(read(`${base}/sw.js`).toString('utf8'))
  const kind = (file) => (file.endsWith('.css') ? 'css' : 'js')
  const totals = { js: 0, css: 0 }
  for (const asset of assets) {
    totals[kind(asset)] += gzipSync(read(`${base}${asset}`), { level: 9 }).length
  }
  return { bootJsGzipBytes: totals.js, bootCssGzipBytes: totals.css, bootFiles: assets.length }
}

export function compare(current, baseline, tolerance = baseline.tolerance ?? DEFAULT_TOLERANCE) {
  const failures = []
  for (const key of ['bootJsGzipBytes', 'bootCssGzipBytes']) {
    const limit = Math.floor(baseline[key] * (1 + tolerance))
    if (current[key] > limit) {
      failures.push(`${key}: ${current[key]} B > limite ${limit} B (baseline ${baseline[key]} B + ${tolerance * 100}%)`)
    }
  }
  if (current.bootFiles > baseline.bootFiles) {
    failures.push(`bootFiles: ${current.bootFiles} > baseline ${baseline.bootFiles} (novo arquivo no precache)`)
  }
  return failures
}

function main(argv) {
  const distDir = argv.find((arg) => !arg.startsWith('--')) || 'dist'
  const current = measure(distDir)
  if (argv.includes('--update')) {
    const next = { tolerance: DEFAULT_TOLERANCE, ...current }
    writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`)
    console.log('Baseline atualizado:', next)
    return 0
  }
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  const failures = compare(current, baseline)
  console.log('Boot (gzip):', current, '| baseline:', baseline)
  if (failures.length) {
    console.error(`Budget excedido:\n - ${failures.join('\n - ')}`)
    return 1
  }
  console.log('Budget OK')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)))
}
