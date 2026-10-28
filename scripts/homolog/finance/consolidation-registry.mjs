// Repair metadata only in the fixed disposable preview, after fresh schema parity
// and financial diagnostics. Never replay SQL over manually installed objects.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
const evidence = 'docs/finance-restructure/consolidation/evidence'
execFileSync(process.execPath, ['scripts/check-migration-integrity.mjs'], { stdio: 'inherit' })
execFileSync(process.execPath, ['scripts/homolog/finance/consolidation-schema.mjs'], {
  stdio: 'inherit',
})
execFileSync(process.execPath, ['scripts/homolog/finance/consolidation-audit.mjs'], {
  stdio: 'inherit',
})
const audit = JSON.parse(readFileSync(evidence + '/readonly-audit.json'))
const missing = audit.migrations.filter((m) => !m.registered)
if (!missing.length) {
  console.log('LOCAL_REGISTRY_ALREADY_CURRENT')
  process.exit(0)
}
if (missing.some((m) => !/^2026120[56][0-9]{6}_/.test(m.name)))
  throw Error('UNEXPECTED_BASELINE_DRIFT')
copyFileSync(evidence + '/readonly-audit.json', evidence + '/readonly-before-registry.json')
const records = missing.map((m) => {
  const source = readFileSync('supabase/migrations/' + m.name, 'utf8')
  if (createHash('sha256').update(source).digest('hex') !== m.sha256)
    throw Error('SOURCE_CHANGED_DURING_REPAIR')
  const delimiter = '$registry_' + m.sha256.slice(0, 12) + '$'
  if (source.includes(delimiter)) throw Error('INVALID_DELIMITER')
  return `insert into supabase_migrations.schema_migrations(version,name,statements) values('${m.name.slice(0, 14)}','${m.name}',array[${delimiter}${source}${delimiter}]) on conflict(version) do nothing;`
})
execFileSync(
  'docker',
  [
    'exec',
    '-i',
    'evolutus_price_phase1_db',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  {
    input:
      "begin;set local lock_timeout='5s';lock table supabase_migrations.schema_migrations in exclusive mode;" +
      records.join('\n') +
      '\ncommit;',
    stdio: ['pipe', 'ignore', 'inherit'],
  }
)
execFileSync(process.execPath, ['scripts/homolog/finance/consolidation-audit.mjs'], {
  stdio: 'inherit',
})
const final = JSON.parse(readFileSync(evidence + '/readonly-audit.json'))
if (final.migrations.some((m) => !m.registered)) throw Error('REGISTRY_REPAIR_INCOMPLETE')
if (JSON.stringify(final.integrity) !== JSON.stringify(audit.integrity))
  throw Error('FINANCIAL_DIAGNOSTICS_CHANGED')
writeFileSync(
  evidence + '/registry-repair.json',
  JSON.stringify(
    {
      localOnly: true,
      container: 'evolutus_price_phase1_db',
      registered: missing.map(({ name, sha256 }) => ({ name, sha256 })),
      missingAfter: 0,
      sqlReplayed: false,
      financialDiagnosticsUnchanged: true,
    },
    null,
    2
  ) + '\n'
)
console.log('LOCAL_REGISTRY_REPAIRED', missing.length)
