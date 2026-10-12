// Ensaio exclusivamente local. Requer container evolutus_aud_cli_db na porta 55435,
// Auth/Storage sintéticos e baseline aplicada pela CLI (sem journal criado manualmente).
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const version = '20261026000005'
const name = `${version}_aud_security_atomic.sql`
const root = mkdtempSync(join(tmpdir(), 'aud-cli-history-'))
const dir = join(root, 'supabase', 'migrations')
mkdirSync(dir, { recursive: true })
copyFileSync('supabase/config.toml', join(root, 'supabase', 'config.toml'))
const baseline = readdirSync('supabase/migrations').filter(f => f.endsWith('.sql') && f < '20261026000001').sort()
for (const file of baseline) copyFileSync(join('supabase/migrations', file), join(dir, file))
const offlineSource = '20261025000001_exercise_catalog_offline_sync.sql'
copyFileSync(join('supabase/migration_sources/exercise_catalog_offline', offlineSource), join(dir, offlineSource))
baseline.push(offlineSource)
const sql = source => execFileSync('docker', ['exec', '-i', 'evolutus_aud_cli_db', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], { input: source, encoding: 'utf8' }).trim()
let checks = 0
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log(`PASS ${label}`) }
check(sql('select count(*) from supabase_migrations.schema_migrations;') === String(baseline.length), 'baseline completa registrada pela CLI')
check(sql("select count(*) from supabase_migrations.schema_migrations where version >= '20261026000001';") === '0', 'nenhuma versão AUD previamente aplicada neste ensaio')
check(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='statuses_initialize_identity';") === '0', 'schema anterior sem initializer AUD')
execFileSync('node', ['scripts/build-aud-migration-batch.mjs', join(dir, name), '--cli'], { stdio: 'pipe' })
const source = readFileSync(join(dir, name), 'utf8')
check(!/^BEGIN;|^COMMIT;|insert into supabase_migrations/im.test(source), 'transação e journal delegados à CLI')
const run = label => {
  const result = spawnSync('node_modules/.bin/supabase', ['migration', 'up', '--db-url', 'postgres://supabase_admin:local-aud-synthetic-password@127.0.0.1:55435/postgres?sslmode=disable', '--workdir', root], { encoding: 'utf8' })
  writeFileSync(join(root, `${label}.log`), (result.stdout || '') + (result.stderr || ''))
  return result
}
// Falha deliberada DEPOIS das quatro fontes: prova rollback real de DDL e do journal.
writeFileSync(join(dir, name), source + '\nselect 1/0; -- falha local injetada\n')
check(run('failure').status !== 0, 'CLI rejeita falha no fim do pacote')
check(sql(`select count(*) from supabase_migrations.schema_migrations where version='${version}';`) === '0', 'falha não registra versão')
check(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('statuses_initialize_identity','communities_guard_promotion_fields');") === '0', 'falha reverte os dois guards')
check(sql("select has_function_privilege('authenticated','public.delete_own_account()','EXECUTE');") === 't', 'falha reverte revogação de exclusão também')
writeFileSync(join(dir, name), source)
check(run('success').status === 0, 'CLI aplica migration consolidada válida')
check(sql('select count(*) from supabase_migrations.schema_migrations;') === String(baseline.length + 1), 'exatamente uma versão acrescentada à baseline')
check(sql(`select name='aud_security_atomic' and cardinality(statements)>0 from supabase_migrations.schema_migrations where version='${version}';`) === 't', 'journal real contém nome e statements da release')
check(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname in ('statuses_initialize_identity','communities_guard_promotion_fields');") === '2', 'DDL dos guards confirmado depois do commit')
check(sql("select has_function_privilege('authenticated','public.delete_own_account()','EXECUTE');") === 'f', 'exclusão legada revogada depois do commit')
const again = run('again')
check(again.status === 0 && !`${again.stdout}${again.stderr}`.includes('Applying migration'), 'segunda chamada não reexecuta nenhuma migration')
check(sql('select count(*) from supabase_migrations.schema_migrations;') === String(baseline.length + 1), 'histórico continua sem duplicação')
console.log(`RESULT ${checks} verificações CLI reais aprovadas; baseline ${baseline.length} + uma release consolidada.`)
console.log(`Artefato e logs locais: ${root}; não é autorização para publicar nem alterar o inventário remoto.`)
