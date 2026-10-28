import { waitReady } from './wait-ready.mjs'
import { pullImage } from './images.mjs'
// Isolated local Supabase services only. No linked-project CLI or remote credentials.
import { execFileSync } from 'node:child_process'
import { prepareRuntime, runtime } from './prepare-runtime.mjs'
import { resolve } from 'node:path'
import { SECRET, jwt } from '../keys.mjs'
const action = process.argv[2]
const root = resolve(import.meta.dirname, '../../..')
if (process.env.FINANCE_STACK_SCOPE && !['release', 'integrated'].includes(process.env.FINANCE_STACK_SCOPE)) throw Error('Local stack scope required')
const prefix = process.env.FINANCE_STACK_SCOPE === 'release' ? 'evolutus_release_ci_' : 'evolutus_integrated_'
const db = prefix + 'db'
const localPassword = 'integrated-local-synthetic-password'
const run = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const ready = async (check) => {
  for (let i = 0; i < 120; i++) { try { if (check()) return } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)) }
  throw new Error('Local service readiness timeout')
}

const names = ['edge', 'rest', 'storage', 'auth', 'db'].map(n => prefix+n)
if (action === 'stop') {
  for (const name of names) { try { run('stop', name) } catch { /* absent */ } }
  process.exit(0)
}
if (action === 'resume') {
  prepareRuntime()
  run('start',db) // containers já existentes (parados): nenhum pull acontece aqui.
  await ready(()=>run('exec',db,'pg_isready','-h','127.0.0.1','-U','supabase_admin').includes('accepting'))
  for (const name of names.filter(n=>n!==db)) run('start',name)
  await waitReady()
  console.log('Local stack resumed')
  process.exit(0)
}
if (action !== 'start') throw new Error('Use start, resume or stop')
for (const name of names) {
  try { run('inspect', name); throw new Error(`Refusing to overwrite ${name}`) }
  catch (e) { if (e.message.startsWith('Refusing')) throw e }
}
// Loopback only, distinct from the user's Vite 5173 and existing test containers.
const ports = ['55451:3000','55452:9999','55453:5000','55454:9000','55455:8000']
const postgresImage = await pullImage('postgres')
run('run','--pull=never','-d','--name',db,'--cpus','0.7','--memory','900m','--memory-swap','1800m',
  ...ports.flatMap(p=>['-p','127.0.0.1:'+p]),'-v',root+':/workspace:ro',
  '-e','POSTGRES_PASSWORD='+localPassword,postgresImage)
await ready(()=>run('exec',db,'pg_isready','-h','127.0.0.1','-U','supabase_admin','-d','postgres').includes('accepting'))
run('exec',db,'psql','-U','supabase_admin','-d','postgres','-X','-v','ON_ERROR_STOP=1',
  '-c','alter system set cron.launch_active_jobs=off','-c','select pg_reload_conf()',
  '-c','create extension if not exists pg_cron; create extension if not exists pgtap with schema extensions;')
const network = ['--network','container:'+db]
const anon = jwt({ role: 'anon' })
const service = jwt({ role: 'service_role' })
const start = async (name, imageKey, env, extra=[], command=[]) => {
  const image = await pullImage(imageKey)
  return run('run','--pull=never','-d','--name',prefix+name,...network,
    '--cpus','0.25','--memory',name==='edge'?'450m':'240m','--memory-swap','600m',
    ...Object.entries(env).flatMap(([k,v])=>['-e',k+'='+v]),...extra,image,...command)
}
await start('auth','gotrue',{
 GOTRUE_API_HOST:'0.0.0.0',GOTRUE_API_PORT:'9999',API_EXTERNAL_URL:'http://127.0.0.1:55454',
 GOTRUE_DB_DRIVER:'postgres',GOTRUE_DB_DATABASE_URL:`postgres://supabase_auth_admin:${localPassword}@127.0.0.1:5432/postgres`,
 GOTRUE_SITE_URL:'http://127.0.0.1:55454',GOTRUE_JWT_SECRET:SECRET,GOTRUE_JWT_EXP:'3600',GOTRUE_JWT_DEFAULT_GROUP_NAME:'authenticated',
 GOTRUE_DISABLE_SIGNUP:'false',GOTRUE_EXTERNAL_EMAIL_ENABLED:'true',GOTRUE_MAILER_AUTOCONFIRM:'true',
 GOTRUE_SMTP_HOST:'127.0.0.1',GOTRUE_SMTP_PORT:'2500',GOTRUE_SMTP_ADMIN_EMAIL:'test@example.invalid',
 GOTRUE_RATE_LIMIT_EMAIL_SENT:'1000',GOTRUE_RATE_LIMIT_TOKEN_REFRESH:'1000',GOTRUE_RATE_LIMIT_VERIFY:'1000',
})
await start('storage','storageApi',{
 ANON_KEY:anon,SERVICE_KEY:service,AUTH_JWT_SECRET:SECRET,PGRST_JWT_SECRET:SECRET,
 DATABASE_URL:`postgres://supabase_storage_admin:${localPassword}@127.0.0.1:5432/postgres`,
 DB_INSTALL_ROLES:'false',FILE_SIZE_LIMIT:'52428800',STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',
 TENANT_ID:'local',REGION:'local',GLOBAL_S3_BUCKET:'local',SERVER_PORT:'5000',ENABLE_IMAGE_TRANSFORMATION:'false',
})
await ready(()=>run('exec',db,'psql','-U','supabase_admin','-d','postgres','-X','-tAc',
 "select to_regclass('auth.sessions') is not null and exists(select 1 from information_schema.columns where table_schema='storage' and table_name='objects' and column_name='metadata');")==='t')
await start('rest','postgrest',{
 PGRST_DB_URI:`postgres://authenticator:${localPassword}@127.0.0.1:5432/postgres`,PGRST_DB_SCHEMAS:'public',PGRST_DB_ANON_ROLE:'anon',
 PGRST_JWT_SECRET:SECRET,PGRST_SERVER_PORT:'3000',PGRST_DB_EXTRA_SEARCH_PATH:'public,extensions',
})
// Test router installs an outbound-provider interceptor only in disposable workers.
// Production functions and their hardcoded InfinitePay endpoints remain unchanged.
const work = runtime
prepareRuntime()
await start('edge','edgeRuntime',{
 JWT_SECRET:SECRET,SUPABASE_URL:'https://local-supabase.invalid',SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,
 INFINITEPAY_HANDLE:'local-fixture',INFINITEPAY_API_KEY:'local-synthetic-test-key',INFINITEPAY_CHECKOUT_ENABLED:'true',APP_PUBLIC_URL:'https://local-fixture.invalid',
},['-v',root+'/supabase/functions:/home/deno/functions:ro','-v',root+'/scripts/homolog/finance:/home/deno/main:ro',
 '-v',work+':/home/deno/wrappers:ro'],['start','--main-service','/home/deno/main','-p','9000'])

await waitReady()
console.log('Local PostgreSQL/Auth/Storage/PostgREST/Edge: http://127.0.0.1:55454')
