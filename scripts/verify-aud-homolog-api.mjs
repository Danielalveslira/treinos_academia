// Auth/PostgREST/Storage reais, somente portas locais e identidades sintéticas.
// Requer o banco antigo preparado em evolutus_homolog_db. Não aceita URL remota.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { jwt, SECRET } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
const API = 'http://127.0.0.1:55439'
const anon = jwt({ role: 'anon' })
const service = jwt({ role: 'service_role' })
const client = (base, key = anon) =>
  createClient(base, key, { auth: { persistSession: false, autoRefreshToken: false } })
const admin = client(API, service)
const password = 'Synthetic-aud-password-913!'
let checks = 0
function ok(condition, label) {
  assert.ok(condition, label)
  checks++
  console.log(`PASS ${label}`)
}
function success(result, label) {
  ok(!result.error, `${label} (${result.error?.code || 'OK'})`)
  return result.data
}
function denied(result, label) {
  ok(result.error?.code === '42501', `${label}: 42501`)
}
function sql(source, db = 'postgres') {
  return execFileSync(
    'docker',
    [
      'exec',
      '-i',
      'evolutus_homolog_db',
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      db,
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}
async function login(email, base = API) {
  const c = client(base)
  const data = success(await c.auth.signInWithPassword({ email, password }), 'login Auth real')
  return { c, session: data.session, id: data.user.id }
}
async function bundleService(version, c) {
  globalThis.__audContractClient = c
  const source =
    version === 'old'
      ? execFileSync('git', ['show', 'HEAD:src/services/statusesService.js'], { encoding: 'utf8' })
      : readFileSync('src/services/statusesService.js', 'utf8')
  const file = `/tmp/aud-contract-${version}.cjs`
  await build({
    stdin: { contents: source, resolveDir: process.cwd() },
    outfile: file,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    logLevel: 'silent',
    plugins: [
      {
        name: 'local-client',
        setup(b) {
          b.onResolve({ filter: /supabase\/config$/ }, () => ({ path: 'local', namespace: 'aud' }))
          b.onLoad({ filter: /.*/, namespace: 'aud' }, () => ({
            contents:
              'export const supabase = { from(...args) { return globalThis.__audContractClient.from(...args) } }',
          }))
        },
      },
    ],
  })
  return createRequire(import.meta.url)(file)
}
const gateway = await startAudGateway()
try {
  const manifest = JSON.parse(readFileSync('legal/manifest.json', 'utf8'))
  const documents = JSON.parse(readFileSync('legal/documents.json', 'utf8'))
  const digest = createHash('sha256').update(JSON.stringify({ manifest, documents })).digest('hex')
  success(
    await admin
      .from('legal_versions')
      .upsert({ version: manifest.version, manifest, documents, digest }),
    'arquivo legal sintético local'
  )
  success(
    await admin.from('legal_policy').upsert({
      id: true,
      version: manifest.version,
      published: true,
      digest,
      minimum_age: manifest.minimumAge,
      published_at: new Date().toISOString(),
    }),
    'policy legal local'
  )
  const users = []
  for (let i = 0; i < 3; i++) {
    const c = client(API)
    const email = `aud-http-${i}@example.invalid`
    const prior = await c.auth.signInWithPassword({ email, password })
    const data = success(
      prior.error ? await c.auth.signUp({ email, password }) : prior,
      'cadastro/login Auth real'
    )
    success(await c.rpc('ensure_user_profile'), 'perfil inicial via PostgREST')
    success(await c.rpc('set_username', { p_username: `aud_http_${i}` }), 'nome via RPC')
    success(
      await c.rpc('set_birth_info', {
        payload: { sexo: 'nao_informar', dataNascimento: '1990-01-01' },
      }),
      'nascimento via RPC'
    )
    success(
      await c.rpc('accept_legal_documents', {
        payload: {
          version: manifest.version,
          digest,
          manifest,
          documents,
          accepted: true,
          healthDataConsent: true,
        },
      }),
      'aceite legal via RPC'
    )
    users.push({ id: data.user.id, email, session: data.session, c })
  }
  const [author, member, stranger] = users
  const oldExists = sql("select count(*) from pg_database where datname='evolutus_old';") === '1'
  const oldReady =
    oldExists &&
    sql(
      "select count(*) from information_schema.tables where table_schema='public' and table_name='statuses';",
      'evolutus_old'
    ) === '1'
  const community = oldReady
    ? sql(
        "select id from public.communities where name='AUD HTTP' order by created_at desc limit 1;",
        'evolutus_old'
      )
    : randomUUID()
  const forbidden = oldReady
    ? sql(
        "select id from public.communities where name='AUD proibida' order by created_at desc limit 1;",
        'evolutus_old'
      )
    : randomUUID()
  sql(`insert into public.communities(id,name,created_by,owner_id) values ('${community}','AUD HTTP','${author.id}','${author.id}'),('${forbidden}','AUD proibida','${stranger.id}','${stranger.id}') on conflict(id) do nothing;
insert into public.community_members(community_id,user_id) values ('${community}','${author.id}'),('${community}','${member.id}') on conflict do nothing;
update public.wallets set cash_balance=100 where user_id='${author.id}'; select public._wallet_credit_coins('${member.id}',100);`)
  // Captura o banco anterior com os mesmos usuários, senhas e sessões locais.
  // Snapshot descartável desta suíte; não toca no banco Auth ativo.
  if (!oldReady) {
    if (sql("select count(*) from pg_database where datname='evolutus_old';") === '1')
      sql('drop database evolutus_old with (force);')
    sql('create database evolutus_old;')
    const dump = execFileSync(
      'docker',
      [
        'exec',
        'evolutus_homolog_db',
        'pg_dump',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '--exclude-schema=cron',
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    )
    sql(
      dump
        .replace(/^CREATE EXTENSION[^\n]*pg_cron[^\n]*\n/gm, '')
        .replace(/^COMMENT ON EXTENSION pg_cron[^\n]*\n/gm, '')
        .replace(
          /^(GRANT|REVOKE|ALTER DEFAULT PRIVILEGES)[^\n]*(ON (FUNCTION|TABLE) cron\.|SCHEMA cron)[^\n]*\n/gm,
          ''
        ),
      'evolutus_old'
    )
  }
  ok(
    sql(
      "select to_regprocedure('private.statuses_initialize_identity()') is null;",
      'evolutus_old'
    ) === 't',
    'snapshot antigo realmente sem trigger novo'
  )
  let oldRestExists = false
  try {
    execFileSync('docker', ['inspect', 'evolutus_homolog_oldrest'], { stdio: 'pipe' })
    oldRestExists = true
  } catch {
    /* primeira execução */
  }
  if (oldRestExists)
    execFileSync('docker', ['start', 'evolutus_homolog_oldrest'], { stdio: 'pipe' })
  else
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        'evolutus_homolog_oldrest',
        '--network',
        'container:evolutus_homolog_db',
        '-e',
        'PGRST_DB_URI=postgres://authenticator:local-aud-synthetic-password@127.0.0.1:5432/evolutus_old',
        '-e',
        'PGRST_DB_SCHEMAS=public',
        '-e',
        'PGRST_DB_ANON_ROLE=anon',
        '-e',
        `PGRST_JWT_SECRET=${SECRET}`,
        '-e',
        'PGRST_SERVER_PORT=3001',
        'public.ecr.aws/supabase/postgrest:v16.4',
      ],
      { stdio: 'pipe' }
    )
  sql("notify pgrst,'reload schema';", 'evolutus_old')
  for (let i = 0; i < 60; i++) {
    const r = await fetch(`${API}/old/rest/v1/statuses?select=id&limit=1`, {
      headers: { Authorization: `Bearer ${service}` },
    }).catch(() => ({ ok: false }))
    if (r.ok) break
    await new Promise((r) => setTimeout(r, 200))
  }
  const oldSession = await login(author.email, `${API}/old`)
  for (const [base, c] of [['old', oldSession.c]]) {
    for (const version of ['old', 'new']) {
      const svc = await bundleService(version, c)
      const row = await svc.createTextStatus(
        community,
        { id: author.id, username: 'aud_http_0', role: 'user' },
        `${version}/${base}`
      )
      const data = success(
        await c.from('statuses').select('author_username').eq('id', row.id).single(),
        `frontend ${version}/banco antigo: texto`
      )
      ok(data.author_username === 'aud_http_0', `frontend ${version}/banco antigo: nome preservado`)
    }
  }
  // Reproduz a incompatibilidade da migration estrita antes da correção adicional.
  sql(
    readFileSync('supabase/migration_sources/aud_01_aud_02/20261026000001_close_account_rollback.sql', 'utf8') +
      readFileSync('supabase/migration_sources/aud_01_aud_02/20261026000002_status_write_allowlist.sql', 'utf8') +
      "notify pgrst,'reload schema';"
  )
  await new Promise((r) => setTimeout(r, 300))
  const legacy = {
    community_id: community,
    author_id: author.id,
    type: 'text',
    text: 'cliente antigo',
    author_username: 'nome-falso',
    author_is_superadmin: true,
  }
  denied(
    await author.c.from('statuses').insert(legacy),
    'incompatibilidade antiga confirmada antes da migration 03'
  )
  sql(
    readFileSync('supabase/migration_sources/aud_01_aud_02/20261026000003_status_legacy_author_compat.sql', 'utf8') +
      readFileSync(
        'supabase/migration_sources/aud_01_aud_02/20261026000004_community_promotion_server_only.sql',
        'utf8'
      ) +
      "notify pgrst,'reload schema';"
  )
  for (const version of ['old', 'new']) {
    const svc = await bundleService(version, author.c)
    const row = await svc.createTextStatus(
      community,
      { id: author.id, username: 'dica_falsa', role: 'superadmin' },
      `${version}/banco novo`
    )
    const data = success(
      await author.c.from('statuses').select('*').eq('id', row.id).single(),
      `frontend ${version}/banco novo: criação`
    )
    ok(
      data.author_username === 'aud_http_0' &&
        !data.author_is_superadmin &&
        !data.promoted &&
        data.comment_count === 0,
      `frontend ${version}/banco novo: autoria real, selo e metadados seguros`
    )
  }
  const post = success(
    await author.c.from('statuses').insert(legacy).select('*').single(),
    'dicas legadas aceitas e descartadas'
  )
  const forged = {
    promoted: true,
    promoted_until: '2099-01-01T00:00:00Z',
    active_promotion_id: randomUUID(),
    positive_vote_count: 999,
    negative_vote_count: 999,
    comment_count: 999,
    created_at: '2099-01-01T00:00:00Z',
    expires_at: '2099-01-01T00:00:00Z',
    retention_mode: 'no_auto_expiration',
  }
  for (const [column, value] of Object.entries(forged)) {
    denied(
      await author.c.from('statuses').insert({ ...legacy, [column]: value }),
      `INSERT ${column}`
    )
    denied(
      await author.c
        .from('statuses')
        .update({ [column]: value })
        .eq('id', post.id),
      `UPDATE ${column}`
    )
    denied(
      await author.c.from('statuses').upsert({ ...legacy, id: post.id, [column]: value }),
      `UPSERT ${column}`
    )
  }
  for (const column of ['author_username', 'author_is_superadmin']) {
    denied(
      await author.c
        .from('statuses')
        .update({ [column]: legacy[column] })
        .eq('id', post.id),
      `UPDATE ${column}`
    )
    denied(await author.c.from('statuses').upsert({ ...legacy, id: post.id }), `UPSERT ${column}`)
  }
  denied(
    await author.c.from('statuses').insert({ ...legacy, author_id: member.id }),
    'autoria de outro usuário'
  )
  denied(
    await author.c.from('statuses').insert({ ...legacy, community_id: forbidden }),
    'comunidade não autorizada'
  )
  denied(
    await member.c.from('statuses').update({ text: 'ataque' }).eq('id', post.id),
    'UPDATE de outro autor'
  )
  denied(await client(API).from('statuses').insert(legacy), 'anon sem JWT de usuário')
  sql(`update public.communities set post_access='admins' where id='${community}';`)
  denied(
    await member.c.from('statuses').insert({ ...legacy, author_id: member.id }),
    'post_access admins rejeita membro comum'
  )
  success(await author.c.from('statuses').insert(legacy), 'post_access admins permite dono')
  sql(`update public.communities set post_access='everyone' where id='${community}';`)
  for (const u of users) {
    denied(await u.c.rpc('delete_own_account'), 'RPC de rollback fechada via HTTP')
    denied(await u.c.from('users').delete().eq('id', u.id), 'DELETE de perfil fechado via HTTP')
  }
  const promo = success(
    await author.c.rpc('create_promotion', {
      p_target_type: 'post',
      p_target_id: post.id,
      p_package_id: 'post_boost_3d',
      p_request_id: `aud-http:${post.id}:paid1`,
    }),
    'promoção paga via RPC'
  )
  ok(
    success(
      await author.c.from('wallets').select('cash_balance').eq('user_id', author.id).single(),
      'leitura saldo'
    ).cash_balance === 75,
    'débito de 25 EvoCash'
  )
  success(
    await author.c.rpc('create_promotion', {
      p_target_type: 'post',
      p_target_id: post.id,
      p_package_id: 'post_boost_3d',
      p_request_id: `aud-http:${post.id}:paid1`,
    }),
    'retry da promoção'
  )
  ok(
    success(
      await author.c.from('wallets').select('cash_balance').eq('user_id', author.id).single(),
      'saldo após retry'
    ).cash_balance === 75,
    'retry não duplica débito'
  )
  const bad = await member.c.rpc('create_promotion', {
    p_target_type: 'post',
    p_target_id: post.id,
    p_package_id: 'post_boost_3d',
    p_request_id: `aud-http:${post.id}:wrong-owner`,
  })
  ok(bad.error?.message === 'NOT_OWNER', 'outro membro não promove alvo alheio')
  success(
    await author.c.rpc('cancel_promotion', { p_promotion_id: promo.id, p_reason: null }),
    'cancelamento autorizado'
  )
  success(
    await author.c.rpc('create_promotion', {
      p_target_type: 'post',
      p_target_id: post.id,
      p_package_id: 'post_boost_3d',
      p_request_id: `aud-http:${post.id}:paid2`,
    }),
    'nova promoção paga'
  )
  ok(
    success(
      await author.c.from('wallets').select('cash_balance').eq('user_id', author.id).single(),
      'saldo após nova promoção'
    ).cash_balance === 50,
    'nova promoção cobra novamente'
  )
  success(
    await member.c.rpc('cast_vote', { p_status_id: post.id, p_value: 1 }),
    'voto via RPC atualiza contador'
  )
  success(
    await member.c.rpc('comment_create', {
      p_status_id: post.id,
      p_parent_comment_id: null,
      p_body: 'Comentário HTTP',
      p_client_request_id: randomUUID(),
    }),
    'comentário via RPC'
  )
  const after = success(
    await author.c.from('statuses').select('*').eq('id', post.id).single(),
    'leitura final de metadados'
  )
  ok(
    after.author_username === 'aud_http_0' &&
      !after.author_is_superadmin &&
      after.promoted &&
      after.positive_vote_count === 1 &&
      after.comment_count === 1,
    'triggers e RPCs preservam autoria, promoção paga e contadores'
  )
  // Sessões somente sintéticas, em /tmp; nunca impressas nem adicionadas ao repositório.
  writeFileSync(
    '/tmp/aud-homolog-sessions.json',
    JSON.stringify({
      API,
      anon,
      password,
      users: users.map(({ c, ...u }) => u),
      community,
      forbidden,
    }),
    { mode: 0o600 }
  )
  console.log(`RESULT ${checks} verificações HTTP aprovadas; dados exclusivamente locais.`)
} finally {
  await new Promise((r) => gateway.close(r))
}
