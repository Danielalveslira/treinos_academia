// Prova, contra um GoTrue real (não mockado), que a proteção de CAPTCHA é aplicada no
// SERVIDOR -- uma chamada direta à API, sem nenhum frontend envolvido, não consegue contornar
// o requisito de CAPTCHA nos endpoints que o exigem.
//
// Ao contrário de scripts/homolog/local-stack.sh e auth-hook-stack.sh, esta stack NÃO roda numa
// rede `--internal`: ela precisa alcançar de verdade https://hcaptcha.com/siteverify para que a
// validação do CAPTCHA seja real, não simulada. Por isso:
//   - Usa só as chaves de teste PÚBLICAS e oficiais da hCaptcha (sitekey/secret "all zeros"),
//     documentadas pela própria hCaptcha para automação -- nunca uma conta ou projeto real.
//   - Nunca aponta para o projeto Supabase hospedado (produção); o par Postgres+GoTrue aqui é
//     isolado, descartável, e não compartilha rede com `local-stack.sh`/`auth-hook-stack.sh`.
//   - Não precisa aplicar as migrations do app: a aplicação de CAPTCHA é inteiramente da camada
//     GoTrue/Auth, independente do schema `public`.
//
// Uso: node scripts/homolog/verify-captcha-server-enforcement.mjs
// (sobe os containers, roda os testes, derruba tudo ao final -- mesmo em caso de falha)
import assert from 'node:assert/strict'
import { execFileSync, execSync } from 'node:child_process'
import { jwt as signLocalJwt } from './keys.mjs'

const IMG = 'public.ecr.aws/supabase'
const GOTRUE_URL = 'http://127.0.0.1:9999'
// Chaves de teste OFICIAIS da hCaptcha (https://docs.hcaptcha.com/#integration-testing-test-keys)
// -- sempre públicas, nunca ligadas a uma conta real. O secret "all zeros" só valida um conjunto
// fixo de tokens de resposta "dummy" (confirmado abaixo), não qualquer string arbitrária.
const HCAPTCHA_TEST_SECRET = '0x0000000000000000000000000000000000000000'
const HCAPTCHA_TEST_SITEKEY = '10000000-ffff-ffff-ffff-000000000001'
const HCAPTCHA_DUMMY_TOKEN = '10000000-aaaa-bbbb-cccc-000000000001'
const SERVICE = signLocalJwt({ role: 'service_role' })

let checks = 0
let ownsStack = false
function ok(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`PASS ${label}`)
}

async function gotrue(method, path, body) {
  const args = ['exec', '-i', 'cdb', 'curl', '-sS', '-m', '20', '-w', '\n%{http_code}', '-X', method,
    '-H', 'Content-Type: application/json']
  if (body?.auth) args.push('-H', `Authorization: Bearer ${SERVICE}`)
  if (body) args.push('-d', '@-')
  args.push(`${GOTRUE_URL}${path}`)
  const raw = execFileSync('docker', args, { input: body ? JSON.stringify(body.json ?? body) : '', encoding: 'utf8' })
  const split = raw.lastIndexOf('\n')
  return { status: Number(raw.slice(split + 1)), json: JSON.parse(raw.slice(0, split) || 'null') }
}

function siteverify(response) {
  const raw = execFileSync('docker', ['exec', 'cdb', 'curl', '-sS', '-m', '20', '-X', 'POST',
    'https://hcaptcha.com/siteverify', '-d', `secret=${HCAPTCHA_TEST_SECRET}&response=${response}`], { encoding: 'utf8' })
  return JSON.parse(raw)
}

function sh(cmd) {
  execSync(cmd, { stdio: 'inherit' })
}

function teardown() {
  if (ownsStack) execFileSync('docker', ['rm', '-f', 'cauth', 'cdb'], { stdio: 'ignore' })
}

function up() {
  const existing = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { encoding: 'utf8' }).trim().split('\n')
  if (existing.includes('cauth') || existing.includes('cdb')) throw new Error('cdb/cauth já existem; inspecione antes de iniciar')
  ownsStack = true
  sh(`docker run -d --name cdb -e POSTGRES_PASSWORD=postgres ${IMG}/postgres:17.6.1.166 >/dev/null`)
  for (let i = 0; i < 40; i++) {
    try {
      execFileSync('docker', ['exec', 'cdb', 'pg_isready', '-U', 'supabase_admin', '-h', '127.0.0.1'], { stdio: 'ignore' })
      break
    } catch { execSync('sleep 2') }
  }
  execSync('sleep 5')
  const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
  sh(`docker run -d --name cauth --network container:cdb \
    -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=${GOTRUE_URL} \
    -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL=postgres://supabase_auth_admin:postgres@127.0.0.1:5432/postgres \
    -e GOTRUE_SITE_URL=http://127.0.0.1:3000 -e GOTRUE_JWT_SECRET=${SECRET} -e GOTRUE_JWT_EXP=3600 \
    -e GOTRUE_DISABLE_SIGNUP=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true -e GOTRUE_MAILER_AUTOCONFIRM=false \
    -e GOTRUE_SMTP_HOST=127.0.0.1 -e GOTRUE_SMTP_PORT=2500 -e GOTRUE_SMTP_ADMIN_EMAIL=a@b.c \
    -e GOTRUE_SECURITY_CAPTCHA_ENABLED=true -e GOTRUE_SECURITY_CAPTCHA_PROVIDER=hcaptcha \
    -e GOTRUE_SECURITY_CAPTCHA_SECRET=${HCAPTCHA_TEST_SECRET} \
    ${IMG}/gotrue:v2.197.0 >/dev/null`)
  for (let i = 0; i < 30; i++) {
    try {
      execFileSync('docker', ['exec', 'cdb', 'curl', '-sf', '-m', '2', `${GOTRUE_URL}/health`], { stdio: 'ignore' })
      return
    } catch { execSync('sleep 2') }
  }
  throw new Error('GoTrue não respondeu a tempo')
}

// --- 0. Sanidade do segredo de teste: só os tokens "dummy" documentados validam, não string
// arbitrária -- confirma que o secret de teste não é um passa-livre incondicional. --------------
async function hcaptchaTestSecretSanity() {
  const arbitrary = siteverify('qualquer-string-arbitraria')
  ok(arbitrary.success === false, 'siteverify real: resposta arbitrária é rejeitada mesmo com o secret de teste')

  const dummy = siteverify(HCAPTCHA_DUMMY_TOKEN)
  ok(dummy.success === true, 'siteverify real: o token dummy documentado da hCaptcha é aceito')
}

// --- 1. Reject-path: 5 endpoints reais do GoTrue recusam CAPTCHA ausente/vazio/inválido --------
async function rejectPath() {
  for (const [label, call] of [
    ['signup sem captcha', () => gotrue('POST', '/signup', { email: `r1-${Date.now()}@example.test`, password: 'Password123!' })],
    ['signup com captcha vazio', () => gotrue('POST', '/signup', { email: `r2-${Date.now()}@example.test`, password: 'Password123!', gotrue_meta_security: { captcha_token: '' } })],
    ['signup com captcha garbage', () => gotrue('POST', '/signup', { email: `r3-${Date.now()}@example.test`, password: 'Password123!', gotrue_meta_security: { captcha_token: 'garbage-not-real' } })],
    ['login (token/password) sem captcha', () => gotrue('POST', '/token?grant_type=password', { email: 'nobody@example.test', password: 'x' })],
    ['otp (signInWithOtp) sem captcha', () => gotrue('POST', '/otp', { email: `r4-${Date.now()}@example.test`, create_user: true })],
    ['resend sem captcha', () => gotrue('POST', '/resend', { type: 'signup', email: `r5-${Date.now()}@example.test` })],
    ['recover sem captcha', () => gotrue('POST', '/recover', { email: `r6-${Date.now()}@example.test` })],
  ]) {
    const { status, json } = await call()
    ok(status === 400 && json?.error_code === 'captcha_failed', `reject: ${label} -> captcha_failed (status=${status}, error_code=${json?.error_code})`)
  }
}

// --- 2. Accept-path: com o token dummy válido, os mesmos endpoints passam do gate de CAPTCHA
// (a falha seguinte é só o envio de e-mail, que não está configurado aqui -- prova que o gate
// de CAPTCHA foi superado, não que a operação inteira "funciona" sem SMTP). ----------------------
async function acceptPath() {
  for (const [label, call] of [
    ['signup com token dummy válido', () => gotrue('POST', '/signup', { email: `a1-${Date.now()}@example.test`, password: 'Password123!', gotrue_meta_security: { captcha_token: HCAPTCHA_DUMMY_TOKEN } })],
    ['otp com token dummy válido', () => gotrue('POST', '/otp', { email: `a2-${Date.now()}@example.test`, create_user: true, gotrue_meta_security: { captcha_token: HCAPTCHA_DUMMY_TOKEN } })],
    ['recover com token dummy válido', () => gotrue('POST', '/recover', { email: `a3-${Date.now()}@example.test`, gotrue_meta_security: { captcha_token: HCAPTCHA_DUMMY_TOKEN } })],
  ]) {
    const { status, json } = await call()
    ok(status !== 400 || json?.error_code !== 'captcha_failed', `accept: ${label} -> passou do gate de CAPTCHA (status=${status}, error_code=${json?.error_code})`)
  }
}

// --- 3. /verify (confirmação do código OTP) nunca exige CAPTCHA, mesmo com CAPTCHA ligado
// globalmente -- confirma empiricamente o achado estrutural (campo @deprecated no SDK). ---------
async function verifyIsNeverCaptchaGated() {
  const email = `verify-${Date.now()}@example.test`
  const link = await gotrue('POST', '/admin/generate_link', { auth: true, json: { type: 'signup', email, password: 'Password123!' } })
  ok(link.status === 200 && typeof link.json.email_otp === 'string', 'generate_link devolveu um código OTP real')

  const verify = await gotrue('POST', '/verify', { type: 'signup', email, token: link.json.email_otp })
  ok(verify.status === 200 && verify.json?.access_token, 'verify: código real sem NENHUM campo de captcha -> sessão emitida normalmente')
}

// --- 4. Limite conhecido: o token "dummy" de teste da hCaptcha é reconhecidamente reutilizável
// (ao contrário de um token real, de um desafio de verdade) -- então repetir essa chamada aqui
// NÃO prova rejeição de replay; só confirma que o GoTrue não soma uma camada própria de dedupe. -
async function knownReplayLimitation() {
  const email = `replay-${Date.now()}@example.test`
  const first = await gotrue('POST', '/otp', { email, create_user: true, gotrue_meta_security: { captcha_token: HCAPTCHA_DUMMY_TOKEN } })
  const second = await gotrue('POST', '/otp', { email: `${email}.2`, create_user: true, gotrue_meta_security: { captcha_token: HCAPTCHA_DUMMY_TOKEN } })
  console.log(
    `NOTA (não é PASS/FAIL de segurança): reuso do token dummy -> 1ª=${first.status}/${first.json?.error_code ?? 'ok'}, ` +
    `2ª=${second.status}/${second.json?.error_code ?? 'ok'}. O token dummy da hCaptcha é intencionalmente reutilizável ` +
    `para permitir automação repetida; isso não demonstra nada sobre o reuso de um token real (que a própria hCaptcha ` +
    `invalida após a primeira verificação bem-sucedida -- não reproduzível aqui sem um navegador completando um desafio real).`
  )
}

try {
  console.log('--- subindo GoTrue com CAPTCHA real (hCaptcha) ligado ---')
  up()

  console.log('--- 0. sanidade do secret de teste da hCaptcha ---')
  await hcaptchaTestSecretSanity()

  console.log('--- 1. reject-path: 7 chamadas diretas, CAPTCHA ausente/vazio/inválido ---')
  await rejectPath()

  console.log('--- 2. accept-path: token dummy válido supera o gate de CAPTCHA ---')
  await acceptPath()

  console.log('--- 3. /verify nunca exige CAPTCHA ---')
  await verifyIsNeverCaptchaGated()

  console.log('--- 4. limite conhecido do token dummy (não é teste de segurança) ---')
  await knownReplayLimitation()

  console.log(`\n${checks} verificações, todas PASS.`)
} finally {
  console.log('--- derrubando containers ---')
  teardown()
}
