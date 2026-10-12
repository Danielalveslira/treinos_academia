// Regressão HTTP complementar: promoção de comunidade também exige EvoCash/RPC.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'
const f = JSON.parse(readFileSync('/tmp/aud-homolog-sessions.json', 'utf8'))
const API = 'http://127.0.0.1:55439'
const gateway = await startAudGateway()
let checks = 0
const ok = (value, label) => {
  assert.ok(value, label)
  checks++
  console.log(`PASS ${label}`)
}
const success = (result, label) => {
  ok(!result.error, `${label} (${result.error?.code || 'OK'})`)
  return result.data
}
const denied = (result, label) => ok(result.error?.code === '42501', `${label}: 42501`)
function sql(source) {
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
      'postgres',
      '-X',
      '-At',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim()
}
try {
  const c = createClient(API, f.anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const session = success(
    await c.auth.signInWithPassword({ email: f.users[0].email, password: f.password }),
    'login real do dono'
  ).session
  f.users[0].session = session
  writeFileSync('/tmp/aud-homolog-sessions.json', JSON.stringify(f), { mode: 0o600 })
  const id = randomUUID()
  sql(
    `insert into public.communities(id,name,created_by,owner_id) values ('${id}','Comunidade financeira HTTP','${f.users[0].id}','${f.users[0].id}'); insert into public.community_members(community_id,user_id) values ('${id}','${f.users[0].id}'); update public.wallets set cash_balance=300 where user_id='${f.users[0].id}';`
  )
  for (const [key, value] of Object.entries({
    promoted: true,
    promoted_until: '2099-01-01T00:00:00Z',
    active_promotion_id: randomUUID(),
  })) {
    denied(
      await c
        .from('communities')
        .update({ [key]: value })
        .eq('id', id),
      `UPDATE direto comunidade ${key}`
    )
    denied(
      await c
        .from('communities')
        .upsert({
          id,
          name: 'forjada',
          created_by: f.users[0].id,
          owner_id: f.users[0].id,
          [key]: value,
        }),
      `UPSERT comunidade ${key}`
    )
  }
  success(
    await c.from('communities').update({ description: 'Descrição legítima' }).eq('id', id),
    'edição normal preservada'
  )
  const promo = success(
    await c.rpc('create_promotion', {
      p_target_type: 'community',
      p_target_id: id,
      p_package_id: 'community_boost_7d',
      p_request_id: `aud:community:${id}`,
    }),
    'comunidade promovida por pagamento'
  )
  const cash = () => c.from('wallets').select('cash_balance').eq('user_id', f.users[0].id).single()
  ok(
    success(await cash(), 'saldo real da carteira').cash_balance === 200,
    'débito autorizado de 100 EvoCash'
  )
  denied(
    await c
      .from('communities')
      .update({ promoted: false, promoted_until: null, active_promotion_id: null })
      .eq('id', id),
    'cancelamento direto negado'
  )
  const paid = success(
    await c.from('communities').select('promoted,active_promotion_id').eq('id', id).single(),
    'leitura de promoção legítima'
  )
  ok(
    paid.promoted && paid.active_promotion_id === promo.id,
    'tentativa direta não altera promoção paga'
  )
  success(
    await c.rpc('cancel_promotion', { p_promotion_id: promo.id, p_reason: null }),
    'cancelamento autorizado pela RPC'
  )
  denied(
    await c.from('wallets').update({ cash_balance: 99999 }).eq('user_id', f.users[0].id),
    'saldo não pode ser manipulado diretamente'
  )
  denied(
    await c.from('cash_purchases').update({ status: 'credited' }).eq('user_id', f.users[0].id),
    'compra não pode ser creditada pelo cliente'
  )
  ok(
    sql(
      `select count(*) from public.economy_transactions where user_id='${f.users[0].id}' and reference_id='${promo.id}' and reason='promotion_purchase';`
    ) === '1',
    'pagamento de comunidade auditado uma vez'
  )
  console.log(`RESULT ${checks} verificações financeiras HTTP aprovadas.`)
} finally {
  await new Promise((r) => gateway.close(r))
}
