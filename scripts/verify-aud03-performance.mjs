// Compare the original migration contract against AUD-03 within rolled-back
// local transactions. No remote endpoint, grants changes, cron or persisted data.
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const sql = input => execFileSync('docker', ['exec', '-i', 'evolutus_homolog_db', 'psql',
  '-U', 'supabase_admin', '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'],
{ input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const baselineRpc = readFileSync('supabase/migrations/20260926000017_poll_results.sql','utf8')
const originalBatch = readFileSync('supabase/migrations/20261017000001_feed_batch_interaction_rpcs.sql','utf8').split('create or replace function public.count_workout_participants_batch')[0]
const seed = `
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('d1000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','aud03bench-'||i||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,200) i;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and u.id::text like 'd1000000-%';
insert into public.communities(id,name,created_by) values('d2000000-0000-0000-0000-000000000001','AUD03 benchmark','d1000000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) select 'd2000000-0000-0000-0000-000000000001',id from public.users where id::text like 'd1000000-%';
insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options)
select ('d3000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'d2000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','poll',now()+interval '1 day','Benchmark?','[{"id":"a","label":"A"},{"id":"b","label":"B"}]' from generate_series(1,20) i;
insert into public.status_votes(status_id,user_id,option_id) select s.id,u.id,'a' from public.statuses s cross join public.users u where s.id::text like 'd3000000-%' and u.id::text like 'd1000000-%';
analyze public.status_votes; analyze public.statuses;
select set_config('request.jwt.claim.sub','d1000000-0000-0000-0000-000000000001',true);
set local role authenticated;
do $$ declare t timestamptz; ms double precision; begin
t:=clock_timestamp();
for i in 1..1000 loop
 insert into public.status_votes(status_id,user_id,option_id) values('d3000000-0000-0000-0000-000000000001','d1000000-0000-0000-0000-000000000001','b')
 on conflict(status_id,user_id) do update set option_id=excluded.option_id;
end loop;
ms:=extract(epoch from clock_timestamp()-t)*1000/1000;
raise notice 'UPSERT_MS %',ms;
t:=clock_timestamp();
for i in 1..100 loop
 perform * from public.get_poll_results('d3000000-0000-0000-0000-000000000001');
end loop;
raise notice 'RESULT_MS %',extract(epoch from clock_timestamp()-t)*1000/100;
t:=clock_timestamp();
for i in 1..100 loop
 perform * from public.get_poll_results_batch(array(select ('d3000000-0000-0000-0000-'||lpad(j::text,12,'0'))::uuid from generate_series(1,20) j));
end loop;
raise notice 'BATCH_MS %',extract(epoch from clock_timestamp()-t)*1000/100;
end $$;
reset role;
rollback;`
// Capture notices on stderr without exposing fixture rows.
for (const phase of ['before','after']) {
  const original = phase === 'before' ? `
drop trigger validate_poll_vote on public.status_votes;
drop policy status_votes_select on public.status_votes;
drop policy status_votes_insert on public.status_votes;
drop policy status_votes_update on public.status_votes;
drop policy status_votes_delete on public.status_votes;
create policy status_votes_all on public.status_votes for all
using(user_id=auth.uid() and public.is_community_member((select community_id from public.statuses where id=status_votes.status_id))) with check(user_id=auth.uid());
${baselineRpc}
${originalBatch}` : ''
  const result = spawnSync('docker', ['exec','-i','evolutus_homolog_db','psql','-U','supabase_admin','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],
    {input:`begin; ${original}\n${seed}`,encoding:'utf8',stdio:['pipe','pipe','pipe']})
  assert.equal(result.status,0,result.stderr)
  console.log(phase, result.stderr.trim())
}
assert.equal(sql("select count(*) from public.status_votes where user_id::text like 'd1000000-%';").trim(),'0')
console.log('PASS benchmark rolled back; 20 polls × 200 voters, 4000 votes')
