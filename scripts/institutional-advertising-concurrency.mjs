// Two administrative activations compete for one real PostgreSQL placement slot.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'

const container = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_ads_pg'].includes(container))
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0]
if (!/supabase\/postgres:17\./.test(info.Config.Image)) throw Error('LOCAL_POSTGRES_REQUIRED')
const run = promisify(execFile)
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`
async function sql(source) {
  const { stdout } = await run('docker', [
    'exec',
    container,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-X',
    '-tA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    source,
  ])
  return stdout.trim().split('\n').at(-1)
}
const admin = randomUUID()
const session = randomUUID()
const ids = [randomUUID(), randomUUID()]
const claims = JSON.stringify({ sub: admin, role: 'authenticated', session_id: session })
const asAdmin = (statement) =>
  sql(
    `begin;select set_config('request.jwt.claim.sub',${quote(admin)},true);select set_config('request.jwt.claims',${quote(claims)},true);set local role authenticated;${statement};commit;`
  )
const payload = JSON.stringify({
  partnerName: 'Marca sintética',
  title: 'Teste de concorrência',
  description: '',
  imageUrl: '',
  ctaLabel: '',
  ctaType: 'external',
  ctaTarget: '',
  expiresAt: '',
  placements: [{ code: 'progress_banner', contextId: null }],
})
const original = (
  await sql(
    "select capacity||','||delivery_enabled from public.advertising_placements where code='progress_banner'"
  )
).split(',')
await sql(
  `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values(${quote(admin)},'authenticated','authenticated',${quote(admin + '@example.invalid')},'x',now(),'{}','{}',now(),now())`
)
await sql(
  `insert into auth.sessions(id,user_id,created_at,updated_at) values(${quote(session)},${quote(admin)},now(),now());update public.users set role='superadmin' where id=${quote(admin)}`
)
assert.equal(
  await sql(
    "select private.advertising_peak('progress_banner','00000000-0000-0000-0000-000000000000',now(),'infinity')"
  ),
  '0',
  'isolated progress inventory required'
)
await sql(
  "update public.advertising_placements set capacity=1,delivery_enabled=true where code='progress_banner'"
)
try {
  for (const id of ids)
    await asAdmin(
      `select public.admin_save_institutional_ad(${quote(id)},0,${quote(payload)}::jsonb)`
    )
  const race = await Promise.allSettled(
    ids.map((id) => asAdmin(`select public.admin_set_institutional_ad_active(${quote(id)},1,true)`))
  )
  assert.equal(
    race.filter((result) => result.status === 'fulfilled').length,
    1,
    'one activation wins'
  )
  assert.match(
    race.find((result) => result.status === 'rejected').reason.stderr,
    /AD_CAPACITY_REACHED:progress_banner/
  )
  assert.equal(
    await sql(
      `select count(*) from private.institutional_ad_state where ad_id in(${ids.map(quote).join(',')}) and active`
    ),
    '1'
  )
  assert.equal(
    await sql(
      "select private.advertising_peak('progress_banner','00000000-0000-0000-0000-000000000000',now(),'infinity')"
    ),
    '1'
  )
  assert.equal(
    await sql(
      `select count(*) from public.commercial_orders where resource_id in(${ids.map(quote).join(',')})`
    ),
    '0'
  )
  console.log('institutional activation race: one winner, no capacity or financial leak')
} finally {
  for (const id of ids) {
    const row = await sql(
      `select active::text||','||revision from private.institutional_ad_state where ad_id=${quote(id)}`
    )
    if (!row) continue
    const [active, revision] = row.split(',')
    const next = active === 'true' ? Number(revision) + 1 : Number(revision)
    if (active === 'true')
      await asAdmin(
        `select public.admin_set_institutional_ad_active(${quote(id)},${revision},false)`
      )
    await asAdmin(`select public.admin_delete_institutional_ad(${quote(id)},${next})`)
  }
  await sql(
    `update public.advertising_placements set capacity=${Number(original[0])},delivery_enabled=${original[1]} where code='progress_banner'`
  )
}
