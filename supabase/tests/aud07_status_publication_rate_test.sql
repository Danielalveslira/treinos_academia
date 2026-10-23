\ir _helpers/auth_session.sql
begin;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='private.status_publication_limits'::regclass),'quota RLS enabled');
select ok(not has_table_privilege('authenticated','private.status_publication_limits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'client cannot inspect or reset quota');
select ok(not has_table_privilege('anon','private.status_publication_limits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'),'anon cannot inspect or reset quota');
select ok(not has_function_privilege('authenticated','private.enforce_status_publication_rate()','EXECUTE'),'trigger is not an exposed RPC');
select is((select count(*)::int from pg_policies where schemaname='private' and tablename='status_publication_limits'),0,'no permissive quota policies');
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('e7100000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','aud07-tap-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and u.id::text like 'e7100000-%';
insert into public.communities(id,name,created_by)values('e7200000-0000-0000-0000-000000000001','Quota fixture','e7100000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id)values('e7200000-0000-0000-0000-000000000001','e7100000-0000-0000-0000-000000000001');
set local role authenticated;
select pg_temp.set_test_user('e7100000-0000-0000-0000-000000000001',true);
select lives_ok($$insert into public.statuses(community_id,author_id,type,text)select 'e7200000-0000-0000-0000-000000000001','e7100000-0000-0000-0000-000000000001','text','x' from generate_series(1,5)$$,'five posts accepted');
select throws_ok($$insert into public.statuses(community_id,author_id,type,text)values('e7200000-0000-0000-0000-000000000001','e7100000-0000-0000-0000-000000000001','text','x')$$,'PT429','PUBLICATION_RATE_LIMITED','sixth post denied');
select throws_ok($$select * from private.status_publication_limits$$,'42501',null,'quota contents protected');
reset role;
select is((select minute_count from private.status_publication_limits where user_id='e7100000-0000-0000-0000-000000000001'),5,'refused operation not counted');
select is((select count(*)::int from public.statuses where author_id='e7100000-0000-0000-0000-000000000001'),5,'quota exactly equals committed posts');
delete from public.statuses where author_id='e7100000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$insert into public.statuses(community_id,author_id,type,text)values('e7200000-0000-0000-0000-000000000001','e7100000-0000-0000-0000-000000000001','text','x')$$,'PT429','PUBLICATION_RATE_LIMITED','deleting posts cannot reset history');
select pg_temp.set_test_user('e7100000-0000-0000-0000-000000000002',true);
select throws_ok($$insert into public.statuses(community_id,author_id,type,text)values('e7200000-0000-0000-0000-000000000001','e7100000-0000-0000-0000-000000000002','text','x')$$,'42501',null,'nonmember remains denied');
reset role;
select is((select count(*)::int from private.status_publication_limits where user_id='e7100000-0000-0000-0000-000000000002'),0,'nonmember attempts do not create counters');
select is((select count(*)::int from pg_trigger where tgrelid='public.statuses'::regclass and tgname='statuses_check_publication_rate' and tgenabled='O'),1,'one active AFTER INSERT quota trigger');
select * from finish();
rollback;
