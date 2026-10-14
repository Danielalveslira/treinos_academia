import {spawnSync} from 'node:child_process'
import assert from 'node:assert/strict'
const fixture=`
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('e8100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','aud07perf-'||i||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,10)i;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and u.id::text like 'e8100000-%';
insert into public.communities(id,name,created_by)values('e8200000-0000-0000-0000-000000000001','Quota perf','e8100000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id)select 'e8200000-0000-0000-0000-000000000001',id from public.users where id::text like 'e8100000-%';
set local role authenticated;
do $$declare samples double precision[]:='{}'; t timestamptz; uid uuid; begin
for u in 1..10 loop
 uid:=('e8100000-0000-0000-0000-'||lpad(u::text,12,'0'))::uuid;
 perform set_config('request.jwt.claim.sub',uid::text,true);
 for i in 1..5 loop
  t:=clock_timestamp();
  insert into public.statuses(community_id,author_id,type,text)values('e8200000-0000-0000-0000-000000000001',uid,'text','x');
  samples:=array_append(samples,extract(epoch from clock_timestamp()-t)*1000);
 end loop;
end loop;
raise notice 'MEASURE %',(select jsonb_build_object('samples',count(*),'mean_ms',avg(x),'p95_ms',percentile_cont(.95) within group(order by x)) from unnest(samples)x);
end $$;
reset role; rollback;`
for(const phase of ['before','after']){
 const sql=`begin; ${phase==='before'?'drop trigger statuses_check_publication_rate on public.statuses;':''} ${fixture}`
 const r=spawnSync('docker',['exec','-i','evolutus_homolog_db','psql','-U','supabase_admin','-d','postgres','-X','-q','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'})
 assert.equal(r.status,0,r.stderr)
 console.log(phase,r.stderr.trim())
}
console.log('PASS 50 real-role inserts per phase, all fixtures rolled back')
