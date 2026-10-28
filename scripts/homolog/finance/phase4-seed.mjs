// Strictly local synthetic fixtures; never accepts an environment/remote URL.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
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
  const raw = await r.text()
  const d = raw ? JSON.parse(raw) : null
  if (!r.ok) throw Error(JSON.stringify(d))
  return d
}
const password = 'Evolutus-Local-Fase4!2026',
  email = `vitrine-${randomUUID()}@example.invalid`
await call('/auth/v1/admin/users', { email, password, email_confirm: true }, service)
const owner = await call('/auth/v1/token?grant_type=password', { email, password })
const otherEmail = `vitrine-outro-${randomUUID()}@example.invalid`
await call('/auth/v1/admin/users', { email: otherEmail, password, email_confirm: true }, service)
const other = await call('/auth/v1/token?grant_type=password', { email: otherEmail, password })
const adminEmail = 'admin.financeiro@example.invalid',
  adminPassword = 'Evolutus-Local-Fase1!2026'
const admin = await call('/auth/v1/token?grant_type=password', {
  email: adminEmail,
  password: adminPassword,
})
// Install the repository's approved legal bundle only in this disposable stack.
const manifest = JSON.parse(readFileSync('legal/manifest.json', 'utf8')),
  documents = JSON.parse(readFileSync('legal/documents.json', 'utf8')),
  digests = JSON.parse(readFileSync('legal/approved-digests.json', 'utf8'))
const q = (value) => "'" + String(value).replaceAll("'", "''") + "'"
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
    input: `insert into public.legal_versions(version,manifest,documents,digest) values(${q(manifest.version)},${q(JSON.stringify(manifest))}::jsonb,${q(JSON.stringify(documents))}::jsonb,${q(digests[manifest.version])}) on conflict do nothing;insert into public.legal_policy(id,version,published,digest,minimum_age) values(true,${q(manifest.version)},true,${q(digests[manifest.version])},12) on conflict(id) do nothing;update public.users set legal_acceptance_version=${q(manifest.version)},legal_acceptance_digest=${q(digests[manifest.version])},legal_acceptance_accepted_at=now() where id in('${owner.user.id}','${other.user.id}','${admin.user.id}');`,
    stdio: ['pipe', 'pipe', 'pipe'],
  }
)
const rpc = (name, args) => call('/rest/v1/rpc/' + name, args, admin.access_token)
const current = await rpc('list_managed_storefronts', { p_admin: true, p_limit: 1 })
await rpc('admin_set_storefront_limits', {
  p_max_products: 10,
  p_max_storefronts: 3,
  p_revision: current.limits.revision,
  p_reason: 'Limites sintéticos exclusivos de homologação local',
  p_confirm: true,
})
const offering = (await rpc('admin_commercial_catalog', {})).items.find(
  (f) => f.code === 'product_storefront'
)
if (!offering.currentPrice)
  await rpc('admin_publish_commercial_price', {
    p_offering_code: 'product_storefront',
    p_unit_price_cash: '3',
    p_min_days: 1,
    p_max_days: 30,
    p_active_from: null,
    p_expected_revision: offering.revision,
    p_request_id: randomUUID(),
    p_reason: 'Tarifa sintética de teste; sem preço oficial',
    p_confirm: true,
  })
const latest = (await rpc('admin_commercial_catalog', {})).items.find(
  (f) => f.code === 'product_storefront'
)
if (!latest.salesEnabled)
  await rpc('admin_set_commercial_sales', {
    p_offering_code: 'product_storefront',
    p_enabled: true,
    p_expected_revision: latest.revision,
    p_request_id: randomUUID(),
    p_reason: 'Ativação apenas para fixtures da stack isolada',
    p_confirm: true,
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
    `update public.users set username='sf_'||left(replace(id::text,'-',''),12) where id in('${uid}','${other.user.id}');select public._wallet_credit_cash('${uid}',1000);select public._ledger_record('${uid}','phase4-preview-seed','cash','credit',1000,'synthetic_fixture','fixture','phase4-preview');`,
  ],
  { stdio: 'pipe' }
)
mkdirSync('.finance-local', { recursive: true })
writeFileSync(
  '.finance-local/phase4-access.json',
  JSON.stringify({ email, password, owner, other, admin, adminEmail, adminPassword })
)
console.log(JSON.stringify({ localOnly: true, email, realCharges: false }))
