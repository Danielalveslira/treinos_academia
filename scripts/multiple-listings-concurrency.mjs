// Independent committed sessions against an explicitly disposable local database.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
const db = process.env.PG_TEST_CONTAINER || 'supabase_db_treinos_academia'
if (!['supabase_db_treinos_academia', 'evolutus_price_phase1_db'].includes(db))
  throw Error('DISPOSABLE_DATABASE_REQUIRED')
const execute = promisify(execFile),
  q = (v) => "'" + String(v).replaceAll("'", "''") + "'"
async function sql(s) {
  const { stdout } = await execute('docker', [
    'exec',
    '-i',
    db,
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-XtA',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    s,
  ])
  return stdout
    .trim()
    .split('\n')
    .filter((s) => !['BEGIN', 'COMMIT', 'SET'].includes(s))
    .at(-1)
}
const admin = randomUUID(),
  owners = [randomUUID(), randomUUID()],
  sessions = new Map([admin, ...owners].map((id) => [id, randomUUID()]))
const claims = (id) =>
  `select set_config('request.jwt.claim.sub',${q(id)},true);select set_config('request.jwt.claims',${q(JSON.stringify({ sub: id, role: 'authenticated', session_id: sessions.get(id), amr: [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) }] }))},true);set local role authenticated;`
const as = (id, s) => sql(`begin;${claims(id)}${s};commit;`)
for (const id of [admin, ...owners])
  await sql(
    `insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)values(${q(id)},'authenticated','authenticated',${q(id + '@example.invalid')},'x',now(),'{}','{}',now(),now());insert into auth.sessions(id,user_id,created_at,updated_at)values(${q(sessions.get(id))},${q(id)},now(),now());update public.users set usage_profile='professional',legal_acceptance_version=(select version from public.legal_policy where id),legal_acceptance_digest=(select digest from public.legal_policy where id) where id=${q(id)}`
  )
await sql(`update public.users set role='superadmin' where id=${q(admin)}`)
await sql("insert into public.professional_listing_limits(kind,max_per_owner)values('professional',10),('space',10) on conflict(kind)do update set max_per_owner=10")
const owner=owners[0],offering='establishment_profile'
let policy=JSON.parse(await as(admin,'select public.get_professional_listing_limits()')).find(r=>r.kind==='space')
await as(admin,`select public.admin_set_professional_listing_limit('space',3,${policy.revision},'Synthetic concurrent creation limit')`)
const create=key=>as(owner,`select public.create_professional_listing('space',${q(key)})`)
const pair=await Promise.all([create(randomUUID()),create(randomUUID())]);const resources=pair.map(v=>JSON.parse(v).listingId)
assert.equal(new Set(resources).size,2)
const duplicateKey=randomUUID(),replays=await Promise.all(Array.from({length:6},()=>create(duplicateKey)))
assert.equal(new Set(replays.map(r=>JSON.parse(r).listingId)).size,1)
assert.equal(replays.filter(r=>JSON.parse(r).created).length,1)
policy=JSON.parse(await as(admin,'select public.get_professional_listing_limits()')).find(r=>r.kind==='space')
await as(admin,`select public.admin_set_professional_listing_limit('space',4,${policy.revision},'Synthetic last-slot race')`)
const slot=await Promise.allSettled([create(randomUUID()),create(randomUUID())]);assert.equal(slot.filter(r=>r.status==='fulfilled').length,1);assert.match(slot.find(r=>r.status==='rejected').reason.stderr,/LISTING_LIMIT_REACHED/)
const profile=JSON.parse(await as(owner,`select public.create_professional_listing('professional',${q(randomUUID())})`)).listingId
assert.ok(profile)
const revision=await sql(`select revision from public.commercial_offerings where code=${q(offering)}`)
await as(admin,`select public.admin_publish_commercial_price(${q(offering)},'3',1,30,null,${revision},${q(randomUUID())},'Synthetic shared-wallet race price',true)`)
await sql(`update public.commercial_offerings set sales_enabled=true where code=${q(offering)}`)
const data={kind:'space',displayName:'Concurrent establishment',bio:'Complete synthetic concurrent description',categoryKey:'academia',modalityKeys:['musculacao'],city:'São Paulo',uf:'SP',serviceMode:'in_person'}
for(const id of resources){await as(owner,`select public.save_professional_listing_draft(${q(id)},${q(JSON.stringify(data))},0);select public.set_professional_listing_editorial(${q(id)},1,'submitted')`);await as(admin,`select public.set_professional_listing_editorial(${q(id)},2,'approved','Synthetic independent approval')`)}
await sql(`select public._wallet_credit_cash(${q(owner)},100);select public._ledger_record(${q(owner)},'multiple-race-seed','cash','credit',100,'synthetic','fixture','phase51')`)
const quote=async(id,days)=>JSON.parse(await as(owner,`select public.quote_commercial_order(${q(id)},${q(days)},${q(randomUUID())})`)),confirm=o=>as(owner,`select public.confirm_commercial_order(${q(o.id)},true)`)
const orders=await Promise.all(resources.map(id=>quote(id,'30'))),payments=await Promise.allSettled(orders.map(confirm));assert.equal(payments.filter(r=>r.status==='fulfilled').length,1);assert.match(payments.find(r=>r.status==='rejected').reason.stderr,/Saldo de EvoCash insuficiente/)
const paid=JSON.parse(payments.find(r=>r.status==='fulfilled').value),unpaid=resources.find(id=>id!==paid.resourceId)
await Promise.all(Array.from({length:6},()=>confirm(paid)))
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`),'10')
assert.equal(await sql(`select private.commercial_resource_visible(${q(unpaid)})`),'f')
const renewal=await quote(paid.resourceId,'1');await Promise.all(Array.from({length:6},()=>confirm(renewal)))
const separate=await Promise.all([quote(paid.resourceId,'1'),quote(paid.resourceId,'1')]);await Promise.all(separate.map(confirm))
assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`),'1')
assert.equal(await sql(`select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=${q(paid.resourceId)}`),'2851200')
const rev=id=>sql(`select version from public.professional_listing_drafts where listing_id=${q(id)}`)
const before=await rev(paid.resourceId),edits=await Promise.allSettled([1,2].map(n=>as(owner,`select public.save_professional_listing_draft(${q(paid.resourceId)},${q(JSON.stringify({...data,displayName:'Race '+n}))},${before})`)))
assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);assert.match(edits.find(r=>r.status==='rejected').reason.stderr,/EDITORIAL_REVISION_CONFLICT/)
await as(owner,`select public.set_professional_listing_editorial(${q(paid.resourceId)},${await rev(paid.resourceId)},'submitted')`)
const submitted=await rev(paid.resourceId)
const editing=as(owner,`set local application_name='phase51-edit-held';select public.save_professional_listing_draft(${q(paid.resourceId)},${q(JSON.stringify({...data,displayName:'Newer than administrative revision'}))},${submitted});select pg_sleep(1)`)
let held=false;for(let i=0;i<100;i++){if(await sql("select exists(select 1 from pg_stat_activity where application_name='phase51-edit-held' and wait_event='PgSleep')")==='t'){held=true;break}await new Promise(r=>setTimeout(r,10))}assert.ok(held,'edit transaction reached its deterministic hold point')
const approval=await Promise.allSettled([as(admin,`select public.set_professional_listing_editorial(${q(paid.resourceId)},${submitted},'approved','Concurrent stale administrative approval')`)]);await editing;assert.equal(approval[0].status,'rejected');assert.match(approval[0].reason.stderr,/EDITORIAL_REVISION_CONFLICT/)
await Promise.all(resources.map(async(id,i)=>as(owner,`select public.save_professional_listing_draft(${q(id)},${q(JSON.stringify({...data,displayName:'Independent '+i}))},${await rev(id)})`)))
for(const [i,id]of resources.entries())assert.equal(await sql(`select display_name from public.professional_listing_drafts where listing_id=${q(id)}`),'Independent '+i)
await sql(`select public._wallet_credit_cash(${q(owner)},10);select public._ledger_record(${q(owner)},'multiple-race-topup','cash','credit',10,'synthetic','fixture','phase51')`)
const pending=await quote(paid.resourceId,'1'),suspend=as(admin,`set local application_name='phase51-suspension-held';select public.set_professional_listing_editorial(${q(paid.resourceId)},${await rev(paid.resourceId)},'suspended','Synthetic pending-payment suspension');select pg_sleep(1)`)
held=false;for(let i=0;i<100;i++){if(await sql("select exists(select 1 from pg_stat_activity where application_name='phase51-suspension-held' and wait_event='PgSleep')")==='t'){held=true;break}await new Promise(r=>setTimeout(r,10))}assert.ok(held)
const denied=await Promise.allSettled([suspend,confirm(pending)]);assert.equal(denied[1].status,'rejected');assert.match(denied[1].reason.stderr,/RESOURCE_NOT_ELIGIBLE/);assert.equal(await sql(`select cash_balance from public.wallets where user_id=${q(owner)}`),'11')
assert.equal(await sql(`select moderation_state from private.commercial_resources where id=${q(unpaid)}`),'approved')
const result={passed:true,localOnly:true,sameOwner:true,parallelCreationsDistinct:true,creationReplaySingleResource:true,lastSlotRaceSingleWinner:true,professionalAndMultipleEstablishments:true,oneAffordableDebitAcrossResources:true,paymentReplaysDebitOnce:true,unpaidResourceNeverPublished:true,renewalReplaysDebitOnce:true,independentRenewalsAppendDuration:true,editRaceSingleWinner:true,approvalCannotOverwriteNewerEdit:true,parallelResourcesStayIndependent:true,suspensionBlocksPayment:true,suspensionDoesNotAffectOtherResource:true,remainingBalance:11}
const dir=process.env.FINANCE_EVIDENCE_DIR||'docs/finance-restructure/phase5/evidence51';mkdirSync(dir,{recursive:true});writeFileSync(dir+'/multiple-concurrency.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
