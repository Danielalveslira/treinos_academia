// Allowlisted loopback fixture only. No real tariff, wallet or production endpoint.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { jwt } from '../keys.mjs'
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' }),
  service = jwt({ role: 'service_role' })
async function call(path, body, token = anon) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await r.json()
  if (!r.ok) throw Error(data.message || JSON.stringify(data))
  return data
}
const password = 'Evolutus-Local-Fase6!2026',
  email = `publicidade-${randomUUID()}@example.invalid`
await call('/auth/v1/admin/users', { email, password, email_confirm: true }, service)
const owner = await call('/auth/v1/token?grant_type=password', { email, password })
const adminEmail = 'admin.financeiro@example.invalid',
  adminPassword = 'Evolutus-Local-Fase1!2026'
const admin = await call('/auth/v1/token?grant_type=password', {
  email: adminEmail,
  password: adminPassword,
})
const uid = owner.user.id
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
    `update public.users set usage_profile='professional',username='ad_'||left(replace(id::text,'-',''),12),legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id),legal_acceptance_accepted_at=now() where id in('${uid}','${admin.user.id}');select public._wallet_credit_cash('${uid}',1000);select public._ledger_record('${uid}','phase6-synthetic-seed','cash','credit',1000,'synthetic_fixture','fixture','phase6');notify pgrst,'reload schema';`,
  ],
  { stdio: 'pipe' }
)
const rpc = (name, args) => call('/rest/v1/rpc/' + name, args, admin.access_token)
for (const code of ['ad_home', 'ad_community', 'ad_community_banner', 'ad_network']) {
  let f = (await rpc('admin_commercial_catalog', {})).items.find((x) => x.code === code)
  if (!f.currentPrice)
    await rpc('admin_publish_commercial_price', {
      p_offering_code: code,
      p_unit_price_cash: '7',
      p_min_days: 1,
      p_max_days: 30,
      p_active_from: null,
      p_expected_revision: f.revision,
      p_request_id: randomUUID(),
      p_reason: 'Preço exclusivamente sintético da stack local Fase 6',
      p_confirm: true,
    })
  f = (await rpc('admin_commercial_catalog', {})).items.find((x) => x.code === code)
  if (!f.salesEnabled)
    await rpc('admin_set_commercial_sales', {
      p_offering_code: code,
      p_enabled: true,
      p_expected_revision: f.revision,
      p_request_id: randomUUID(),
      p_reason: 'Ativação exclusivamente sintética da stack local',
      p_confirm: true,
    })
}
const inv = await rpc('admin_advertising_inventory', {})
for (const p of inv.placements.filter((p) =>
  ['home_banner', 'community_feed', 'community_banner'].includes(p.code)
))
  await rpc('admin_configure_advertising_placement', {
    p_code: p.code,
    p_capacity: Math.max(4, Number(p.capacity)),
    p_sales_enabled: true,
    p_delivery_enabled: true,
    p_expected_revision: p.revision,
    p_reason: 'Capacidade exclusivamente sintética para testes locais',
    p_confirm: true,
  })
mkdirSync('.finance-local', { recursive: true })
writeFileSync(
  '.finance-local/phase6-access.json',
  JSON.stringify({ email, password, owner, admin, adminEmail, adminPassword })
)
console.log(JSON.stringify({ localOnly: true, email, password, route: '/meus-anuncios' }))
