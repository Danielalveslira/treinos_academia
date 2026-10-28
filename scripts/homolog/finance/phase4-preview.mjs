// Rebuild the local preview after /tmp reset. Existing isolated Phase 1/2 database only.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { prepareRuntime } from './prepare-runtime.mjs'
import { SECRET, jwt } from '../keys.mjs'
const root = resolve(import.meta.dirname, '../../..')
const run = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
const db = 'evolutus_price_phase1_db',
  edge = 'evolutus_storefront_phase4_edge'
run('start', db)
for (let i = 0; i < 40; i++) {
  try {
    run('exec', db, 'pg_isready', '-U', 'supabase_admin')
    break
  } catch {
    await new Promise((r) => setTimeout(r, 300))
  }
}
for (const name of ['auth', 'rest', 'storage']) run('restart', 'evolutus_price_phase1_' + name)
const runtime = prepareRuntime()
const anon = jwt({ role: 'anon' }),
  service = jwt({ role: 'service_role' })
const image = 'sha256:645d0e45446181f3e9d87efeef637b494615f32365befff00e2d2b0fe8535fef'
let exists = false
try {
  run('inspect', edge)
  exists = true
} catch {
  /* first run */
}
if (exists) run('restart', edge)
else
  run(
    'run',
    '--pull=never',
    '-d',
    '--name',
    edge,
    '--network',
    'container:' + db,
    '--memory',
    '450m',
    ...Object.entries({
      JWT_SECRET: SECRET,
      SUPABASE_URL: 'http://127.0.0.1:9000',
      SUPABASE_ANON_KEY: anon,
      SUPABASE_SERVICE_ROLE_KEY: service,
      INFINITEPAY_HANDLE: 'local-fixture',
      INFINITEPAY_API_KEY: 'local-synthetic-key',
      INFINITEPAY_CHECKOUT_ENABLED: 'true',
      APP_PUBLIC_URL: 'https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev',
    }).flatMap(([k, v]) => ['-e', k + '=' + v]),
    '-v',
    root + '/supabase/functions:/home/deno/functions:ro',
    '-v',
    root + '/scripts/homolog/finance:/home/deno/main:ro',
    '-v',
    root + '/.finance-local/runtime:/home/deno/wrappers:ro',
    image,
    'start',
    '--main-service',
    '/home/deno/main',
    '-p',
    '9000'
  )
mkdirSync(root + '/.finance-local', { recursive: true })
writeFileSync(
  root + '/.env.local',
  'VITE_SUPABASE_URL=https://organic-goldfish-r7w5rp9g754vhxp4v-5173.app.github.dev/_finance_local\nVITE_SUPABASE_ANON_KEY=' +
    anon +
    '\nVITE_FINANCE_LOCAL_PREVIEW=true\n'
)
writeFileSync(
  root + '/.finance-local/preview.config.mjs',
  `import { mergeConfig } from 'vite';import base from '../vite.config.js';import {quantityPreviewPlugin} from '../scripts/homolog/finance/quantity-preview.mjs';process.env.SUPABASE_URL='http://127.0.0.1:55554';export default mergeConfig(base,{cacheDir:'.finance-local/vite-cache',resolve:{dedupe:['react','react-dom','styled-components']},optimizeDeps:{include:['react','react-dom','@primer/react','@primer/react/experimental']},plugins:[quantityPreviewPlugin()],server:{host:'::',port:5173,strictPort:true,proxy:{'/_finance_local':{target:'http://127.0.0.1:55554',changeOrigin:true,rewrite:p=>p.replace(/^\\/_finance_local/,'')}}}})`
)
// Auth readiness alone does not imply Storage has finished its startup migrations.
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const ready = await fetch('http://127.0.0.1:55553/status')
    if (ready.ok) break
  } catch {}
  if (attempt === 59) throw Error('LOCAL_STORAGE_NOT_READY')
  await new Promise((resolve) => setTimeout(resolve, 1000))
}
console.log(
  JSON.stringify({
    localOnly: true,
    base: runtime.url.replace('55454', '55554'),
    previewCommand: 'npm run dev -- --config .finance-local/preview.config.mjs',
    adminPath: '/admin/parcerias?tab=engine',
  })
)
