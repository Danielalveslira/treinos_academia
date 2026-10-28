import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
const evidence = 'docs/finance-restructure/consolidation/evidence'
mkdirSync(evidence, { recursive: true })
// Fixed disposable allowlist: no credentials or remote connection arguments.
const output = execFileSync(
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
    '-XtA',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: readFileSync('scripts/homolog/finance/consolidation-readonly.sql'), encoding: 'utf8' }
)
const rows = output
  .split('\n')
  .filter((line) => line.startsWith('{'))
  .map((line) => JSON.parse(line))
if (rows.length !== 2) throw Error('AUDIT_RESULT_MISSING')
const migrations = readdirSync('supabase/migrations')
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => {
    const source = readFileSync('supabase/migrations/' + name, 'utf8')
    return {
      name,
      sha256: createHash('sha256').update(source).digest('hex'),
      registered: rows[1].registered_versions.includes(name.split('_')[0]),
      functions: [
        ...source.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi),
      ].map((m) => m[1]),
    }
  })
writeFileSync(
  evidence + '/readonly-audit.json',
  JSON.stringify(
    {
      localOnly: true,
      capturedAt: new Date().toISOString(),
      integrity: rows[0],
      schema: rows[1],
      migrations,
    },
    null,
    2
  ) + '\n'
)
console.log(JSON.stringify(rows[0], null, 2))

const failed = Object.entries(rows[0])
  .filter(([key, value]) =>
    key.endsWith('_enabled') || key.includes('_authenticated') || key.endsWith('_service_role')
      ? value !== false
      : value !== 0
  )
  .map(([key]) => key)
if (failed.length) throw Error('INTEGRITY_GATE_FAILED: ' + failed.join(', '))
if (rows[1].domain_tables_without_rls.length || rows[1].definers_without_fixed_search_path.length)
  throw Error('SCHEMA_SECURITY_GATE_FAILED')
