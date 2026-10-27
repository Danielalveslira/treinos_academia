// Test fixtures only. Explicit loopback target and local Docker database, never production.
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { jwt } from '../keys.mjs'
const base = 'http://127.0.0.1:55554'
const email = 'admin.financeiro@example.invalid',
  password = 'Evolutus-Local-Fase1!2026'
const service = jwt({ role: 'service_role' }),
  anon = jwt({ role: 'anon' })
const sql = (source) =>
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
      '-X',
      '-tA',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8' }
  ).trim()
const q = (v) => `'${String(v).replaceAll("'", "''")}'`
async function request(path, body, token = service) {
  const r = await fetch(base + path, {
    method: 'POST',
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await r.json()
  if (!r.ok) throw Error(JSON.stringify(d))
  return d
}
// Local existing admin is retained from Phase 1. Reauthentication supplies signed recent AMR.
const session = await request('/auth/v1/token?grant_type=password', { email, password }, anon)
const token = session.access_token,
  uid = session.user.id
const code = 'synthetic_core',
  resource = '73500000-0000-0000-0000-000000000001'
sql(`insert into public.commercial_offerings(code,name,description,integration_ready)values('${code}','Serviço sintético de homologação','Recurso fictício para testar contratação por dias; nenhuma publicação real.',true)on conflict do nothing;
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)values('${resource}','${code}',${q(uid)},1,1,'approved')on conflict do nothing;
do $$begin if not exists(select 1 from public.economy_transactions where user_id=${q(uid)} and natural_key='phase3-preview-seed') then
perform public._wallet_credit_cash(${q(uid)},1000);perform public._ledger_record(${q(uid)},'phase3-preview-seed','cash','credit',1000,'synthetic_fixture','fixture','phase3-preview');end if;end $$;
notify pgrst,'reload schema';`)
const catalog = await request('/rest/v1/rpc/admin_commercial_catalog', {}, token)
let f = catalog.items.find((x) => x.code === code)
if (!f.currentPrice) {
  await request(
    '/rest/v1/rpc/admin_publish_commercial_price',
    {
      p_offering_code: code,
      p_unit_price_cash: '2',
      p_min_days: 1,
      p_max_days: 30,
      p_active_from: null,
      p_expected_revision: f.revision,
      p_request_id: crypto.randomUUID(),
      p_reason: 'Fixture sintética exclusiva do preview local',
      p_confirm: true,
    },
    token
  )
  f = (await request('/rest/v1/rpc/admin_commercial_catalog', {}, token)).items.find(
    (x) => x.code === code
  )
}
if (!f.salesEnabled)
  await request(
    '/rest/v1/rpc/admin_set_commercial_sales',
    {
      p_offering_code: code,
      p_enabled: true,
      p_expected_revision: f.revision,
      p_request_id: crypto.randomUUID(),
      p_reason: 'Ativar somente fixture sintética local',
      p_confirm: true,
    },
    token
  )
mkdirSync('.finance-local', { recursive: true })
writeFileSync(
  '.finance-local/phase3-access.json',
  JSON.stringify({ email, password, resource, code, uid, session })
)
console.log(
  JSON.stringify({
    localOnly: true,
    resource,
    code,
    email,
    seedLedgerKey: 'phase3-preview-seed',
    realCharges: false,
  })
)
