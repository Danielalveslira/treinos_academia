// Concorrência real (processos/conexões de verdade disputando o mesmo usuário, não uma
// transação pgTAP só) para o benefício "primeira comunidade gratuita" e para a cobrança de
// upgrade de tier. Mesmo padrão de evocash-pricing-concurrency.mjs: container disposable, sql()
// via `docker exec psql`, claims JWT simulados por set_config.
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia'].includes(container)) throw Error('DISPOSABLE_DATABASE_REQUIRED')
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
assert.match(info.Config.Image, /supabase\/postgres:/)
const execute = promisify(execFile)
async function sql(source) {
  const result = await execute('docker', ['exec', '-i', container, 'psql', '-U', process.env.PG_TEST_USER || 'supabase_admin', '-d', 'postgres', '-X', '-tA', '-v', 'ON_ERROR_STOP=1', '-c', source])
  const text = result.stdout.trim()
  return text.split('\n').filter(line => line.startsWith('{')).at(-1) || text
}
const quote = value => `'${String(value).replaceAll("'", "''")}'`
const userA = randomUUID(), sessionA = randomUUID()
const userB = randomUUID(), sessionB = randomUUID()
function claims(user, session) {
  const payload = JSON.stringify({ sub: user, role: 'authenticated', session_id: session, amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] })
  return `select set_config('request.jwt.claim.sub',${quote(user)},true);select set_config('request.jwt.claims',${quote(payload)},true);set local role authenticated;`
}
const createFree = (user, session, name, requestId) =>
  `begin;${claims(user, session)}select public.create_free_community(${quote(name)},'desc','dumbbell','everyone',${quote(requestId)});commit;`

await sql(`insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
(${quote(userA)},'authenticated','authenticated',${quote(userA + '@example.invalid')},'x',now(),'{}','{}',now(),now()),
(${quote(userB)},'authenticated','authenticated',${quote(userB + '@example.invalid')},'x',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id in (${quote(userA)},${quote(userB)});
insert into auth.sessions(id,user_id,created_at,updated_at) values(${quote(sessionA)},${quote(userA)},now(),now()),(${quote(sessionB)},${quote(userB)},now(),now());`)

// ---- Cenário 1: N conexões concorrentes do MESMO usuário disputando o benefício gratuito ----
// pgTAP (uma transação só) não prova isto -- precisa de conexões/commits de verdade disputando
// o mesmo advisory lock e a mesma PK em community_free_creation_grants.
const racesA = await Promise.allSettled(
  Array.from({ length: 5 }, () => sql(createFree(userA, sessionA, 'Grátis concorrente', randomUUID())))
)
const wonA = racesA.filter((r) => r.status === 'fulfilled')
assert.equal(wonA.length, 1, 'Exactly one concurrent create_free_community call wins the benefit')
for (const r of racesA.filter((r) => r.status === 'rejected')) {
  assert.match(r.reason.stderr, /FREE_BENEFIT_ALREADY_USED/)
}
assert.equal(
  await sql(`select count(*) from public.community_free_creation_grants where user_id=${quote(userA)}`),
  '1',
  'Exactly one grant row, never two, under real concurrency'
)
assert.equal(
  await sql(`select count(*) from public.communities where owner_id=${quote(userA)}`),
  '1',
  'Exactly one community created, never two'
)

// ---- Cenário 2: mesma chave de idempotência, N conexões concorrentes -> todas devolvem a MESMA comunidade ----
const replayRequestId = randomUUID()
const replays = await Promise.all(
  Array.from({ length: 6 }, () => sql(createFree(userB, sessionB, 'Replay concorrente', replayRequestId)))
)
const parsedReplays = replays.map((r) => JSON.parse(r))
assert.equal(
  new Set(parsedReplays.map((r) => r.id)).size,
  1,
  'Concurrent retries with the same idempotency key share exactly one community'
)
assert.equal(
  await sql(`select count(*) from public.communities where owner_id=${quote(userB)}`),
  '1',
  'No duplicate community from concurrent idempotent retries'
)
assert.equal(
  await sql(`select count(*) from public.community_free_creation_grants where user_id=${quote(userB)}`),
  '1'
)

// ---- Cenário 3: upgrade de tier -- confirmações concorrentes (mesmo preço aprovado) cobram só uma vez ----
await sql(`update public.community_creation_products set evocoins_price = 600 where tier = 'plus'`)
await sql(`select public._wallet_credit_coins(${quote(userB)}::uuid, 1000)`)
const communityB = JSON.parse(
  await sql(`select jsonb_build_object('id', id) from public.communities where owner_id=${quote(userB)}`)
).id
const upgrade = (requestId) =>
  `begin;${claims(userB, sessionB)}select public.upgrade_community_tier(${quote(communityB)}::uuid,'plus','evocoins',${quote(requestId)},600);commit;`
const upgradeRaces = await Promise.allSettled(
  Array.from({ length: 5 }, () => sql(upgrade(randomUUID())))
)
const upgradeWon = upgradeRaces.filter((r) => r.status === 'fulfilled')
assert.equal(upgradeWon.length, 1, 'Exactly one concurrent upgrade confirmation charges the wallet')
assert.equal(
  await sql(`select coin_balance from public.wallets where user_id=${quote(userB)}`),
  '400',
  'Debited exactly once (1000 - 600), never twice under concurrency'
)
assert.equal(await sql(`select tier from public.communities where id=${quote(communityB)}::uuid`), 'plus')

console.log(
  JSON.stringify({
    passed: true,
    localOnly: true,
    freeGrantRace: { attempts: 5, winners: 1 },
    freeReplayRace: { attempts: 6, distinctCommunities: 1 },
    upgradeChargeRace: { attempts: 5, winners: 1 },
  })
)
