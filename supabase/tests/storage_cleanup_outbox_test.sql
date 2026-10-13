begin;
select no_plan();
insert into auth.users (id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('74000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','aud04-'||n||'@example.invalid','unused',now(),'{}','{}',now(),now() from generate_series(1,3) n;
update public.users set role='superadmin' where id='74000000-0000-0000-0000-000000000003';
insert into public.communities(id,name,created_by,owner_id) values
('75000000-0000-0000-0000-000000000001','AUD04 synthetic','74000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000002');
insert into public.statuses(id,community_id,author_id,type,photo_path) values
('76000000-0000-0000-0000-000000000001','75000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','photo','statusPhotos/75000000-0000-0000-0000-000000000001/76000000-0000-0000-0000-000000000001.webp'),
('76000000-0000-0000-0000-000000000002','75000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000002','photo','statusPhotos/75000000-0000-0000-0000-000000000001/76000000-0000-0000-0000-000000000002.webp');
insert into public.profile_avatar_media(id,owner_id,storage_path) values
('77000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001/77000000-0000-0000-0000-000000000001.webp');
select set_config('request.jwt.claim.sub','74000000-0000-0000-0000-000000000003',true);
select public.queue_deletion('account','74000000-0000-0000-0000-000000000001');
-- Force rollback after statuses were deleted: outbox must roll back too.
create function pg_temp.fail_user_delete() returns trigger language plpgsql as $$begin raise exception 'synthetic failure'; end;$$;
create trigger aud04_fail before delete on public.users for each row execute function pg_temp.fail_user_delete();
select ok((public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='74000000-0000-0000-0000-000000000001'))->>'error')::boolean,'forced job failure');
select is((select count(*)::integer from public.storage_cleanup_tasks),0,'transaction rollback also rolls back capture');
select is((select count(*)::integer from public.statuses),2,'rollback keeps photos referenced');
drop trigger aud04_fail on public.users;
select ok((public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='74000000-0000-0000-0000-000000000001'))->>'authPending')::boolean,'account deletion succeeds');
select is((select count(*)::integer from public.storage_cleanup_tasks),2,'account photo and avatar captured during cascade');
select is((select count(*)::integer from public.users where id='74000000-0000-0000-0000-000000000001'),0,'account row gone');
select ok((public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='74000000-0000-0000-0000-000000000001'))->>'retry')::boolean,'Auth retry unchanged');
select is((select count(*)::integer from public.storage_cleanup_tasks),2,'replay adds no duplicates');
select public.queue_deletion('community','75000000-0000-0000-0000-000000000001');
select ok((public.run_deletion_job((select id from public.deletion_jobs where kind='community' and target_id='75000000-0000-0000-0000-000000000001'))->>'complete')::boolean,'community deletion succeeds');
select is((select count(*)::integer from public.storage_cleanup_tasks),3,'community photo captured');
select is((select count(*)::integer from public.statuses),0,'all rows gone, durable paths remain');
select ok(not exists(select 1 from public.storage_cleanup_tasks where object_key like 'statusPhotos/%'),'keys bucket-relative');
create temp table claimed as select * from public.claim_storage_cleanup_tasks();
select is((select count(*)::integer from claimed),3,'claim all tasks');
select is((select count(*)::integer from public.claim_storage_cleanup_tasks()),0,'second worker cannot claim active leases');
select ok(not public.finish_storage_cleanup_task((select id from claimed limit 1),gen_random_uuid(),null),'wrong token cannot finish');
select ok(public.finish_storage_cleanup_task((select id from claimed limit 1),(select lease_token from claimed limit 1),'503 synthetic personal name'),'failure ack');
select is((select count(*)::integer from public.storage_cleanup_tasks where state='pending'),1,'failure remains pending');
select is((select count(*)::integer from public.claim_storage_cleanup_tasks()),0,'backoff prevents immediate retry');
select is((select last_error from public.storage_cleanup_tasks where state='pending'),'STORAGE_RETRY','diagnostic sanitized');
update public.storage_cleanup_tasks set next_attempt_at=now()-interval '1 second' where state='pending';
create temp table retried as select * from public.claim_storage_cleanup_tasks();
select is((select attempts from retried),2,'attempts durable');
select ok(public.finish_storage_cleanup_task((select id from retried),(select lease_token from retried),null),'retry acknowledged');
select ok(not public.finish_storage_cleanup_task((select id from retried),(select lease_token from retried),null),'repeat ack fenced');
update public.storage_cleanup_tasks set lease_until=now()-interval '1 second' where state='leased';
create temp table recovered as select * from public.claim_storage_cleanup_tasks();
select is((select count(*)::integer from recovered),2,'crashed worker lease recovered');
select ok(not public.finish_storage_cleanup_task((select id from recovered limit 1),(select c.lease_token from claimed c join recovered r using(id) limit 1),null),'expired worker token fenced');
update public.storage_cleanup_tasks set attempts=8,lease_until=now()-interval '1 second' where state='leased';
select is((select count(*)::integer from public.claim_storage_cleanup_tasks()),0,'exhausted tasks not reissued');
select is((select count(*)::integer from public.storage_cleanup_tasks where state='failed'),2,'permanent failures visible');
-- Forged avatar references are quarantined even though the avatar table allows arbitrary text internally.
insert into public.profile_avatar_media(id,owner_id,storage_path) values
('77000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000002','74000000-0000-0000-0000-000000000001/77000000-0000-0000-0000-000000000001.webp');
delete from public.profile_avatar_media where id='77000000-0000-0000-0000-000000000002';
-- Use a distinct malicious reference (dedup protects any already queued reference).
insert into public.profile_avatar_media(id,owner_id,storage_path) values
('77000000-0000-0000-0000-000000000003','74000000-0000-0000-0000-000000000002','../outside.webp');
delete from public.profile_avatar_media where id='77000000-0000-0000-0000-000000000003';
select is((select last_error from public.storage_cleanup_tasks where reference='../outside.webp'),'INVALID_REFERENCE','invalid path quarantined');
select ok(not has_function_privilege('authenticated','public.claim_storage_cleanup_tasks()','execute') and
not has_function_privilege('anon','public.finish_storage_cleanup_task(uuid,uuid,text)','execute'),'administrative RPC permissions');
set local role authenticated;
select throws_ok($$select * from public.storage_cleanup_tasks$$,'42501',null,'cannot read tasks');
select throws_ok($$insert into public.storage_cleanup_tasks(bucket,reference,source_id) values('status-photos','foreign',gen_random_uuid())$$,'42501',null,'cannot enqueue foreign objects');
select throws_ok($$update public.storage_cleanup_tasks set state='complete'$$,'42501',null,'cannot change cleanup state');
select throws_ok($$select public.claim_storage_cleanup_tasks()$$,'42501',null,'cannot invoke claim');
select throws_ok($$select public.finish_storage_cleanup_task(gen_random_uuid(),gen_random_uuid(),null)$$,'42501',null,'cannot invoke finish');
reset role;
set local role anon;
select throws_ok($$select public.claim_storage_cleanup_tasks()$$,'42501',null,'anon cannot invoke claim');
reset role;
select * from finish();
rollback;
