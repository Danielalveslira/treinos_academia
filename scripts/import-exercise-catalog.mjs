import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { buildImportPlan } from './exercise-catalog-import-core.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const SOURCE_PATH = resolve(ROOT, 'imports/exercicios_ptbr.json')
const PROVIDER = 'evolutus_dataset'
const PAGE_SIZE = 1000
const UPSERT_CHUNK_SIZE = 200

function parseArgs(args) {
  const dryRun = args.includes('--dry-run')
  const apply = args.includes('--apply')
  const unknown = args.filter((arg) => arg !== '--dry-run' && arg !== '--apply')
  if (unknown.length || (dryRun && apply)) {
    throw new Error('Use: node scripts/import-exercise-catalog.mjs [--dry-run | --apply]')
  }
  // --dry-run é o padrão -- só grava se --apply for passado explicitamente.
  return { apply }
}

async function loadSource() {
  const raw = await readFile(SOURCE_PATH, 'utf-8')
  const data = JSON.parse(raw)
  if (!Array.isArray(data)) throw new Error(`INVALID_SOURCE_FORMAT: ${SOURCE_PATH} não é um array`)
  return data
}

async function loadExisting(client) {
  const existing = new Map()
  let from = 0
  for (;;) {
    const { data, error } = await client
      .from('exercise_catalog')
      .select('provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, source_media_refs')
      .eq('provider', PROVIDER)
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`FAILED_TO_LOAD_EXISTING: ${error.message}`)
    for (const row of data) existing.set(row.provider_exercise_id, row)
    if (data.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return existing
}

function chunk(array, size) {
  const chunks = []
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size))
  return chunks
}

async function applyUpsert(client, rows) {
  for (const batch of chunk(rows, UPSERT_CHUNK_SIZE)) {
    const { error } = await client.from('exercise_catalog').upsert(batch, { onConflict: 'provider,provider_exercise_id' })
    if (error) throw new Error(`UPSERT_FAILED: ${error.message}`)
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { apply } = parseArgs(argv)
  const rawExercises = await loadSource()

  const supabaseUrl = process.env.SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente (nunca commitados).')
  }
  const client = createClient(supabaseUrl, serviceRoleKey)

  const existing = await loadExisting(client)
  const { toUpsert, report } = buildImportPlan(rawExercises, existing)

  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', ...report }, null, 2))

  if (apply) {
    await applyUpsert(client, toUpsert)
    console.log(`Gravação concluída: ${report.inserts} inseridos, ${report.updates} atualizados, ${report.unchanged} sem alteração.`)
  } else {
    console.log('Dry-run: nenhuma gravação foi feita. Rode novamente com --apply para gravar.')
  }
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  await main()
}
