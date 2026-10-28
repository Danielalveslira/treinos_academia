// Official Realtime, restricted to the existing disposable Docker stack and loopback.
// Configuration follows Supabase's official docker/docker-compose.yml (v2.143.3).
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { SECRET } from '../keys.mjs'
const db = JSON.parse(
  execFileSync('docker', ['inspect', 'evolutus_price_phase1_db'], { encoding: 'utf8' })
)[0]
const image = 'supabase/realtime:v2.143.3'
const env = {
  PORT: '4000',
  DB_HOST: db.NetworkSettings.IPAddress || Object.values(db.NetworkSettings.Networks)[0].IPAddress,
  DB_PORT: '5432',
  DB_USER: 'supabase_admin',
  DB_PASSWORD:
    db.Config.Env.find((e) => e.startsWith('POSTGRES_PASSWORD='))
      ?.split('=')
      .slice(1)
      .join('=') || 'postgres',
  DB_NAME: 'postgres',
  DB_AFTER_CONNECT_QUERY: 'SET search_path TO _realtime',
  DB_ENC_KEY: 'supabaserealtime',
  API_JWT_SECRET: SECRET,
  METRICS_JWT_SECRET: SECRET,
  SECRET_KEY_BASE: randomBytes(64).toString('hex'),
  ERL_AFLAGS: '-proto_dist inet_tcp',
  ERL_FLAGS: '+S 2:2',
  DNS_NODES: "''",
  RLIMIT_NOFILE: '10000',
  APP_NAME: 'realtime',
  SEED_SELF_HOST: 'true',
  RUN_JANITOR: 'true',
  DISABLE_HEALTHCHECK_LOGGING: 'true',
}
writeFileSync(
  '.finance-local/phase6-realtime.env',
  Object.entries(env)
    .map(([k, v]) => k + '=' + v)
    .join('\n'),
  { mode: 0o600 }
)
execFileSync(
  'docker',
  [
    'exec',
    'evolutus_price_phase1_db',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    "create schema if not exists _realtime authorization supabase_admin;do $$begin if not exists(select 1 from pg_publication where pubname='supabase_realtime')then create publication supabase_realtime;end if;if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='advertising_delivery_epoch')then alter publication supabase_realtime add table public.advertising_delivery_epoch;end if;end$$;",
  ],
  { stdio: 'ignore' }
)
let exists = false
try {
  execFileSync('docker', ['inspect', 'evolutus_phase6_realtime'], { stdio: 'ignore' })
  exists = true
} catch {}
if (exists) execFileSync('docker', ['start', 'evolutus_phase6_realtime'], { stdio: 'ignore' })
else
  execFileSync(
    'docker',
    [
      'run',
      '-d',
      '--name',
      'evolutus_phase6_realtime',
      '--memory',
      '512m',
      '-p',
      '127.0.0.1:55556:4000',
      '--env-file',
      '.finance-local/phase6-realtime.env',
      image,
    ],
    { stdio: 'ignore' }
  )
const info = JSON.parse(
  execFileSync('docker', ['image', 'inspect', image], { encoding: 'utf8' })
)[0]
writeFileSync(
  'docs/finance-restructure/phase6/evidence/realtime-image.json',
  JSON.stringify(
    {
      officialImage: image,
      digest: info.RepoDigests,
      loopbackOnly: true,
      reference: 'https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml',
    },
    null,
    2
  ) + '\n'
)
console.log('Official local Realtime started on loopback:55556; no remote database used')
