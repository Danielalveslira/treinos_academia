// Strict loopback fixtures. Values here are not commercial policy or migrations.
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { jwt } from '../keys.mjs'
const a = JSON.parse(readFileSync('.finance-local/phase4-access.json'))
const base = 'http://127.0.0.1:55554',
  anon = jwt({ role: 'anon' })
const login = await fetch(base + '/auth/v1/token?grant_type=password', {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: a.adminEmail, password: a.adminPassword }),
})
if (!login.ok) throw Error('Local admin login failed')
a.admin = await login.json()
async function rpc(name, args) {
  const r = await fetch(base + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + a.admin.access_token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  const data = await r.json()
  if (!r.ok) throw Error(data.message || 'Local fixture failed')
  return data
}
execFileSync(
  'docker',
  [
    'exec',
    '-i',
    'evolutus_price_phase1_db',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  {
    input: `update public.users set usage_profile='professional' where id='${a.owner.user.id}';update public.users set usage_profile='establishment_owner' where id='${a.other.user.id}';do $$begin if not exists(select 1 from public.economy_transactions where user_id='${a.other.user.id}' and natural_key='phase5-preview-seed') then perform public._wallet_credit_cash('${a.other.user.id}',1000);perform public._ledger_record('${a.other.user.id}','phase5-preview-seed','cash','credit',1000,'synthetic_fixture','fixture','phase5');end if;end$$;`,
    stdio: 'pipe',
  }
)
for (const [code, price] of [
  ['professional_profile', '5'],
  ['establishment_profile', '8'],
]) {
  let f = (await rpc('admin_commercial_catalog', {})).items.find((f) => f.code === code)
  await rpc('admin_publish_commercial_price', {
    p_offering_code: code,
    p_unit_price_cash: price,
    p_min_days: 1,
    p_max_days: 30,
    p_active_from: null,
    p_expected_revision: f.revision,
    p_request_id: crypto.randomUUID(),
    p_reason: 'Tarifa estritamente sintética para homologação local da Fase 5',
    p_confirm: true,
  })
  f = (await rpc('admin_commercial_catalog', {})).items.find((f) => f.code === code)
  if (!f.salesEnabled)
    await rpc('admin_set_commercial_sales', {
      p_offering_code: code,
      p_enabled: true,
      p_expected_revision: f.revision,
      p_request_id: crypto.randomUUID(),
      p_reason: 'Ativação exclusiva na stack sintética local',
      p_confirm: true,
    })
}
writeFileSync(
  '.finance-local/phase5-access.json',
  JSON.stringify({ ...a, professional: a.owner, establishment: a.other })
)
console.log(
  JSON.stringify({
    localOnly: true,
    professional: a.owner.user.email,
    establishment: a.other.user.email,
    admin: a.adminEmail,
    realCharges: false,
  })
)
