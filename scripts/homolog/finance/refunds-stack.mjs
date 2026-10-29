// Reproducible local-only bootstrap. No project linking, hosted DB or provider URL.
import { execFileSync } from 'node:child_process'
import { pullImage } from './images.mjs'
import { SECRET, jwt } from '../keys.mjs'
const action = process.argv[2],
  db = 'evolutus_refunds_db',
  password = 'refunds-local-synthetic-only'
const names = ['evolutus_refunds_auth', 'evolutus_refunds_storage', 'evolutus_refunds_rest', db]
const docker = (...args) =>
  execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
if (action === 'stop') {
  for (const name of names) docker('stop', name)
  process.exit(0)
}
if (action === 'status') {
  console.log(
    docker('ps', '--filter', 'name=evolutus_refunds_', '--format', '{{.Names}} {{.Status}}')
  )
  process.exit(0)
}
if (!['start', 'resume'].includes(action)) throw Error('USE_START_RESUME_STOP_OR_STATUS')
async function wait(check) {
  for (let i = 0; i < 100; i++) {
    try {
      if (check()) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw Error('LOCAL_SERVICE_NOT_READY')
}
if (action === 'start') {
  for (const name of names) {
    try {
      docker('inspect', name)
      throw Error('REFUSE_EXISTING_CONTAINER ' + name)
    } catch (error) {
      if (error.message.startsWith('REFUSE_EXISTING_CONTAINER')) throw error
    }
  }
  const image = await pullImage('postgres')
  docker(
    'run',
    '--pull=never',
    '-d',
    '--name',
    db,
    '--cpus',
    '1',
    '--memory',
    '1200m',
    '-e',
    'POSTGRES_PASSWORD=' + password,
    '-p',
    '127.0.0.1:55651:3000',
    '-p',
    '127.0.0.1:55652:9999',
    image
  )
} else docker('start', db)
await wait(() =>
  docker(
    'exec',
    db,
    'pg_isready',
    '-h',
    '127.0.0.1',
    '-U',
    'supabase_admin',
    '-d',
    'postgres'
  ).includes('accepting')
)
docker(
  'exec',
  db,
  'psql',
  '-U',
  'supabase_admin',
  '-d',
  'postgres',
  '-c',
  'alter system set cron.launch_active_jobs=off',
  '-c',
  'select pg_reload_conf()'
)
const envs = {
  auth: {
    GOTRUE_API_HOST: '0.0.0.0',
    GOTRUE_API_PORT: '9999',
    API_EXTERNAL_URL: 'http://127.0.0.1:55652',
    GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${password}@127.0.0.1:5432/postgres`,
    GOTRUE_SITE_URL: 'http://127.0.0.1:5174',
    GOTRUE_JWT_SECRET: SECRET,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
    GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_SMTP_HOST: '127.0.0.1',
    GOTRUE_SMTP_PORT: '2500',
    GOTRUE_SMTP_ADMIN_EMAIL: 'test@example.invalid',
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000',
  },
  storage: {
    ANON_KEY: jwt({ role: 'anon' }),
    SERVICE_KEY: jwt({ role: 'service_role' }),
    AUTH_JWT_SECRET: SECRET,
    PGRST_JWT_SECRET: SECRET,
    DATABASE_URL: `postgres://supabase_storage_admin:${password}@127.0.0.1:5432/postgres`,
    DB_INSTALL_ROLES: 'false',
    FILE_SIZE_LIMIT: '52428800',
    STORAGE_BACKEND: 'file',
    FILE_STORAGE_BACKEND_PATH: '/var/lib/storage',
    TENANT_ID: 'local',
    REGION: 'local',
    GLOBAL_S3_BUCKET: 'local',
    SERVER_PORT: '5000',
    ENABLE_IMAGE_TRANSFORMATION: 'false',
  },
  rest: {
    PGRST_DB_URI: `postgres://authenticator:${password}@127.0.0.1:5432/postgres`,
    PGRST_DB_SCHEMAS: 'public',
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_JWT_SECRET: SECRET,
    PGRST_SERVER_PORT: '3000',
    PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
  },
}
const images = { auth: 'gotrue', storage: 'storageApi', rest: 'postgrest' }
for (const [service, key] of Object.entries(images)) {
  const name = 'evolutus_refunds_' + service
  if (action === 'resume') docker('start', name)
  else {
    const image = await pullImage(key)
    docker(
      'run',
      '--pull=never',
      '-d',
      '--name',
      name,
      '--network',
      'container:' + db,
      '--memory',
      '260m',
      ...Object.entries(envs[service]).flatMap(([k, v]) => ['-e', k + '=' + v]),
      image
    )
  }
}
await wait(
  () =>
    docker(
      'exec',
      db,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-tAc',
      "select to_regclass('auth.sessions') is not null and to_regclass('storage.buckets') is not null"
    ) === 't'
)
console.log(
  'Disposable refund stack ready. Install migrations, seed, then start Vite 5174. No external provider connection is configured.'
)
