begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('84000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','expiry-'||n||'@example.invalid','unused',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now() from public.legal_policy p where p.id and p.published and u.id::text like '84000000%';
insert into public.communities(id,name,created_by,owner_id) values('85000000-0000-0000-0000-000000000001','Expiry synthetic','84000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) values('85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000002');
create temp table fixture(name text primary key,id uuid default gen_random_uuid());
insert into fixture(name) select unnest(array['text','photo','poll','workout','achievement','permanent','active','ended','cancelled','invalid','flags','future_workout','support','failure','future','wrong_owner','wrong_target','wrong_community','future_start']);
insert into public.statuses(id,community_id,author_id,type,expires_at,text)
select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','text',now()-interval '1 day',name from fixture where name not in ('photo','poll','workout','achievement','future_workout');
insert into public.statuses(id,community_id,author_id,type,expires_at,photo_path)
select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','photo',now()-interval '1 day','statusPhotos/85000000-0000-0000-0000-000000000001/'||id||'.webp' from fixture where name='photo';
insert into public.statuses(id,community_id,author_id,type,expires_at,poll_question,poll_options)
select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','poll',now()-interval '1 day','Question?','[{"id":"0","label":"a"},{"id":"1","label":"b"}]' from fixture where name='poll';
insert into public.statuses(id,community_id,author_id,type,expires_at,workout_title,workout_date,workout_location)
select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','workout',now()-interval '1 day','Workout',case when name='future_workout' then now()+interval '1 day' else now()-interval '1 day' end,'Gym' from fixture where name in ('workout','future_workout');
insert into public.statuses(id,community_id,author_id,type,expires_at,achievement_day,achievement_text)
select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','achievement',now()-interval '1 day','2026-10-10','Achievement' from fixture where name='achievement';
update public.statuses set retention_mode='no_auto_expiration',expires_at=null where id=(select id from fixture where name='permanent');
update public.statuses set expires_at=now()+interval '1 day' where id=(select id from fixture where name='future');
insert into public.promotions(owner_id,request_id,target_type,target_id,community_id,package_id,cash_amount,duration_days,status,started_at,expires_at,cancelled_at)
select case when name='wrong_owner' then '84000000-0000-0000-0000-000000000002'::uuid else '84000000-0000-0000-0000-000000000001'::uuid end,name,
 case when name='wrong_target' then 'community' else 'post' end,id,
 case when name='wrong_community' then gen_random_uuid() else '85000000-0000-0000-0000-000000000001'::uuid end,
 'post_boost_3d',25,3,case when name='cancelled' then 'cancelled' when name='invalid' then 'target_removed' else 'active' end,
 case when name='future_start' then now()+interval '1 day' else now()-interval '2 days' end,
 case when name='ended' then now()-interval '1 second' else now()+interval '1 day' end,
 case when name='cancelled' then now() end
from fixture where name in ('active','ended','cancelled','invalid','wrong_owner','wrong_target','wrong_community','future_start');
update public.statuses s set active_promotion_id=p.id,promoted=true,promoted_until=p.expires_at from public.promotions p where p.target_id=s.id;
update public.statuses set promoted=true,promoted_until=now()+interval '20 days' where id=(select id from fixture where name='flags');
insert into public.support_requests(user_id,kind,message,status_id) values('84000000-0000-0000-0000-000000000002','report','Synthetic open support case',(select id from fixture where name='support'));
insert into public.status_votes(status_id,user_id,option_id) select id,'84000000-0000-0000-0000-000000000002','0' from fixture where name='poll';
insert into public.status_participants(status_id,user_id) select id,'84000000-0000-0000-0000-000000000002' from fixture where name='workout';
insert into public.post_comments(id,status_id,author_id,root_comment_id,body,client_request_id)
select id,(select id from fixture where name='text'),'84000000-0000-0000-0000-000000000002',id,'Synthetic comment',gen_random_uuid() from (select gen_random_uuid() id)x;
insert into public.economy_transactions(user_id,natural_key,asset,direction,amount,reason,reference_type,reference_id)
select '84000000-0000-0000-0000-000000000001','promote:'||id,'cash','debit',cash_amount,'promotion_purchase','promotion',id::text from public.promotions where request_id in (select name from fixture);
insert into public.cash_purchases(user_id,request_id,package_id,package_label,cash_amount,amount_centavos,status,payment_provider)
values('84000000-0000-0000-0000-000000000001','expiry-test','pack_25','Synthetic',25,590,'credited','mercadopago');
create temp table finance_before as select
 (select jsonb_agg(to_jsonb(t) order by id) from public.economy_transactions t) ledger,
 (select jsonb_agg(to_jsonb(t) order by id) from public.cash_purchases t) purchases,
 (select jsonb_agg(to_jsonb(t)-'status'-'cancelled_at'-'cancelled_by'-'cancel_reason' order by id) from public.promotions t) promotions;
select ok(not (select enabled from public.status_expiration_control where id),'install paused');
select is(public.process_expired_statuses()->>'paused','true','paused routine never deletes');
select throws_ok($$select public.process_expired_statuses(101)$$,'P0001','INVALID_BATCH_SIZE','bounded batch');
select is((select count(*)::integer from public.status_expiration_queue),18,'permanent excluded from queue');
select ok((select publication_expires_at>now() from public.status_publications where id=(select id from fixture where name='active')),'expired paid post remains visible');
select ok((select verified_promoted_until is null from public.status_publications where id=(select id from fixture where name='cancelled')),'cancelled flags do not buy visibility');
select ok(not private.comments_open((select s from public.statuses s where id=(select id from fixture where name='flags'))),'forged flag cannot open comments');
select ok(private.comments_open((select s from public.statuses s where id=(select id from fixture where name='active'))),'paid promotion opens comments');
select ok(private.comments_open((select s from public.statuses s where id=(select id from fixture where name='permanent'))),'permanent comments stay open');
-- A live poll can carry a legacy/shared photo reference; preserve its bytes.
insert into public.statuses(community_id,author_id,type,expires_at,poll_question,poll_options,photo_path)
select '85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','poll',now()+interval '1 day','Shared valid reference','[{"id":"0","label":"a"},{"id":"1","label":"b"}]','statusPhotos/85000000-0000-0000-0000-000000000001/'||id||'.webp' from fixture where name='photo';
-- A partial failure must roll back that status and all capture/cascade side effects.
create function pg_temp.fail_expiration() returns trigger language plpgsql as $$begin
 if old.text='failure' then raise exception 'synthetic failure'; end if; return old; end;$$;
create trigger synthetic_expiry_failure before delete on public.statuses for each row execute function pg_temp.fail_expiration();
update public.status_expiration_control set enabled=true;
create temp table run as select public.process_expired_statuses(100) result;
select is((select (result->>'deleted')::integer from run),13,'all eligible types, ended/cancelled/invalid promotions deleted');
select is((select (result->>'errors')::integer from run),1,'partial failure logged');
select is((select (result->>'preserved')::integer from run),1,'open support held');
select is((select count(*)::integer from public.statuses),7,'active/permanent/future/workout/support/failure preserved');
select is((select count(*)::integer from public.post_comments),0,'comments cascade');
select is((select count(*)::integer from public.status_votes),0,'poll votes cascade');
select is((select count(*)::integer from public.status_participants),0,'participants cascade');
select is((select count(*)::integer from public.storage_cleanup_tasks where source_id in (select id from fixture)),1,'deleted photo captured in AUD04');
update public.storage_cleanup_tasks set next_attempt_at=now()+interval '1 year',lease_until=case when state='leased' then now()+interval '1 year' else lease_until end where source_id not in (select id from fixture);
select is((select count(*)::integer from public.claim_storage_cleanup_tasks()),0,'live shared photo reference blocks Storage claim');
delete from public.statuses where poll_question='Shared valid reference';
select is((select count(*)::integer from public.claim_storage_cleanup_tasks()),1,'last reference removal releases durable Storage task');
select ok((select next_attempt_at>now() and attempts=1 and last_error='P0001' from public.status_expiration_queue where status_id=(select id from fixture where name='failure')),'failure backed off and sanitized');
select is(public.process_expired_statuses()->>'deleted','0','idempotent second run');
select ok((select ledger=(select jsonb_agg(to_jsonb(t) order by id) from public.economy_transactions t) and purchases=(select jsonb_agg(to_jsonb(t) order by id) from public.cash_purchases t) and promotions=(select jsonb_agg(to_jsonb(t)-'status'-'cancelled_at'-'cancelled_by'-'cancel_reason' order by id) from public.promotions t) from finance_before),'financial snapshots preserved byte for byte');
select is((select count(*)::integer from public.promotions where target_id=(select id from fixture where name='ended')),1,'promotion history survives target removal');
drop trigger synthetic_expiry_failure on public.statuses;
update public.status_expiration_queue set next_attempt_at=now() where status_id=(select id from fixture where name='failure');
select is(public.process_expired_statuses()->>'deleted','1','retry succeeds');
update public.promotions set status='cancelled',cancelled_at=now() where target_id=(select id from fixture where name='active');
select is(public.process_expired_statuses()->>'deleted','1','cancellation requeues expired target immediately');
update public.support_requests set state='closed';
update public.status_expiration_queue set next_attempt_at=now() where status_id=(select id from fixture where name='support');
select is(public.process_expired_statuses()->>'deleted','1','support release allows deletion');
select ok((select status_id is null and message='Synthetic open support case' from public.support_requests),'support history kept with SET NULL');
select throws_ok($$insert into public.statuses(id,community_id,author_id,type,expires_at,photo_path) select id,'85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','photo',now()+interval '1 day','statusPhotos/85000000-0000-0000-0000-000000000001/'||id||'.webp' from fixture where name='photo'$$,'P0001','PHOTO_ID_ALREADY_DELETED','in flight deleted photo identity cannot be reused');
select throws_ok($q$insert into public.statuses(community_id,author_id,type,expires_at,poll_question,poll_options,photo_path)
 select '85000000-0000-0000-0000-000000000001','84000000-0000-0000-0000-000000000001','poll',now()+interval '1 day','Borrow?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', '85000000-0000-0000-0000-000000000001/'||id||'.webp' from fixture where name='photo'$q$,
 'P0001','PHOTO_ID_ALREADY_DELETED','borrowed photo cannot race in flight cleanup using unprefixed alias');
select ok(not has_function_privilege('service_role','public.process_expired_statuses(integer)','execute'),'service cannot invoke destructive routine');
set local role authenticated;
select throws_ok($$select public.process_expired_statuses()$$,'42501',null,'client cannot invoke cleanup');
select throws_ok($$update public.status_expiration_control set enabled=true$$,'42501',null,'client cannot activate cleanup');
select throws_ok($$select * from public.status_expiration_queue$$,'42501',null,'client cannot read queue');
reset role;
select set_config('request.jwt.claim.sub','84000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.status_publications),3,'member reads surviving rows through invoker RLS');
reset role;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
set local role authenticated;
select is((select count(*)::integer from public.status_publications),0,'nonmember cannot read invoker view');
reset role;
select * from finish();
rollback;
