// Prova o gate de autorização por sessão do P1 (docs/promps/PROMPT_REESTRUTURACAO_AUTENTICACAO_EVOLUTUS.md,
// secao 5.2) contra GoTrue/PostgREST reais, numa stack local isolada de produção.
//
// Requer, nesta ordem:
//   scripts/homolog/local-stack.sh up
//   scripts/homolog/auth-hook-stack.sh up
// Nenhuma chamada sai da rede isolada: todo HTTP/SQL é feito via `docker exec hdb ...`, nunca por
// porta publicada no host (não confiável neste ambiente) nem por qualquer endereço externo.
//
// Uso: node scripts/homolog/verify-auth-session-isolation.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { jwt as signLocalJwt } from './keys.mjs'

const DB = process.env.HOMOLOG_AUTH_DB === 'edb' ? 'edb' : 'hdb'

let checks = 0
function ok(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`PASS ${label}`)
}

function sql(source) {
  // -q: só o resultado do próprio SELECT, sem os ecos de status (BEGIN/SET/ROLLBACK) que -At
  // sozinho não suprime em modo batch -- interessam ao chamador que lê o retorno.
  return execFileSync(
    'docker',
    ['exec', '-i', DB, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-q', '-v', 'ON_ERROR_STOP=1'],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}

// Toda chamada HTTP roda dentro de hdb (mesmo netns de hauth_hook/hrest/hstorage/hfn); nunca por
// porta publicada no host, que não é confiável neste ambiente.
function http(port, method, path, { headers = {}, body } = {}) {
  const args = ['exec', DB, 'curl', '-s', '-w', '\n%{http_code}', '-X', method]
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`)
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-d', JSON.stringify(body))
  args.push(`http://127.0.0.1:${port}${path}`)
  const out = execFileSync('docker', args, { encoding: 'utf8' })
  const idx = out.lastIndexOf('\n')
  const status = Number(out.slice(idx + 1))
  const raw = out.slice(0, idx)
  let json
  try { json = raw ? JSON.parse(raw) : null } catch { json = raw }
  return { status, json }
}

function decode(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
}

const HOOK = DB === 'edb' ? 9999 : 9991 // GoTrue with hook enabled
const REST = 3000
const ANON = signLocalJwt({ role: 'anon' })
const SERVICE = signLocalJwt({ role: 'service_role' })

function restRpc(name, body, token) {
  return http(REST, 'POST', `/rpc/${name}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    body,
  })
}

function restSelect(table, token) {
  return http(REST, 'GET', `/${table}?limit=1`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
}

function denied(result, label) {
  const isDenied = result.status >= 400 || result.json === false
  ok(isDenied, `${label} (status=${result.status} json=${JSON.stringify(result.json)})`)
}

// --- 0. Sanidade do isolamento: sem rota de saída, cron neutralizado ---------------------------
function verifyIsolation() {
  const cronDisabled = sql('show cron.launch_active_jobs;')
  ok(cronDisabled === 'off', 'isolamento: launcher do cron desativado antes das migrations')
  let egress
  try {
    egress = execFileSync('docker', ['exec', DB, 'curl', '-s', '-m', '4', '-o', '/dev/null', '-w', '%{http_code}',
      'https://supabase.com'], { encoding: 'utf8' })
  } catch {
    egress = 'FAILED'
  }
  ok(egress === 'FAILED' || egress === '000', `isolamento: sem rota de saída da rede (curl externo = ${egress})`)
}

// --- 1. Sessão de cadastro (signInWithOtp, usuário novo) -> role auth_signup -------------------
function signupOtpSession() {
  const email = `signup-${randomUUID()}@example.test`
  const link = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'signup', email, password: 'ThrowawaySignup1!' },
  })
  ok(link.status === 200 && typeof link.json.email_otp === 'string', 'signup: generate_link devolveu email_otp')
  const uid = link.json.id

  const verify = http(HOOK, 'POST', '/verify', {
    headers: { apikey: ANON },
    body: { type: 'signup', email, token: link.json.email_otp },
  })
  ok(verify.status === 200 && verify.json.access_token, 'signup: verifyOtp devolveu uma sessão')
  const claims = decode(verify.json.access_token)
  ok(claims.role === 'auth_signup', `signup: role derivada = auth_signup (obtido: ${claims.role})`)
  ok(Array.isArray(claims.amr) && claims.amr.some((m) => m.method === 'otp'), 'signup: amr contém otp')
  const token = verify.json.access_token
  const refreshToken = verify.json.refresh_token
  const sessionId = claims.session_id

  // Acesso direto negado antes de qualquer prova de senha.
  denied(restRpc('is_full_login_session', {}, token), 'signup: is_full_login_session() nega a sessão restrita')
  denied(restSelect('wallets', token), 'signup: leitura direta de carteira financeira negada')
  const earlyOnboarding = restRpc('complete_user_onboarding', { p_profile: {}, p_legal: {} }, token)
  ok(earlyOnboarding.status >= 400, `signup: complete_user_onboarding sem prova de senha é rejeitado (${JSON.stringify(earlyOnboarding.json)})`)

  // Simula exatamente a sequência do Edge Function signup-password-sync (service role).
  const pwUpdate = http(HOOK, 'PUT', '/user', {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    body: { password: 'DefinitiveSignupPwd1!' },
  })
  ok(pwUpdate.status === 200, 'signup: GoTrue aceitou a senha definitiva')
  const recordPw = restRpc('record_signup_password_progress',
    { p_user_id: uid, p_session_id: sessionId, p_step: 'password_updated' }, SERVICE)
  ok(recordPw.status === 200 || recordPw.status === 204, 'signup: prova de senha registrada (service_role)')
  const logoutOthers = http(HOOK, 'POST', '/logout?scope=others', { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  ok(logoutOthers.status === 204 || logoutOthers.status === 200, 'signup: outras sessões revogadas')
  const recordRevoke = restRpc('record_signup_password_progress',
    { p_user_id: uid, p_session_id: sessionId, p_step: 'others_revoked' }, SERVICE)
  ok(recordRevoke.status === 200 || recordRevoke.status === 204, 'signup: revogação registrada (service_role)')

  // Seed mínimo de legal_policy publicada, só para este teste (não existe nenhuma localmente).
  seedLegalPolicy()
  const onboarding = restRpc('complete_user_onboarding', {
    p_profile: {
      username: `signuptest${uid.slice(0, 8)}`,
      sexo: 'nao_informar',
      birthDate: '1990-01-01',
      usageProfile: 'common',
      residenceMunicipalityCode: '1100015',
    },
    p_legal: { version: '1.0.0', digest: LEGAL_DIGEST, accepted: true, source: 'signup', healthConsentTextVersion: null },
  }, token)
  ok(onboarding.status === 200 && onboarding.json === true,
    `signup: complete_user_onboarding finalizou após prova completa (${JSON.stringify(onboarding.json)})`)

  // Login normal subsequente: agora role deve virar authenticated e abrir acesso completo.
  const login = http(HOOK, 'POST', '/token?grant_type=password', {
    headers: { apikey: ANON },
    body: { email, password: 'DefinitiveSignupPwd1!' },
  })
  ok(login.status === 200, 'signup: login explícito pós-cadastro funciona com a senha definitiva')
  const loginClaims = decode(login.json.access_token)
  ok(loginClaims.role === 'authenticated', `signup: login pós-cadastro já é role authenticated (obtido: ${loginClaims.role})`)
  const fullSession = restRpc('is_full_login_session', {}, login.json.access_token)
  ok(fullSession.status === 200 && fullSession.json === true, 'signup: is_full_login_session() true após onboarding + login explícito')

  return { token, refreshToken, email }
}

let LEGAL_DIGEST = ''
function seedLegalPolicy() {
  if (LEGAL_DIGEST) return
  const manifest = { version: '1.0.0', published: true }
  const documents = []
  LEGAL_DIGEST = createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')
  sql(`insert into public.legal_versions(version, manifest, documents, digest, published_at)
       values ('1.0.0', '${JSON.stringify(manifest)}'::jsonb, '${JSON.stringify(documents)}'::jsonb, '${LEGAL_DIGEST}', now())
       on conflict (version) do nothing;
       insert into public.legal_policy(id, version, published, digest, published_at, minimum_age)
       values (true, '1.0.0', true, '${LEGAL_DIGEST}', now(), 16)
       on conflict (id) do update set version=excluded.version, published=excluded.published,
         digest=excluded.digest, published_at=excluded.published_at, minimum_age=excluded.minimum_age;`)
}

// --- 2. Sessão de recuperação (usuário existente, já onboarded) -> role auth_recovery ----------
function recoveryOtpSession() {
  const email = `recovery-${randomUUID()}@example.test`
  const created = http(HOOK, 'POST', '/admin/users', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { email, password: 'OldPassword1!', email_confirm: true },
  })
  ok(created.status === 200 && created.json.id, 'recovery: usuário existente criado para o teste')
  const uid = created.json.id
  // Simula onboarding já concluído por este usuário (ele é "existente", não passou pelo novo fluxo).
  sql(`insert into private.auth_onboarding_completed(user_id, completed_at, source)
       values ('${uid}', now(), 'legacy') on conflict (user_id) do nothing;`)

  const link = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'recovery', email },
  })
  ok(link.status === 200 && typeof link.json.email_otp === 'string', 'recovery: generate_link devolveu email_otp')

  const verify = http(HOOK, 'POST', '/verify', {
    headers: { apikey: ANON },
    body: { type: 'recovery', email, token: link.json.email_otp },
  })
  ok(verify.status === 200 && verify.json.access_token, 'recovery: verifyOtp devolveu uma sessão')
  const claims = decode(verify.json.access_token)
  ok(claims.role === 'auth_recovery', `recovery: role derivada = auth_recovery (obtido: ${claims.role})`)
  const token = verify.json.access_token

  denied(restRpc('is_full_login_session', {}, token), 'recovery: is_full_login_session() nega a sessão de recuperação')
  denied(restSelect('wallets', token), 'recovery: leitura direta de carteira financeira negada')
  const onboarding = restRpc('complete_user_onboarding', { p_profile: {}, p_legal: {} }, token)
  ok(onboarding.status >= 400, `recovery: complete_user_onboarding é rejeitado para role auth_recovery (${JSON.stringify(onboarding.json)})`)

  // Edge Functions reais (exercise-catalog-proxy etc.) não puderam ser exercitadas aqui: o
  // runtime Deno resolve `jsr:@supabase/supabase-js` por uma busca de rede real a jsr.io a cada
  // boot do worker, que o isolamento desta stack (corretamente) bloqueia -- ver nota no relatório.
  // A cobertura equivalente é a RPC is_full_login_session() acima, que é exatamente o que essas
  // funções chamam como gate de autorização antes de qualquer lógica própria.

  return { token, refreshToken: verify.json.refresh_token, email, uid }
}

// --- 3. Refresh preserva o papel restrito (nunca promove) ---------------------------------------
function refreshKeepsRole(refreshToken, expectedRole, label) {
  const refreshed = http(HOOK, 'POST', '/token?grant_type=refresh_token', {
    headers: { apikey: ANON },
    body: { refresh_token: refreshToken },
  })
  ok(refreshed.status === 200, `${label}: refresh emitiu novo access_token`)
  const claims = decode(refreshed.json.access_token)
  ok(claims.role === expectedRole, `${label}: refresh preserva role=${expectedRole} (obtido: ${claims.role})`)
  return refreshed.json
}

// --- 4. Revogação: signOut(scope=others) encerra a outra sessão de verdade ---------------------
function revocationIsEnforced() {
  const email = `revoke-${randomUUID()}@example.test`
  const created = http(HOOK, 'POST', '/admin/users', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { email, password: 'TwoSessions1!', email_confirm: true },
  })
  const uid = created.json.id
  sql(`insert into private.auth_onboarding_completed(user_id, completed_at, source)
       values ('${uid}', now(), 'legacy') on conflict (user_id) do nothing;`)

  const loginA = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email, password: 'TwoSessions1!' } })
  const loginB = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email, password: 'TwoSessions1!' } })
  ok(loginA.status === 200 && loginB.status === 200, 'revogação: duas sessões abertas para o mesmo usuário')

  const activeBefore = restRpc('is_session_active', {}, loginB.json.access_token)
  ok(activeBefore.status === 200 && activeBefore.json === true, 'revogação: sessão B ativa antes da revogação')

  const revoke = http(HOOK, 'POST', '/logout?scope=others', { headers: { apikey: ANON, Authorization: `Bearer ${loginA.json.access_token}` } })
  ok(revoke.status === 204 || revoke.status === 200, 'revogação: logout scope=others executado pela sessão A')

  const activeAfter = restRpc('is_session_active', {}, loginB.json.access_token)
  ok(activeAfter.status === 200 && activeAfter.json === false, 'revogação: sessão B passa a inativa (JWT ainda válido criptograficamente, mas negado)')
  denied(restRpc('is_full_login_session', {}, loginB.json.access_token), 'revogação: is_full_login_session() nega a sessão B revogada')

  const refreshDenied = http(HOOK, 'POST', '/token?grant_type=refresh_token', { headers: { apikey: ANON }, body: { refresh_token: loginB.json.refresh_token } })
  ok(refreshDenied.status >= 400, `revogação: o próprio GoTrue nega refresh da sessão B revogada (status=${refreshDenied.status})`)
}

// --- 5. Compatibilidade com usuário legado (username + e-mail confirmado antes desta mudança) --
function legacyUserCompatibility() {
  const email = `legacy-${randomUUID()}@example.test`
  const created = http(HOOK, 'POST', '/admin/users', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { email, password: 'LegacyUserPwd1!', email_confirm: true },
  })
  ok(created.status === 200, 'legado: usuário criado como se já existisse antes desta mudança')
  const uid = created.json.id
  sql(`insert into public.users(id, username) values ('${uid}', 'legacyuser${uid.slice(0, 8)}')
       on conflict (id) do update set username = excluded.username;
       insert into private.auth_onboarding_completed(user_id, completed_at, source)
       select '${uid}', now(), 'legacy' where not exists (select 1 from private.auth_onboarding_completed where user_id='${uid}');`)

  const login = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email, password: 'LegacyUserPwd1!' } })
  ok(login.status === 200, 'legado: signInWithPassword funciona sem qualquer mudança de contrato')
  const claims = decode(login.json.access_token)
  ok(claims.role === 'authenticated', `legado: role = authenticated sem precisar de re-cadastro (obtido: ${claims.role})`)
  const full = restRpc('is_full_login_session', {}, login.json.access_token)
  ok(full.status === 200 && full.json === true, 'legado: is_full_login_session() true -- nenhuma regressão para quem já existia')
}

// A senha de uma conta antiga sem perfil não prova quem recebeu o e-mail: pode ser a
// senha deixada por um terceiro antes da confirmação. Exige novo OTP, substitui a
// senha e revoga a sessão de senha anterior antes de concluir o onboarding.
function legacyIncompleteResume() {
  const email = `legacy-pending-${randomUUID()}@example.test`
  const oldPassword = 'OldUntrustedPwd1!'
  const newPassword = 'OwnerVerifiedPwd1!'
  const created = http(HOOK, 'POST', '/admin/users', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { email, password: oldPassword, email_confirm: true },
  })
  ok(created.status === 200, 'legado incompleto: identidade confirmada criada')
  const uid = created.json.id
  sql(`insert into public.users(id, username, sexo) values ('${uid}', null, 'nao_informar')
       on conflict (id) do update set username=null, sexo='nao_informar';`)

  const oldLogin = http(HOOK, 'POST', '/token?grant_type=password', {
    headers: { apikey: ANON }, body: { email, password: oldPassword },
  })
  ok(oldLogin.status === 200 && decode(oldLogin.json.access_token).role === 'auth_setup',
    'legado incompleto: login de senha recebe apenas auth_setup')
  denied(restSelect('wallets', oldLogin.json.access_token),
    'legado incompleto: sessão auth_setup não lê carteira')
  denied(restRpc('complete_user_onboarding', { p_profile: {}, p_legal: {} }, oldLogin.json.access_token),
    'legado incompleto: senha antiga sozinha não conclui o perfil')

  const link = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'magiclink', email },
  })
  ok(link.status === 200 && typeof link.json.email_otp === 'string',
    'legado incompleto: GoTrue emite novo código para o e-mail existente')
  const verify = http(HOOK, 'POST', '/verify', {
    headers: { apikey: ANON }, body: { type: 'magiclink', email, token: link.json.email_otp },
  })
  ok(verify.status === 200 && decode(verify.json.access_token).role === 'auth_signup',
    'legado incompleto: OTP de nova prova recebe auth_signup')
  const token = verify.json.access_token
  const sessionId = decode(token).session_id
  denied(restSelect('wallets', token), 'legado incompleto: OTP não lê carteira')

  const changed = http(HOOK, 'PUT', '/user', {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` }, body: { password: newPassword },
  })
  ok(changed.status === 200, 'legado incompleto: senha substituída após OTP')
  ok(restRpc('record_signup_password_progress',
    { p_user_id: uid, p_session_id: sessionId, p_step: 'password_updated' }, SERVICE).status < 300,
    'legado incompleto: prova da nova senha registrada pelo servidor')
  const revoked = http(HOOK, 'POST', '/logout?scope=others', {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  })
  ok(revoked.status < 300, 'legado incompleto: sessão da senha antiga revogada')
  ok(restRpc('record_signup_password_progress',
    { p_user_id: uid, p_session_id: sessionId, p_step: 'others_revoked' }, SERVICE).status < 300,
    'legado incompleto: revogação registrada pelo servidor')

  seedLegalPolicy()
  const profile = {
    username: `resumed${uid.slice(0, 8)}`, sexo: 'nao_informar', birthDate: '1990-01-01',
    usageProfile: 'common', residenceMunicipalityCode: '1100015',
  }
  const legal = {
    version: '1.0.0', digest: LEGAL_DIGEST, accepted: true,
    source: 'signup', healthConsentTextVersion: null,
  }
  const rejected = restRpc('complete_user_onboarding', {
    p_profile: profile, p_legal: { ...legal, digest: 'invalid' },
  }, token)
  ok(rejected.status >= 400, 'legado incompleto: aceite legal inválido aborta a transação')
  ok(sql(`select username is null and not exists (
    select 1 from private.auth_onboarding_completed where user_id='${uid}'
  ) from public.users where id='${uid}';`) === 't',
  'legado incompleto: falha legal não grava username nem marcador')
  const finished = restRpc('complete_user_onboarding', { p_profile: profile, p_legal: legal }, token)
  ok(finished.status === 200 && finished.json === true,
    'legado incompleto: OTP, senha, revogação e aceite concluem atomicamente')
  ok(restRpc('complete_user_onboarding', { p_profile: profile, p_legal: legal }, token).json === true,
    'legado incompleto: repetição idempotente')
  const stale = http(HOOK, 'POST', '/token?grant_type=password', {
    headers: { apikey: ANON }, body: { email, password: oldPassword },
  })
  ok(stale.status >= 400, 'legado incompleto: senha antiga não autentica após a retomada')
  const login = http(HOOK, 'POST', '/token?grant_type=password', {
    headers: { apikey: ANON }, body: { email, password: newPassword },
  })
  ok(login.status === 200 && decode(login.json.access_token).role === 'authenticated',
    'legado incompleto: login novo recebe sessão plena')
}

// --- 6. Storage: leitura de avatar/capa exige has_app_access(), não só uid() is not null -------
// storage.objects não é exposto pelo PostgREST desta stack (PGRST_DB_SCHEMAS=public) nem pelo
// Storage API sem subir um objeto real primeiro; simula exatamente a avaliação de RLS que
// PostgREST/Storage API fariam (mesma GUC `request.jwt.claims` que `auth.uid()`/`auth.jwt()` leem).
// is_full_login_session() (e portanto has_app_access()) exige current_session_active(), que checa
// uma sessão REAL em auth.sessions -- não basta simular claims soltas, usa-se a sessão de verdade
// emitida por um login real e reutiliza-se exatamente o que está no access_token dela.
function asRole(token, query) {
  const claims = decode(token)
  return sql(`
    begin;
    set local role authenticated;
    set local request.jwt.claims to '${JSON.stringify(claims)}';
    ${query}
    rollback;`)
}

function storageReadGate() {
  // Sessão restrita real (mesma emitida em auth_signup já testado em 1.): ainda não fez login
  // explícito, então não tem onboarding nem senha provada.
  const signupEmail = `storage-signup-${randomUUID()}@example.test`
  const signupLink = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'signup', email: signupEmail, password: 'ThrowawayStorage1!' },
  })
  const restrictedVerify = http(HOOK, 'POST', '/verify', {
    headers: { apikey: ANON },
    body: { type: 'signup', email: signupEmail, token: signupLink.json.email_otp },
  })
  const restrictedUid = signupLink.json.id

  sql(`insert into storage.objects(bucket_id, name, owner)
       values ('profile-avatars', 'test/${restrictedUid}.png', '${restrictedUid}');`)

  const asRestricted = asRole(restrictedVerify.json.access_token,
    `select count(*) from storage.objects where bucket_id = 'profile-avatars' and name = 'test/${restrictedUid}.png';`)
  ok(asRestricted.trim() === '0', 'storage: sessão auth_signup não vê o avatar (0 linhas, antes via has_app_access)')

  // Sessão plena real: usuário com onboarding e aceite legal já registrados, login explícito de senha.
  const fullEmail = `storage-full-${randomUUID()}@example.test`
  const fullCreated = http(HOOK, 'POST', '/admin/users', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { email: fullEmail, password: 'StorageFull1!', email_confirm: true },
  })
  const fullUid = fullCreated.json.id
  seedLegalPolicy() // has_app_access() (diferente de is_full_login_session()) também exige aceite da legal_policy publicada.
  sql(`insert into public.users(id, username, legal_acceptance_version, legal_acceptance_digest)
       values ('${fullUid}', 'storagetest${fullUid.slice(0, 8)}', '1.0.0', '${LEGAL_DIGEST}')
       on conflict (id) do update set legal_acceptance_version = excluded.legal_acceptance_version,
         legal_acceptance_digest = excluded.legal_acceptance_digest;
       insert into private.auth_onboarding_completed(user_id, completed_at, source)
       values ('${fullUid}', now(), 'legacy') on conflict (user_id) do nothing;`)
  const fullLogin = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email: fullEmail, password: 'StorageFull1!' } })
  ok(fullLogin.status === 200, 'storage: login explícito do usuário de teste de acesso pleno funcionou')

  const asFull = asRole(fullLogin.json.access_token,
    `select count(*) from storage.objects where bucket_id = 'profile-avatars' and name = 'test/${restrictedUid}.png';`)
  ok(asFull.trim() === '1', 'storage: sessão authenticated/has_app_access() continua vendo o avatar normalmente')
}

// --- 7. Pré-cadastro por terceiro (P2, secao 6): o atacante cria a conta com a senha dele antes
// da vítima -- ela não pode sobrar nem conceder sessão depois que a vítima prova o e-mail ---------
function preAccountHijackScenario() {
  const email = `hijack-${randomUUID()}@example.test`
  const attackerPassword = 'AttackerKnownPwd1!'
  const victimPassword = 'VictimChosenPwd1!'

  // 1. Atacante cria a conta primeiro, com a senha que ele escolheu. Usa generate_link (admin) só
  //    para criar o usuário sem depender de SMTP neste teste -- equivalente a um signUp público
  //    comum: fica pendente, sem sessão para o atacante (confirmação obrigatória, sem autoconfirm).
  const attackerLink = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'signup', email, password: attackerPassword },
  })
  ok(attackerLink.status === 200 && attackerLink.json.id, 'hijack: conta pré-criada pelo atacante, com a senha dele, antes da vítima')
  const uid = attackerLink.json.id

  // 2. A vítima (dona real do e-mail) pede o código de verdade dela -- simulado por um SEGUNDO
  //    generate_link (representa o que chegaria na caixa de entrada quando ELA pede o código,
  //    não um atalho de autorização do atacante; o dele já foi descartado, nunca verificado).
  const link = http(HOOK, 'POST', '/admin/generate_link', {
    headers: { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE },
    body: { type: 'signup', email },
  })
  const verify = http(HOOK, 'POST', '/verify', { headers: { apikey: ANON }, body: { type: 'signup', email, token: link.json.email_otp } })
  ok(verify.status === 200 && verify.json.access_token, 'hijack: vítima verifica o código real e recebe uma sessão')
  const claims = decode(verify.json.access_token)
  ok(claims.role === 'auth_signup', `hijack: mesmo numa conta pré-criada pelo atacante, a sessão da vítima vem restrita (obtido: ${claims.role})`)
  const token = verify.json.access_token

  // 3. A vítima define a senha dela de verdade -- sobrescrevendo a do atacante -- e revoga
  //    qualquer outra sessão, exatamente como o Edge Function signup-password-sync faz.
  const pwUpdate = http(HOOK, 'PUT', '/user', { headers: { apikey: ANON, Authorization: `Bearer ${token}` }, body: { password: victimPassword } })
  ok(pwUpdate.status === 200, 'hijack: vítima sobrescreve a senha que o atacante tinha escolhido')
  restRpc('record_signup_password_progress', { p_user_id: uid, p_session_id: claims.session_id, p_step: 'password_updated' }, SERVICE)
  http(HOOK, 'POST', '/logout?scope=others', { headers: { apikey: ANON, Authorization: `Bearer ${token}` } })
  restRpc('record_signup_password_progress', { p_user_id: uid, p_session_id: claims.session_id, p_step: 'others_revoked' }, SERVICE)

  seedLegalPolicy()
  const onboarding = restRpc('complete_user_onboarding', {
    p_profile: {
      username: `hijacktest${uid.slice(0, 8)}`, sexo: 'nao_informar', birthDate: '1990-01-01',
      usageProfile: 'common', residenceMunicipalityCode: '1100015',
    },
    p_legal: { version: '1.0.0', digest: LEGAL_DIGEST, accepted: true, source: 'signup', healthConsentTextVersion: null },
  }, token)
  ok(onboarding.status === 200 && onboarding.json === true, 'hijack: onboarding da vítima conclui normalmente')

  // 4. A senha do atacante NUNCA mais funciona; só a da vítima loga.
  const attackerLogin = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email, password: attackerPassword } })
  ok(attackerLogin.status >= 400, `hijack: a senha original do atacante não autentica mais (status=${attackerLogin.status})`)
  const victimLogin = http(HOOK, 'POST', '/token?grant_type=password', { headers: { apikey: ANON }, body: { email, password: victimPassword } })
  ok(victimLogin.status === 200, 'hijack: só a senha definida pela vítima autentica a conta')
}

console.log('--- 0. isolamento da stack ---')
verifyIsolation()

console.log('--- 1. sessão de cadastro (auth_signup) ---')
const signup = signupOtpSession()

console.log('--- 2. sessão de recuperação (auth_recovery) ---')
const recovery = recoveryOtpSession()

console.log('--- 3. refresh preserva o papel restrito ---')
refreshKeepsRole(recovery.refreshToken, 'auth_recovery', 'refresh')

console.log('--- 4. revogação de outras sessões é real ---')
revocationIsEnforced()

console.log('--- 5. compatibilidade com usuário legado ---')
legacyUserCompatibility()

console.log('--- 5.1 retomada de legado incompleto com nova prova de e-mail ---')
legacyIncompleteResume()

console.log('--- 6. storage: leitura de avatar exige has_app_access() ---')
storageReadGate()

console.log('--- 7. pré-cadastro por terceiro (hijacking) não sobrevive à vítima ---')
preAccountHijackScenario()

console.log(`\n${checks} verificações, todas PASS.`)
