// Prova, contra Postgres+GoTrue reais (não mockados), o desenho de MFA TOTP para superadmins
// (prompt, secao 9 "MFA / superadmins"): matricula/desafio nativos do Supabase Auth, aal2
// comprovado pela claim assinada do GoTrue, e is_superadmin() exigindo aal2 só quando a flag
// de prontidão (mfa_enforcement_ready) está ligada -- nunca por padrão.
//
// Stack própria e descartável (mdb/mauth/mstorage), nomes diferentes dos demais
// scripts. Storage só inicializa o schema storage exigido pelas migrations; nenhum
// objeto é enviado e PostgREST/Kong/Edge Functions não são necessários. A rede
// Docker --internal impede saída para produção; o launcher do pg_cron é desativado
// antes de subir os demais serviços e aplicar migrations históricas.
//
// Uso: node scripts/homolog/verify-mfa-totp.mjs
import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { createHmac } from 'node:crypto'

const IMG = 'public.ecr.aws/supabase'
const NET = 'mfa-auth-isolated'
const GOTRUE_URL = 'http://127.0.0.1:9999'
const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'

let checks = 0
let ownsStack = false
function ok(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`PASS ${label}`)
}

async function gotrue(method, path, body, token) {
  const args = ['exec', '-i', 'mdb', 'curl', '-sS', '-w', '\n%{http_code}', '-X', method,
    '-H', 'Content-Type: application/json', '-H', `Authorization: Bearer ${token || signServiceJwt()}`]
  if (body) args.push('-d', '@-')
  args.push(`${GOTRUE_URL}${path}`)
  const response = execFileSync('docker', args, { input: body ? JSON.stringify(body) : '', encoding: 'utf8' })
  const split = response.lastIndexOf('\n')
  return { status: Number(response.slice(split + 1)), json: JSON.parse(response.slice(0, split) || 'null') }
}

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64url')
}
// JWT de service_role assinado localmente com o MESMO segredo do GoTrue -- só para chamar as
// rotas /admin/* desta instância descartável, nunca um segredo real.
function signServiceJwt() {
  return signRoleJwt('service_role')
}
function signRoleJwt(role) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({ role, iss: 'supabase', iat: Math.floor(Date.now() / 1000) })
  const sig = createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

function decode(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

function sql(source) {
  return execFileSync('docker', ['exec', '-i', 'mdb', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: source, encoding: 'utf8' }).trim()
}

// --- RFC 6238 TOTP, HMAC-SHA1, passo de 30s, 6 dígitos -- sem dependência nova ------------------
function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.toUpperCase().replace(/=+$/, '')) {
    const idx = alphabet.indexOf(char)
    if (idx === -1) continue
    bits += idx.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}
function totp(base32Secret, stepSeconds = 30, digits = 6, at = Date.now()) {
  const key = base32Decode(base32Secret)
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / stepSeconds)))
  const hmac = createHmac('sha1', key).update(counter).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const binary = ((hmac[offset] & 0x7f) << 24) | ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) | (hmac[offset + 3] & 0xff)
  return String(binary % 10 ** digits).padStart(digits, '0')
}

function sh(cmd) { execSync(cmd, { stdio: 'inherit' }) }

function teardown() {
  if (!ownsStack) return
  try { execFileSync('docker', ['rm', '-f', 'mstorage', 'mauth', 'mdb'], { stdio: 'ignore' }) } catch { /* limpeza parcial */ }
  try { execFileSync('docker', ['network', 'rm', NET], { stdio: 'ignore' }) } catch { /* limpeza parcial */ }
}

function up() {
  const existing = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n')
  if (existing.includes('mdb') || existing.includes('mauth') || existing.includes('mstorage'))
    throw new Error('Containers mdb/mauth/mstorage já existem; não serão removidos pelo harness')
  execFileSync('docker', ['network', 'create', '--internal', NET], { stdio: 'ignore' })
  ownsStack = true
  sh(`docker run -d --name mdb --network ${NET} -e POSTGRES_PASSWORD=postgres ${IMG}/postgres:17.6.1.166 >/dev/null`)
  for (let i = 0; i < 40; i++) {
    try { execFileSync('docker', ['exec', 'mdb', 'pg_isready', '-U', 'supabase_admin', '-h', '127.0.0.1'], { stdio: 'ignore' }); break }
    catch { execSync('sleep 2') }
  }
  execSync('sleep 5')
  execFileSync('docker', ['exec', 'mdb', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-c', 'alter system set cron.launch_active_jobs = off', '-c', 'select pg_reload_conf()'], { stdio: 'ignore' })
  sh(`docker run -d --name mauth --network container:mdb \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=${GOTRUE_URL} \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres \
    -e GOTRUE_SITE_URL=http://127.0.0.1:3000 -e GOTRUE_JWT_SECRET=${SECRET} -e GOTRUE_JWT_EXP=3600 -e GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=true \
    -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=a@b.c \
    -e GOTRUE_MFA_TOTP_ENROLL_ENABLED=true -e GOTRUE_MFA_TOTP_VERIFY_ENABLED=true \
    ${IMG}/gotrue:v2.197.0 >/dev/null`)

  const anonKey = signRoleJwt('anon')
  const serviceKey = signServiceJwt()
  sh(`docker run -d --name mstorage --network container:mdb \
    -e ANON_KEY=${anonKey} -e SERVICE_KEY=${serviceKey} -e AUTH_JWT_SECRET=${SECRET} -e PGRST_JWT_SECRET=${SECRET} \
    -e DATABASE_URL=postgres://supabase_storage_admin:postgres@127.0.0.1:5432/postgres \
    -e DB_INSTALL_ROLES=false -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file \
    -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage -e TENANT_ID=local -e REGION=local \
    -e GLOBAL_S3_BUCKET=local -e SERVER_PORT=5000 -e ENABLE_IMAGE_TRANSFORMATION=false \
    ${IMG}/storage-api:v1.77.5 >/dev/null`)

  const P = (src) => execFileSync('docker', ['exec', '-i', 'mdb', 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: src, encoding: 'utf8' })
  for (let i = 0; i < 60; i++) {
    const has = sql(`select
      (select count(*) from information_schema.tables where table_schema='auth' and table_name='users')::text ||
      (select count(*) from information_schema.tables where table_schema='storage' and table_name='buckets')::text;`)
    if (has === '11') break
    execSync('sleep 2')
  }
  P('create extension if not exists pgtap with schema extensions; create extension if not exists pg_cron;')
  for (const f of execFileSync('bash', ['-c', 'ls supabase/migrations/*.sql'], { encoding: 'utf8' }).trim().split('\n')) {
    try {
      P(execFileSync('cat', [f], { encoding: 'utf8' }))
    } catch (e) {
      console.error(`FALHOU: ${f}`)
      throw e
    }
  }

  for (let i = 0; i < 30; i++) {
    try {
      const status = execFileSync('docker', ['exec', 'mdb', 'curl', '-s', '-o', '/dev/null', '-w', '%{http_code}', '-m', '2', `${GOTRUE_URL}/health`], { encoding: 'utf8' })
      if (status !== '000') return
    } catch { /* retry below */ }
    execSync('sleep 2')
  }
  const logs = execFileSync('docker', ['logs', '--tail', '30', 'mauth'], { encoding: 'utf8' })
  throw new Error(`GoTrue não respondeu a tempo: ${logs}`)
}

try {
  console.log('--- subindo Postgres+GoTrue com MFA TOTP ligado (mdb/mauth) ---')
  up()

  console.log('--- 0. aal presente na claim de um login comum ---')
  const email = `mfa-${Date.now()}@example.test`
  const password = 'SuperadminPwd1!'
  const created = await gotrue('POST', '/admin/users', { email, password, email_confirm: true })
  ok(created.status === 200, 'admin: usuário superadmin de teste criado')
  const uid = created.json.id
  sql(`insert into public.users(id, username, role, legal_acceptance_version, legal_acceptance_digest)
       values ('${uid}', 'mfatest${uid.slice(0, 8)}', 'superadmin', null, null) on conflict (id) do update set role='superadmin';
       insert into private.auth_onboarding_completed(user_id, completed_at, source) values ('${uid}', now(), 'legacy') on conflict (user_id) do nothing;`)

  const login1 = await gotrue('POST', '/token?grant_type=password', { email, password })
  ok(login1.status === 200, 'login: senha correta autentica')
  const claims1 = decode(login1.json.access_token)
  ok(claims1.aal === 'aal1', `login sem fator: aal=${claims1.aal} (esperado aal1)`)

  function asRole(token, query) {
    const claims = decode(token)
    return sql(`begin; set local role authenticated; set local request.jwt.claims to '${JSON.stringify(claims)}'; ${query} rollback;`)
  }

  console.log('--- 1. sem matrícula, sem enforcement: is_superadmin() já funciona normalmente ---')
  const preEnroll = asRole(login1.json.access_token, 'select is_superadmin(), auth_mfa_enforcement_ready();')
  ok(preEnroll.split('|')[0] === 't', `is_superadmin() true com aal1, antes de qualquer matrícula (${preEnroll})`)
  ok(preEnroll.includes('f'), 'auth_mfa_enforcement_ready() é false por padrão')

  console.log('--- 2. matrícula real (enroll) + código TOTP calculado localmente (challenge+verify) ---')
  const enroll = await gotrue('POST', '/factors', { factor_type: 'totp' }, login1.json.access_token)
  ok(enroll.status === 200 && enroll.json?.totp?.secret, 'mfa.enroll: GoTrue devolveu um segredo TOTP real')
  const factorId = enroll.json.id
  const secret = enroll.json.totp.secret

  const challenge = await gotrue('POST', `/factors/${factorId}/challenge`, {}, login1.json.access_token)
  ok(challenge.status === 200 && challenge.json?.id, 'mfa.challenge: desafio criado')

  const wrongCode = String((Number(totp(secret)) + 1) % 1000000).padStart(6, '0')
  const verifyWrong = await gotrue('POST', `/factors/${factorId}/verify`,
    { challenge_id: challenge.json.id, code: wrongCode }, login1.json.access_token)
  ok(verifyWrong.status >= 400, `mfa.verify: código incorreto é rejeitado (status=${verifyWrong.status})`)

  const challenge2 = await gotrue('POST', `/factors/${factorId}/challenge`, {}, login1.json.access_token)
  const rightCode = totp(secret)
  const verifyRight = await gotrue('POST', `/factors/${factorId}/verify`,
    { challenge_id: challenge2.json.id, code: rightCode }, login1.json.access_token)
  ok(verifyRight.status === 200 && verifyRight.json?.access_token, 'mfa.verify: código TOTP calculado localmente é aceito')
  const claims2 = decode(verifyRight.json.access_token)
  ok(claims2.aal === 'aal2', `sessão promovida a aal2 depois do verify (obtido: ${claims2.aal})`)

  console.log('--- 3. aal2 real reconhecido por is_aal2_session() ---')
  const aal2Check = asRole(verifyRight.json.access_token, 'select is_aal2_session();')
  ok(aal2Check === 't', 'is_aal2_session() true com a sessão aal2 real pós-verify')
  const aal1Check = asRole(login1.json.access_token, 'select is_aal2_session();')
  ok(aal1Check === 'f', 'is_aal2_session() false com a sessão aal1 original (mesmo após matricular o fator)')

  console.log('--- 4. com enforcement ligado (só nesta base descartável): aal1 negado, aal2 permitido ---')
  sql(`update private.auth_flow_control set mfa_enforcement_ready = true where id;`)
  const afterEnforceAal1 = asRole(login1.json.access_token, 'select is_superadmin();')
  ok(afterEnforceAal1 === 'f', 'is_superadmin() nega a sessão aal1 original quando enforcement está ligado')
  const afterEnforceAal2 = asRole(verifyRight.json.access_token, 'select is_superadmin();')
  ok(afterEnforceAal2 === 't', 'is_superadmin() permite a sessão aal2 (pós-verify) quando enforcement está ligado')
  sql(`update private.auth_flow_control set mfa_enforcement_ready = false where id;`) // só por higiene; a base inteira é destruída a seguir

  console.log(`\n${checks} verificações, todas PASS.`)
} finally {
  console.log('--- derrubando containers ---')
  teardown()
}
