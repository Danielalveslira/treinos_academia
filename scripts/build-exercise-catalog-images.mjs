import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readCatalog, runImageBuild } from './exercise-catalog-images-core.mjs'

const ROOT = resolve(import.meta.dirname, '..')

function parseMode(args) {
  const dryRun = args.includes('--dry-run')
  const apply = args.includes('--apply')
  if (dryRun === apply) throw new Error('Informe exatamente uma opção: --dry-run ou --apply')
  return dryRun ? 'dry-run' : 'apply'
}

export async function main(args = process.argv.slice(2)) {
  const mode = parseMode(args)
  const catalogPath = resolve(ROOT, 'public/exercise-catalog/v1/catalog.json')
  const outputRoot = resolve(ROOT, '.generated/exercise-catalog-images')
  const catalog = await readCatalog(catalogPath)
  const report = await runImageBuild({
    catalog,
    outputRoot,
    mode,
    sourceBaseUrl: process.env.EXERCISE_CATALOG_IMAGE_SOURCE_BASE_URL || undefined,
    concurrency: Number(process.env.EXERCISE_CATALOG_IMAGE_CONCURRENCY || 6),
  })
  console.log(JSON.stringify(report, null, 2))
  if (mode === 'apply' && report.failures.length) process.exitCode = 1
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  await main()
}
