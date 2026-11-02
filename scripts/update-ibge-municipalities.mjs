#!/usr/bin/env node
// Atualiza o catálogo de municípios a partir da API oficial do IBGE -- rotina de manutenção
// EXPLÍCITA (nunca roda no build, no deploy nem no cadastro). Procedimento completo em
// docs/CADASTRO_CIDADE_IBGE.md.
//
//   node scripts/update-ibge-municipalities.mjs                 # baixa, valida e mostra o diff (não grava)
//   node scripts/update-ibge-municipalities.mjs --write         # grava src/data/ibgeMunicipalities.js
//   node scripts/update-ibge-municipalities.mjs --write --migration
//        # idem + cria supabase/migrations/<timestamp>_ibge_municipalities_refresh.sql (upsert do servidor)
//   --from <dir>        usa <dir>/municipios.json e <dir>/estados.json em vez da rede
//   --allow-removals    aceita códigos que sumiram da resposta (exige revisão manual -- ver doc)
//   --version AAAA-MM-DD  versão gravada no catálogo (padrão: data de hoje, UTC)
//
// Falha = nada é gravado: toda validação roda antes, e a escrita é atômica (arquivo temporário +
// rename), então o catálogo anterior continua intacto.
import { readFile, rename, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  diffCatalogs,
  IbgeCatalogError,
  MAX_REMOVALS_WITHOUT_FLAG,
  normalizeMunicipalities,
  renderFrontendCatalog,
  renderSqlUpsert,
  rowsFromFrontendModule,
} from './ibge-municipalities-core.mjs'

const API = 'https://servicodados.ibge.gov.br/api/v1/localidades'
const FRONTEND_CATALOG = 'src/data/ibgeMunicipalities.js'
const MIGRATIONS_DIR = 'supabase/migrations'

function parseArgs(argv) {
  const args = { write: false, migration: false, allowRemovals: false, from: null, version: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--write') args.write = true
    else if (arg === '--migration') args.migration = true
    else if (arg === '--allow-removals') args.allowRemovals = true
    else if (arg === '--from') args.from = argv[++i]
    else if (arg === '--version') args.version = argv[++i]
    else throw new Error(`Argumento desconhecido: ${arg}`)
  }
  if (args.migration && !args.write) throw new Error('--migration exige --write')
  return args
}

async function fetchJson(url, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(60_000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, 1500 * attempt))
    }
  }
  throw new Error(`Falha ao baixar ${url}: ${lastError?.message}`)
}

async function loadSource(from) {
  if (from) {
    const dir = resolve(from)
    const read = async (name) => JSON.parse(await readFile(join(dir, name), 'utf8'))
    return { municipios: await read('municipios.json'), estados: await read('estados.json') }
  }
  const [municipios, estados] = await Promise.all([
    fetchJson(`${API}/municipios`),
    fetchJson(`${API}/estados`),
  ])
  return { municipios, estados }
}

async function writeAtomic(path, content) {
  const temporary = `${path}.tmp-${process.pid}`
  await writeFile(temporary, content, 'utf8')
  await rename(temporary, path)
}

function migrationTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(
    date.getUTCHours()
  )}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const version = args.version || new Date().toISOString().slice(0, 10)
  const source = await loadSource(args.from)
  const catalog = normalizeMunicipalities(source.municipios, source.estados)

  let previousRows = []
  if (existsSync(FRONTEND_CATALOG)) {
    const previous = await import(pathToFileURL(resolve(FRONTEND_CATALOG)).href)
    previousRows = rowsFromFrontendModule(previous)
  }
  const diff = diffCatalogs(previousRows, catalog.rows)
  console.log(
    JSON.stringify(
      {
        version,
        municipalities: catalog.rows.length,
        ufs: Object.keys(catalog.ufs).length,
        added: diff.added.length,
        changed: diff.changed.map((row) => `${row.code} ${row.name}/${row.uf}`),
        removed: diff.removed.map((row) => `${row.code} ${row.name}/${row.uf}`),
      },
      null,
      2
    )
  )
  if (previousRows.length && diff.removed.length > MAX_REMOVALS_WITHOUT_FLAG && !args.allowRemovals) {
    throw new Error(
      `${diff.removed.length} código(s) sumiram da resposta do IBGE. Revise (docs/CADASTRO_CIDADE_IBGE.md) e use --allow-removals se for uma mudança real. Nada foi gravado.`
    )
  }
  if (!args.write) {
    console.log('Validação concluída. Nada gravado (use --write).')
    return
  }
  if (previousRows.length && !diff.added.length && !diff.changed.length && !diff.removed.length) {
    console.log('Catálogo já está atualizado. Nada gravado.')
    return
  }

  await writeAtomic(FRONTEND_CATALOG, renderFrontendCatalog(catalog, version))
  console.log(`Gravado ${FRONTEND_CATALOG}`)
  if (args.migration) {
    const path = join(MIGRATIONS_DIR, `${migrationTimestamp()}_ibge_municipalities_refresh.sql`)
    await writeAtomic(path, renderSqlUpsert(catalog, version))
    console.log(`Gravado ${path} (aplicar com o procedimento de migrations do projeto).`)
  } else {
    console.warn(
      'ATENÇÃO: o catálogo do servidor (public.ibge_municipalities) não foi atualizado. Gere a migration com --migration para manter os dois iguais.'
    )
  }
}

main().catch((error) => {
  console.error(error instanceof IbgeCatalogError ? error.message : `Erro: ${error.message}`)
  process.exitCode = 1
})
