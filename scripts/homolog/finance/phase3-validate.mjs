// Fixed disposable Docker stack only. Never accepts a remote database URL.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
const root = resolve(import.meta.dirname, '../../..')
const container = 'evolutus_price_phase1_db'
const evidence = root + '/docs/finance-restructure/phase3/evidence'
mkdirSync(evidence, { recursive: true })
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', maxBuffer: 8e6 })
const sql = (source) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8', maxBuffer: 8e6 }
  )
assert.match(
  docker('inspect', '--format', '{{.Config.Image}}', container),
  /supabase\/postgres:|sha256:b3bfedb107413abb3b8cb0d0874b0414a1dceb3d55bc0c778de6ad22d1f7dc86/
)
const migration = readFileSync(
  root + '/supabase/migrations/20261130000001_commercial_engine.sql',
  'utf8'
)
const functions = [...migration.matchAll(/create function [\s\S]*?\$\$[\s\S]*?\$\$;/g)].map(
  (x) => x[0]
)
assert.equal(functions.length, 14)
// Rebuild this migration transactionally on the Phase 2 boundary. All removals roll back,
// including synthetic fixtures, so no persisted financial history is deleted.
const removeFunctions = functions.map((f) => f.match(/^create function ([^(]+)/)[1])
const drops = `do $$declare r record;begin for r in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname||'.'||p.proname)=any(array[${removeFunctions.map((n) => "'" + n + "'").join(',')}]) loop execute 'drop function '||r.signature||' cascade';end loop;end$$;`
const install = sql(`begin;${drops}
drop table public.commercial_order_events,public.visibility_entitlements,public.commercial_orders,private.commercial_resources,public.commercial_price_versions,public.commercial_offerings cascade;
${migration}
do $$begin if (select count(*) from public.commercial_offerings)<>8 or exists(select 1 from public.commercial_price_versions) or exists(select 1 from public.commercial_offerings where sales_enabled or integration_ready) then raise exception 'UNSAFE_MIGRATION_DEFAULTS';end if;end$$;
rollback;`)
writeFileSync(evidence + '/migration-install.log', install)
// Resume the partially installed local work with the exact final function definitions.
// Definitions preserve existing ACLs with CREATE OR REPLACE; migration grants are tested below.
sql(
  'begin;' +
    functions.map((f) => f.replace('create function ', 'create or replace function ')).join('\n') +
    "\ninsert into supabase_migrations.schema_migrations(version,name) values('20261130000001','commercial_engine') on conflict(version) do nothing;commit;"
)
docker('cp', root + '/supabase/tests/.', container + ':/tmp/commercial-phase3-tests')
const suites = [
  'commercial_engine_test.sql',
  'evocash_pricing_test.sql',
  'infinitepay_cash_purchases_test.sql',
  'finance_integrity_test.sql',
  'finance_reversals_test.sql',
]
const results = []
for (const name of suites) {
  const log = docker(
    'exec',
    container,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    '/tmp/commercial-phase3-tests/' + name
  )
  writeFileSync(evidence + '/' + name.replace('.sql', '.log'), log)
  assert.doesNotMatch(log, /^not ok\b/m, name)
  const count = [...log.matchAll(/^ok \d+\b/gm)].length
  const plans = [...log.matchAll(/^1\.\.(\d+)$/gm)]
  assert.equal(plans.length, 1, name + ': one TAP plan')
  assert.equal(count, Number(plans[0][1]), name + ': full TAP plan')
  results.push({ name, assertions: count, passed: true })
}
const performance = docker(
  'exec',
  container,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-X',
  '-v',
  'ON_ERROR_STOP=1',
  '-f',
  '/tmp/commercial-phase3-tests/commercial_engine_performance.sql'
)
writeFileSync(evidence + '/performance.log', performance)
writeFileSync(
  evidence + '/sql-summary.json',
  JSON.stringify(
    {
      localOnly: true,
      migrationReinstalledWithRollback: true,
      noLivePricesSeeded: true,
      suites: results,
    },
    null,
    2
  ) + '\n'
)
console.log(JSON.stringify(results))
