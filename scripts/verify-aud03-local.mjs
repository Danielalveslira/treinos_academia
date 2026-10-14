// Fixed local endpoints, real Auth sessions, synthetic fixtures; never reads .env.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createClient } from '@supabase/supabase-js'
import { jwt } from './homolog/keys.mjs'
import { startAudGateway } from './homolog/aud-local-gateway.mjs'

const before = process.argv.includes('--before')
const sql = (input) => execFileSync('docker', ['exec', '-i', 'evolutus_homolog_db',
  'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
{ input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()
const gateway = await startAudGateway()
const url = 'http://127.0.0.1:55439'
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(url, jwt({ role: 'service_role' }), opts)
const ids = Array.from({ length: 18 }, () => randomUUID())
const [owner, member, outsider, moderator, superadmin, community, otherCommunity,
  poll, otherPoll, text, expired, permanent, promoted, fakePromotion, malformed, deleted, missing] = ids
const users = [owner, member, outsider, moderator, superadmin]
const good = ({ data, error }) => { assert.equal(error, null); return data }
let checks = 0
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`) }
const sessions = []
const timings = []
try {
  assert.equal(sql("select current_setting('cron.launch_active_jobs')"), 'off')
  assert.equal(sql('select enabled from public.status_expiration_control where id'), 'f')
  for (const id of users) {
    const email = `aud03-${id}@example.invalid`
    good(await admin.auth.admin.createUser({ id, email, password: 'Synthetic-Aud03-914!', email_confirm: true }))
    const client = createClient(url, jwt({ role: 'anon' }), opts)
    good(await client.auth.signInWithPassword({ email, password: 'Synthetic-Aud03-914!' }))
    sessions.push(client)
  }
  const [, voter, stranger, mod, root] = sessions
  sql(`update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
    from public.legal_policy p where p.id and p.published and u.id in (${users.map(x => `'${x}'`).join(',')});
    update public.users set role='superadmin' where id='${superadmin}';
    insert into public.communities(id,name,created_by,owner_id) values
    ('${community}','AUD03 synthetic','${owner}','${moderator}'),('${otherCommunity}','AUD03 other','${owner}','${owner}');
    insert into public.community_members(community_id,user_id) values
    ('${community}','${member}'),('${community}','${moderator}');
    insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options)
    select id::uuid,'${community}','${owner}','poll',now()+interval '1 day','AUD03?',
    '[{"id":"a","label":"A"},{"id":"b","label":"B"}]'::jsonb
    from unnest(array['${poll}','${expired}','${permanent}','${promoted}','${fakePromotion}','${malformed}','${deleted}']) id;
    insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options)
    values('${otherPoll}','${otherCommunity}','${owner}','poll',now()+interval '1 day','Other?',
    '[{"id":"other","label":"Other"},{"id":"second","label":"Second"}]');
    insert into public.statuses(id,community_id,author_id,type,expires_at,text)
    values('${text}','${community}','${owner}','text',now()+interval '1 day','AUD03 text');
    update public.statuses set expires_at=now()-interval '1 day' where id in ('${expired}','${promoted}','${fakePromotion}');
    update public.statuses set retention_mode='no_auto_expiration',expires_at=null where id='${permanent}';
    update public.statuses set poll_options='[{"id":12,"label":"numeric"},null]' where id='${malformed}';
    update public.statuses set promoted=true,promoted_until=now()+interval '3 days' where id='${fakePromotion}';
    insert into public.promotions(owner_id,request_id,target_type,target_id,community_id,package_id,cash_amount,duration_days,started_at,expires_at)
    values('${owner}','aud03:${promoted}','post','${promoted}','${community}','post_boost_3d',25,3,now()-interval '1 day',now()+interval '2 days');
    delete from public.statuses where id='${deleted}';`)
  const vote = (client, statusId, optionId = 'a', userId = member) => client.from('status_votes')
    .insert({ status_id: statusId, user_id: userId, option_id: optionId })
  const denied = async (result, label) => check(!!(await result).error, label)
  const cases = [
    [stranger, poll, 'a', outsider, 'nonmember INSERT'],
    [voter, poll, 'invented', member, 'invented option'],
    [voter, poll, 'other', member, 'option from other poll'],
    [voter, text, 'a', member, 'text publication'],
    [voter, expired, 'a', member, 'expired publication'],
    [voter, fakePromotion, 'a', member, 'cached promotion without valid history'],
    [voter, malformed, '12', member, 'nonstring option in JSON'],
  ]
  for (const [client, id, option, uid, label] of cases) {
    const result = await vote(client, id, option, uid)
    check(before ? !result.error : !!result.error, `${before ? 'REPRODUCED' : 'blocked'} ${label}`)
    sql(`delete from public.status_votes where status_id='${id}' and user_id='${uid}';`)
  }
  if (before) {
    sql(`insert into public.status_votes(status_id,user_id,option_id) values('${poll}','${owner}','a');`)
    const anon = createClient(url, jwt({ role: 'anon' }), opts)
    check(!!(await anon.rpc('get_poll_results', { p_status_id: poll })).error, 'anon aggregate leak hypothesis rejected')
    console.log(`BEFORE ${checks - 1} confirmed defects; 1 rejected hypothesis`)
  } else {
    const anon = createClient(url, jwt({ role: 'anon' }), opts)
    await denied(vote(anon, poll), 'anon INSERT')
    await denied(anon.from('status_votes').select('*'), 'anon SELECT grant')
    await denied(anon.from('status_votes').update({ option_id: 'b' }).eq('status_id', poll), 'anon UPDATE grant')
    await denied(anon.from('status_votes').delete().eq('status_id', poll), 'anon DELETE grant')
    await denied(anon.from('status_votes').upsert({ status_id: poll, user_id: member, option_id: 'a' }), 'anon UPSERT grant')
    for (const rpc of ['get_poll_results', 'get_poll_results_batch'])
      await denied(anon.rpc(rpc, rpc.endsWith('batch') ? { p_status_ids: [poll] } : { p_status_id: poll }), `anon ${rpc}`)
    const hiddenValid = await vote(stranger, poll, 'a', outsider)
    const hiddenInvalid = await vote(stranger, poll, 'invented', outsider)
    check(hiddenValid.error?.code === '42501', 'nonmember valid option returns permission error')
    check(hiddenInvalid.error?.code === '42501', 'nonmember invalid option cannot reveal option validity')
    await denied(vote(voter, poll, 'a', owner), 'third party identity')
    await denied(vote(voter, missing), 'nonexistent status')
    await denied(vote(voter, deleted), 'deleted status')
    await denied(vote(voter, poll, null), 'null option')
    await denied(vote(voter, poll, { id: 'a' }), 'malformed API option')
    await denied(vote(root, poll, 'a', superadmin), 'superadmin without membership preserves poll contract')
    sql(`insert into public.community_members(community_id,user_id) values('${community}','${superadmin}');`)
    good(await vote(root, permanent, 'a', superadmin))
    check(true, 'superadmin with membership votes as self')
    good(await root.from('status_votes').delete().eq('status_id', permanent))
    const noIdentity = createClient(url, jwt({ role: 'authenticated' }), opts)
    await denied(vote(noIdentity, poll), 'authenticated token without identity INSERT')
    check(good(await noIdentity.rpc('get_poll_results_batch', { p_status_ids: [poll] })).length === 0, 'token without identity batch results')
    good(await vote(mod, poll, 'b', moderator))
    check(true, 'authorized moderator votes as self')
    for (const id of [poll, permanent, promoted]) {
      const start = performance.now()
      good(await vote(voter, id))
      timings.push(performance.now() - start)
      check(true, `legitimate ${id === poll ? 'poll' : id === permanent ? 'permanent' : 'verified promoted'} vote`)
    }
    await denied(vote(voter, poll), 'duplicate INSERT')
    check(good(await voter.from('status_votes').select('*').eq('status_id', poll)).length === 1, 'SELECT only own vote')
    await denied(voter.from('status_votes').update({ user_id: owner }).eq('status_id', poll), 'UPDATE identity grant')
    await denied(voter.from('status_votes').update({ status_id: otherPoll }).eq('status_id', poll), 'UPDATE destination grant')
    await denied(voter.from('status_votes').update({ created_at: '2099-01-01' }).eq('status_id', poll), 'UPDATE timestamp grant')
    await denied(voter.from('status_votes').update({ option_id: 'invented' }).eq('status_id', poll), 'invalid direct UPDATE')
    check(good(await stranger.from('status_votes').delete().eq('status_id', poll).select()).length === 0, 'nonmember DELETE changes zero rows')
    sql(`update public.communities set post_access='admins' where id='${community}';`)
    good(await voter.from('status_votes').upsert({ status_id: permanent, user_id: member, option_id: 'b' }))
    check(true, 'admins-only posting does not revoke member poll access')
    await denied(voter.from('status_votes').upsert({ status_id: poll, user_id: member, option_id: 'invented' }), 'invalid UPSERT')
    // Existing API supports replacement and cancellation; the UI still offers one choice.
    good(await voter.from('status_votes').upsert({ status_id: poll, user_id: member, option_id: 'b' }))
    check(good(await voter.rpc('get_poll_results', { p_status_id: poll }))[0].votes === 2, 'swap keeps exact aggregate')
    const races = await Promise.all(Array.from({ length: 12 }, (_, i) => voter.from('status_votes')
      .upsert({ status_id: poll, user_id: member, option_id: i % 2 ? 'a' : 'b' })))
    races.forEach(good)
    check(sql(`select count(*) from public.status_votes where status_id='${poll}'`) === '2', 'concurrent UPSERT uniqueness')
    good(await voter.from('status_votes').delete().eq('status_id', poll))
    check(good(await voter.rpc('get_poll_results_batch', { p_status_ids: [poll, otherPoll] })).reduce((n, r) => n + r.votes, 0) === 1, 'cancel updates totals and batch omits foreign poll')
    good(await vote(voter, poll))
    for (const state of ['banned', 'removed', 'disabled', 'inactive', 'deleting', 'restricted', 'terms']) {
      const change = {
        banned: `insert into public.community_restrictions(community_id,user_id,reason) values('${community}','${member}','AUD03');`,
        removed: `delete from public.community_members where community_id='${community}' and user_id='${member}';`,
        disabled: `update public.users set account_status='disabled' where id='${member}';`,
        inactive: `update public.communities set is_active=false where id='${community}';`,
        deleting: `update public.users set account_status='deleting' where id='${member}';`,
        restricted: `insert into public.account_restrictions(user_id,action,until) values('${member}','temporary_suspension',now()+interval '1 day');`,
        terms: `update public.users set legal_acceptance_digest=null where id='${member}';`,
      }[state]
      sql(change)
      await denied(vote(voter, permanent), `${state} INSERT`)
      await denied(voter.from('status_votes').upsert({ status_id: poll, user_id: member, option_id: 'b' }), `${state} UPSERT`)
      check(good(await voter.from('status_votes').select('*')).length === 0, `${state} SELECT hides vote`)
      check(good(await voter.from('status_votes').update({ option_id: 'b' }).eq('status_id', poll).select()).length === 0, `${state} UPDATE changes zero rows`)
      check(good(await voter.from('status_votes').delete().eq('status_id', poll).select()).length === 0, `${state} DELETE changes zero rows`)
      await denied(voter.rpc('get_poll_results', { p_status_id: poll }), `${state} single RPC`)
      check(good(await voter.rpc('get_poll_results_batch', { p_status_ids: [poll] })).length === 0, `${state} batch RPC`)
      sql(`delete from public.community_restrictions where user_id='${member}';
        delete from public.account_restrictions where user_id='${member}';
        insert into public.community_members(community_id,user_id) values('${community}','${member}') on conflict do nothing;
        update public.users u set account_status='active',legal_acceptance_digest=p.digest from public.legal_policy p where p.id and u.id='${member}';
        update public.communities set is_active=true where id='${community}';`)
    }
    sql(`update public.statuses set expires_at=now()-interval '1 second' where id='${poll}';`)
    await denied(voter.from('status_votes').upsert({ status_id: poll, user_id: member, option_id: 'b' }), 'expiry blocks existing vote UPSERT')
    check(good(await voter.from('status_votes').delete().eq('status_id', poll).select()).length === 0, 'expiry blocks cancellation')
    check(good(await voter.from('status_votes').update({ option_id: 'b' }).eq('status_id', poll).select()).length === 0, 'expiry blocks direct UPDATE')
    check(good(await voter.from('status_votes').select('*').eq('status_id', poll)).length === 0, 'expiry hides own SELECT')
    await denied(voter.rpc('get_poll_results', { p_status_id: poll }), 'expiry hides single results')
    check(good(await voter.rpc('get_poll_results_batch', { p_status_ids: [poll] })).length === 0, 'expiry hides batch results')
    console.log(`AFTER ${checks} checks; vote HTTP ms ${JSON.stringify(timings.map(x => +x.toFixed(2)))}`)
  }
} finally {
  // Delete only this run's synthetic fixtures. No deletion workers or financial RPCs.
  sql(`delete from public.promotions where request_id='aud03:${promoted}';
    delete from public.communities where id in ('${community}','${otherCommunity}');`)
  for (const id of users) good(await admin.auth.admin.deleteUser(id))
  await new Promise(resolve => gateway.close(resolve))
}
