// Fresh application schema on a new local Postgres. Auth/Storage service DDL
// comes from migrated service schemas, excluding application policies/triggers/data.
import { execFileSync } from 'node:child_process'
import { writeFileSync, readdirSync } from 'node:fs'
const name =
  'evolutus_consolidation_clean_' + new Date().toISOString().replace(/\D/g, '').slice(0, 14)
const evidence = 'docs/finance-restructure/consolidation/evidence'
const run = (args, input) =>
  execFileSync('docker', args, { input, encoding: 'utf8', maxBuffer: 32e6 })
try {
  run(['inspect', name])
  throw Error('EXISTING_CONTAINER_WILL_NOT_BE_OVERWRITTEN')
} catch (error) {
  if (error.message === 'EXISTING_CONTAINER_WILL_NOT_BE_OVERWRITTEN') throw error
}
const image = run(['inspect', '--format', '{{.Config.Image}}', 'evolutus_price_phase1_db']).trim()
if (!/^(sha256:[a-f0-9]{64}$|public.ecr.aws\/supabase\/postgres:|supabase\/postgres:)/.test(image))
  throw Error('LOCAL_SUPABASE_IMAGE_REQUIRED')
run([
  'run',
  '-d',
  '--name',
  name,
  '--cpus',
  '1',
  '--memory',
  '1200m',
  '-e',
  'POSTGRES_PASSWORD=local-consolidation-synthetic-only',
  image,
])
const sql = (input) =>
  run(
    [
      'exec',
      '-i',
      name,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    input
  )
try {
  let ready = false
  for (let i = 0; i < 90; i++) {
    try {
      run(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'supabase_admin'])
      ready = true
      break
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  if (!ready) throw Error('CLEAN_DATABASE_NOT_READY')
  sql('alter system set cron.launch_active_jobs=off; select pg_reload_conf();')
  const serviceSchema = run([
    'exec',
    'evolutus_price_phase1_db',
    'pg_dump',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '--schema=auth',
    '--schema=storage',
    '--section=pre-data',
    '--no-owner',
    '--no-privileges',
  ])
  // Only this newly created empty container: replace the image's service stubs.
  sql('drop schema if exists auth cascade; drop schema if exists storage cascade;')
  sql(serviceSchema)
  // Service PK/FK/indexes are post-data. Application policies/triggers are
  // installed exclusively by this repository's migrations below.
  const serviceConstraints = run([
    'exec',
    'evolutus_price_phase1_db',
    'pg_dump',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '--schema=auth',
    '--schema=storage',
    '--section=post-data',
    '--no-owner',
    '--no-privileges',
  ])
    .replace(/^CREATE POLICY[\s\S]*?;\n/gm, '')
    .replace(/^CREATE TRIGGER[\s\S]*?;\n/gm, '')
  sql(serviceConstraints)
  execFileSync(process.execPath, ['scripts/homolog/finance/migrate.mjs', 'all', name], {
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 8e6,
  })
  const versions = sql('select count(*) from supabase_migrations.schema_migrations;')
  const safe = sql(
    "do $$begin if exists(select 1 from public.commercial_offerings where sales_enabled) or exists(select 1 from public.advertising_placements where capacity<>0 or sales_enabled or delivery_enabled) or exists(select 1 from public.commercial_price_versions) or exists(select 1 from public.evocash_price_versions) or exists(select 1 from public.sponsored_ad_metrics_settings where collection_enabled) then raise exception 'UNSAFE_COMMERCIAL_DEFAULTS';end if;end$$;"
  )
  const registered = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql')).length
  writeFileSync(
    evidence + '/clean-install.json',
    JSON.stringify(
      {
        passed: true,
        localOnly: true,
        container: name,
        serviceBootstrap:
          'Auth/Storage service DDL excluding policies/triggers; no public/private schema or data imported',
        migrations: registered,
        versionsOutput: versions,
        defaultsOutput: safe,
      },
      null,
      2
    ) + '\n'
  )
  console.log('CLEAN_INSTALL_AND_DISABLED_DEFAULTS_PASS', registered)
} catch (error) {
  writeFileSync(evidence + '/clean-install-error.log', String(error.stderr || error.stack))
  throw error
} finally {
  // Preserve the isolated container for schema comparison; never delete a database.
  run(['stop', name])
}
