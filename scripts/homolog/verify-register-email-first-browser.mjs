// Homologação visual real (navegador de verdade, não mock) do cadastro e-mail-primeiro
// (padrão) e do cadastro convencional pré-hook (LEGACY_ONLY=1). Complementa
// scripts/homolog/verify-auth-session-isolation.mjs, que já prova o mecanismo de servidor
// (63 verificações); este script prova que a UI React renderizada guia a pessoa pela
// sequência real: e-mail -> perfil -> código -> senha -> login explícito.
//
// Por que um navegador DENTRO de um container, e não no host: a publicação de porta
// host<->container deste sandbox não tem as regras DNAT que o Docker normalmente instala
// (`sudo iptables -t nat -L DOCKER -n` mostra a chain vazia) -- qualquer `-p host:container`
// fica inacessível do host, mesmo aparecendo certo em `docker inspect`. A solução é nunca
// cruzar essa fronteira: o navegador roda dentro de um container que entra na MESMA rede do
// banco (`--network container:edb`), e fala com a stack por 127.0.0.1, exatamente como
// `docker exec edb curl ...` já faz em todo o resto deste diretório.
//
// Usa uma stack e nomes de container PRÓPRIOS (prefixo e*, rede eisolated) -- nunca hdb/hauth/
// hkong/etc. -- para não colidir com outra sessão usando scripts/homolog/local-stack.sh ao
// mesmo tempo. Não precisa de auth-hook-stack.sh: aqui o único GoTrue já sobe com o hook
// ligado desde o início (nenhum motivo para ter uma segunda instância sem hook).
//
// O navegador e o driver (scripts/homolog/_e2e-driver.mjs) rodam dentro da imagem oficial
// mcr.microsoft.com/playwright (Chromium + Node já embutidos); o pacote `playwright` em si
// fica numa volume Docker nomeada (pwcache), instalada uma vez com `npm install` fora da
// rede isolada -- nunca no node_modules deste repositório.
//
// Uso: node scripts/homolog/verify-register-email-first-browser.mjs
//      LEGACY_ONLY=1 node scripts/homolog/verify-register-email-first-browser.mjs
//      SQL_ONLY=1 KEEP_STACK=1 node scripts/homolog/verify-register-email-first-browser.mjs
import { execFileSync, execSync } from 'node:child_process'
import { writeFileSync, rmSync, existsSync } from 'node:fs'
import { jwt as signLocalJwt } from './keys.mjs'

const IMG = 'public.ecr.aws/supabase'
const PWIMG = 'mcr.microsoft.com/playwright:v1.49.0-noble'
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const NET = 'eisolated'
const LEGACY = process.env.LEGACY_ONLY === '1'
const ANON = signLocalJwt({ role: 'anon' })
const SERVICE = signLocalJwt({ role: 'service_role' })
let ownsStack = false

function sh(cmd, opts = {}) {
  return execSync(cmd, { stdio: 'inherit', ...opts })
}
function out(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim()
}
function sql(source) {
  return execFileSync(
    'docker',
    ['exec', '-i', 'edb', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  )
}
function psqlVal(q) {
  return execFileSync('docker', ['exec', 'edb', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-tAc', q], { encoding: 'utf8' }).trim()
}

function teardown() {
  console.log('--- derrubando containers e rede ---')
  try { execFileSync('docker', ['rm', '-f', 'efn', 'ekong', 'erest', 'estorage', 'eauth', 'edb'], { stdio: 'ignore' }) } catch {}
  try { execFileSync('docker', ['network', 'rm', NET], { stdio: 'ignore' }) } catch {}
  try { rmSync(new URL('../../.env.e2e.local', import.meta.url), { force: true }) } catch {}
  try { rmSync(new URL('../../dist-e2e', import.meta.url), { recursive: true, force: true }) } catch {}
}

function up() {
  const names = out("docker ps -a --format '{{.Names}}'").split('\n')
  const collisions = ['efn', 'ekong', 'erest', 'estorage', 'eauth', 'edb'].filter((name) => names.includes(name))
  if (collisions.length) throw new Error(`Containers já existentes: ${collisions.join(', ')}; remova-os explicitamente após inspeção`)
  const networks = out("docker network ls --format '{{.Name}}'").split('\n')
  if (networks.includes(NET)) throw new Error(`Rede ${NET} já existe; inspecione-a antes de iniciar`)
  sh(`docker network create --internal ${NET} >/dev/null`)
  ownsStack = true
  sh(`docker run -d --name edb --network ${NET} -e POSTGRES_PASSWORD=postgres ${IMG}/postgres:17.6.1.166 >/dev/null`)
  for (let i = 0; i < 40; i++) {
    try { execFileSync('docker', ['exec', 'edb', 'pg_isready', '-U', 'supabase_admin', '-h', '127.0.0.1'], { stdio: 'ignore' }); break }
    catch { execSync('sleep 2') }
  }
  execSync('sleep 5')
  sql('alter system set cron.launch_active_jobs = off; select pg_reload_conf();')
  const N = ['--network', 'container:edb']
  // GoTrue único, com o hook de role já ligado (private.auth_scope_access_token) -- este
  // script só precisa de UM GoTrue coerente com o que o Kong/app vão falar.
  sh(`docker run -d --name eauth ${N.join(' ')} -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres \
    -e GOTRUE_SITE_URL=http://127.0.0.1:4173 -e GOTRUE_JWT_SECRET=${SECRET} -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
    -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=a@b.c \
    ${LEGACY ? '' : '-e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED=true -e GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI=pg-functions://postgres/private/auth_scope_access_token'} \
    ${IMG}/gotrue:v2.197.0 >/dev/null`)
  sh(`docker run -d --name estorage ${N.join(' ')} -e ANON_KEY=${ANON} -e SERVICE_KEY=${SERVICE} -e AUTH_JWT_SECRET=${SECRET} -e PGRST_JWT_SECRET=${SECRET} \
    -e DATABASE_URL=postgres://supabase_storage_admin:postgres@127.0.0.1:5432/postgres -e DB_INSTALL_ROLES=false -e FILE_SIZE_LIMIT=52428800 \
    -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=local -e REGION=local -e GLOBAL_S3_BUCKET=local \
    -e SERVER_PORT=5000 -e ENABLE_IMAGE_TRANSFORMATION=false ${IMG}/storage-api:v1.77.5 >/dev/null`)
  for (let i = 0; i < 60; i++) {
    const a = psqlVal("select 1 from information_schema.tables where table_schema='auth' and table_name='users'")
    const s = psqlVal("select 1 from information_schema.tables where table_schema='storage' and table_name='buckets'")
    if (a === '1' && s === '1') break
    execSync('sleep 2')
  }
  sql("create extension if not exists pgtap with schema extensions; create extension if not exists pg_cron;")
  for (const f of out('ls supabase/migrations/*.sql').split('\n')) {
    if (LEGACY && /2026122300000[3-7]_/.test(f)) continue
    try { sql(execSync(`cat ${f}`, { encoding: 'utf8' })) }
    catch (e) { console.error('FALHOU migration:', f); throw e }
  }
  sh(`docker run -d --name erest ${N.join(' ')} -e PGRST_DB_URI=postgres://authenticator:postgres@127.0.0.1:5432/postgres -e PGRST_DB_SCHEMAS=public \
    -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=${SECRET} -e PGRST_SERVER_PORT=3000 ${IMG}/postgrest:v14.5 >/dev/null`)
  sh(`docker run -d --name ekong ${N.join(' ')} -e KONG_DATABASE=off -e KONG_DECLARATIVE_CONFIG=/kong.yml -e KONG_DNS_ORDER=LAST,A,CNAME -e KONG_PLUGINS=cors \
    -e KONG_PROXY_LISTEN=0.0.0.0:8000 -e KONG_ADMIN_LISTEN=off -v "${process.cwd()}/scripts/homolog/kong.yml":/kong.yml:ro ${IMG}/kong:2.8.1 >/dev/null`)
  sh(`mkdir -p /tmp/e2e-homolog-main && cp scripts/homolog/edge-main.ts /tmp/e2e-homolog-main/index.ts`)
  sh(`docker run -d --name efn ${N.join(' ')} -e JWT_SECRET=${SECRET} -e SUPABASE_URL=http://127.0.0.1:8000 -e SUPABASE_ANON_KEY=${ANON} -e SUPABASE_SERVICE_ROLE_KEY=${SERVICE} \
    -v "${process.cwd()}/supabase/functions":/home/deno/functions:ro -v /tmp/e2e-homolog-main:/home/deno/main:ro \
    ${IMG}/edge-runtime:v1.77.1 start --main-service /home/deno/main -p 9000 >/dev/null`)
  for (let i = 0; i < 30; i++) {
    try { execFileSync('docker', ['exec', 'edb', 'curl', '-sf', 'http://127.0.0.1:9999/health'], { stdio: 'ignore' }); break }
    catch { execSync('sleep 1') }
  }
  console.log('stack e2e no ar (rede interna eisolated, sem porta publicada no host)')
}

function seedAndFlag() {
  // O cliente valida o aceite contra um allowlist fixo de digests aprovados
  // (src/utils/legal.js, APPROVED_LEGAL_DIGESTS/legal/approved-digests.json) -- um manifest/
  // documentos sintéticos nunca bateriam e travariam o botão final com LEGAL_POLICY_INCOMPATIBLE
  // (achado real desta homologação). Usa o manifest/documentos/digest REAIS e já aprovados do
  // repositório, só publicados nesta base descartável.
  const manifest = JSON.parse(execFileSync('cat', ['legal/manifest.json'], { encoding: 'utf8' }))
  const documents = JSON.parse(execFileSync('cat', ['legal/documents.json'], { encoding: 'utf8' }))
  const digests = JSON.parse(execFileSync('cat', ['legal/approved-digests.json'], { encoding: 'utf8' }))
  const version = manifest.version
  const digest = digests[version]
  if (!digest) throw new Error(`Sem digest aprovado para a versão ${version} em legal/approved-digests.json`)
  if (!LEGACY) sql(`update private.auth_flow_control set email_first_ready=true where id;`)
  // $$...$$ evita qualquer problema de aspas no texto em pt-BR dos documentos reais.
  sql(`insert into public.legal_versions(version, manifest, documents, digest, published_at)
       values ('${version}', $m$${JSON.stringify(manifest)}$m$::jsonb, $d$${JSON.stringify(documents)}$d$::jsonb, '${digest}', now())
       on conflict (version) do nothing;`)
  sql(`insert into public.legal_policy(id, version, published, digest, published_at, minimum_age)
       values (true, '${version}', true, '${digest}', now(), ${manifest.minimumAge ?? 16})
       on conflict (id) do update set version=excluded.version, published=excluded.published,
         digest=excluded.digest, published_at=excluded.published_at, minimum_age=excluded.minimum_age;`)
  console.log(`${LEGACY ? 'fluxo convencional sem hook/gate' : 'email_first_ready=true'} e legal_policy ${version} publicada -- só nesta base descartável`)
}

function buildFrontend() {
  writeFileSync('.env.e2e.local', `VITE_SUPABASE_URL=http://127.0.0.1:8000\nVITE_SUPABASE_ANON_KEY=${ANON}\nVITE_HCAPTCHA_ENABLED=false\n`)
  if (existsSync('dist-e2e')) rmSync('dist-e2e', { recursive: true, force: true })
  sh('npx vite build --mode e2e --outDir dist-e2e', { env: { ...process.env } })
  console.log('frontend buildado em dist-e2e/ apontando para a stack isolada')
}

try {
  console.log('--- subindo stack isolada (nomes e*, rede eisolated) ---')
  up()
  if (process.env.SQL_ONLY === '1') {
    console.log('stack SQL pronta; cron desativado e jobs preservados')
  } else {
  seedAndFlag()
  buildFrontend()

  console.log('--- rodando o driver do navegador dentro da rede isolada ---')
  try { execFileSync('docker', [
    'run', '--rm', '--network', 'container:edb',
    '-v', 'pwcache:/pwcache',
    '-v', `${process.cwd()}/dist-e2e:/site:ro`,
    // ESM `import` resolve node_modules a partir do caminho do próprio arquivo importador,
    // não do diretório de trabalho (ao contrário do require() do CJS) -- o driver precisa
    // estar DENTRO de /pwcache (onde `playwright` foi instalado), não solto na raiz.
    '-v', `${process.cwd()}/scripts/homolog/_e2e-driver.mjs:/pwcache/driver.mjs:ro`,
    '-v', '/tmp/e2e-shots:/shots',
    '-w', '/pwcache',
    '-e', 'ANON',
    '-e', 'SERVICE',
    '-e', `LEGACY_ONLY=${LEGACY ? '1' : '0'}`,
    PWIMG, 'node', '/pwcache/driver.mjs',
  ], { stdio: 'inherit', env: { ...process.env, ANON, SERVICE } }) }
  catch { throw new Error('O driver do navegador falhou; veja a saída do próprio driver acima.') }

  console.log('\nHomologação visual concluída -- ver screenshots em /tmp/e2e-shots')
  }
} finally {
  if (ownsStack && !process.env.KEEP_STACK) teardown()
}
