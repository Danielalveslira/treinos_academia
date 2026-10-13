begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('97000000-0000-0000-0000-000000000001','authenticated','authenticated','visual-delete-admin@example.invalid','x',now(),'{}','{}',now(),now()),
('97000000-0000-0000-0000-000000000002','authenticated','authenticated','visual-delete-user@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='97000000-0000-0000-0000-000000000001';
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions)
values('97aaaaaa-0000-0000-0000-000000000001','evolutus_dataset','delete-a','Delete A','peito',array['peito'],'forca',array['Puxe.']),
('97aaaaaa-0000-0000-0000-000000000002','evolutus_dataset','delete-b','Delete B','peito',array['peito'],'forca',array['Puxe.']);
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
create temp table targets as select (public.allocate_exercise_visual_set('97aaaaaa-0000-0000-0000-000000000001','manual_upload','v2.1','{}','97111111-0000-0000-0000-000000000001')->>'visualSetId')::uuid id;
create temp table shared as select (public.allocate_exercise_visual_set('97aaaaaa-0000-0000-0000-000000000002','manual_upload')->>'visualSetId')::uuid id;
create temp table profile_snapshot as select id,name,base_prompt,active from public.exercise_visual_style_profiles;
select ok(not has_function_privilege('anon','public.request_exercise_visual_deletion(uuid)','execute'),'anon cannot request deletion');
select ok(not has_function_privilege('authenticated','public.claim_exercise_visual_deletions(uuid,integer)','execute'),'user cannot claim outbox');
select ok(not has_function_privilege('authenticated','public.finish_exercise_visual_deletion(uuid,uuid,text)','execute'),'user cannot acknowledge storage');
select ok(not has_table_privilege('authenticated','public.exercise_visual_deletions','insert'),'user cannot forge paths/jobs');
select ok(not has_table_privilege('authenticated','public.exercise_visual_sets','delete'),'no direct version deletion');
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'42501','FORBIDDEN','ordinary user rejected');
set local role authenticated;
select is((select count(*)::int from public.exercise_visual_deletions),0,'ordinary user sees no deletion records');
reset role;
select set_config('request.jwt.claim.sub','97000000-0000-0000-0000-000000000001',true);
-- Another set references the same private key; deletion must leave both versions untouched.
update public.exercise_visual_assets set storage_path='97aaaaaa-0000-0000-0000-000000000001/'||(select id from targets)||'/start.webp' where visual_set_id=(select id from shared) and role='start';
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'55000','VISUAL_FILE_REFERENCED','shared asset blocks deletion');
select is((select count(*)::int from public.exercise_visual_sets where id=(select id from targets)),1,'blocked version remains');
update public.exercise_visual_assets set storage_path='97aaaaaa-0000-0000-0000-000000000002/'||(select id from shared)||'/start.webp' where visual_set_id=(select id from shared) and role='start';
update public.exercise_catalog set published_media_refs=jsonb_build_object('images',jsonb_build_array(jsonb_build_object('path','97aaaaaa-0000-0000-0000-000000000001/'||(select id from targets)||'/start.webp'))) where id='97aaaaaa-0000-0000-0000-000000000002';
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'55000','VISUAL_FILE_REFERENCED','published_media_refs of another exercise blocks deletion');
update public.exercise_catalog set published_media_refs='{}' where id='97aaaaaa-0000-0000-0000-000000000002';
-- Public copy from a partial publish is protected too, even with no asset row for that copy.
update public.exercise_catalog set source_media_refs='{"thumbnail":{"path":"97aaaaaa-0000-0000-0000-000000000001/v1/thumb.webp"}}' where id='97aaaaaa-0000-0000-0000-000000000002';
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'55000','VISUAL_FILE_REFERENCED','legacy/source reference blocks partial public copy deletion');
update public.exercise_catalog set source_media_refs='{}' where id='97aaaaaa-0000-0000-0000-000000000002';
update public.exercise_catalog set published_media_refs='{"version":1,"images":[]}' where id='97aaaaaa-0000-0000-0000-000000000001';
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'55000','VISUAL_VERSION_PROTECTED','catalog active version protected even if state/paths inconsistent');
update public.exercise_catalog set published_media_refs='{}' where id='97aaaaaa-0000-0000-0000-000000000001';
update public.exercise_visual_style_profiles set reference_assets='[{"path":"97aaaaaa-0000-0000-0000-000000000001/v1/start.webp"}]' where name='EVOLUTUS_FITNESS_V2';
select throws_ok($$select public.request_exercise_visual_deletion((select id from targets))$$,'55000','VISUAL_FILE_REFERENCED','legacy style reference protects file without deleting profile');
update public.exercise_visual_style_profiles set reference_assets='[]' where name='EVOLUTUS_FITNESS_V2';
select is(public.request_exercise_visual_deletion((select id from targets))->>'status','pending','eligible version queues physical deletion');
select is((select count(*)::int from public.exercise_visual_sets where id=(select id from targets)),0,'version no longer appears in review/history');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id=(select id from targets)),0,'only owned dependent assets cascade');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id=(select id from shared)),3,'other assets preserved');
select is((select jsonb_array_length(files) from public.exercise_visual_deletions where visual_set_id=(select id from targets)),6,'drafts and partial public files all queued');
select is((select count(*)::int from public.exercise_visual_audit_log where visual_set_id=(select id from targets)),2,'allocation audit preserved and request audited');
select is(public.request_exercise_visual_deletion((select id from targets))->>'replayed','true','same version request idempotent');
select throws_ok($$update public.exercise_catalog set published_media_refs='{"images":[{"path":"https://example.invalid/storage/v1/object/public/exercise-visuals/97aaaaaa-0000-0000-0000-000000000001/v1/start.webp"}]}' where id='97aaaaaa-0000-0000-0000-000000000002'$$,'55000','VISUAL_SET_DELETED','new reference to pending file blocked');
select throws_ok($$insert into storage.objects(bucket_id,name) values('exercise-visuals','97aaaaaa-0000-0000-0000-000000000001/v1/start.webp')$$,'55000','VISUAL_SET_DELETED','late concurrent publication copy fenced at Storage');
select throws_ok($$select public.allocate_exercise_visual_set('97aaaaaa-0000-0000-0000-000000000001','manual_upload','v2.1','{}','97111111-0000-0000-0000-000000000001')$$,'55000','VISUAL_SET_DELETED','deleted allocation retry cannot resurrect version');
select is(public.allocate_exercise_visual_set('97aaaaaa-0000-0000-0000-000000000001','manual_upload')->>'version','2','new allocation does not reuse deleted version/path');
create temp table leased as select * from public.claim_exercise_visual_deletions((select id from targets));
select is((select count(*)::int from leased),1,'worker claims one lease');
select is((select count(*)::int from public.claim_exercise_visual_deletions((select id from targets))),0,'parallel worker cannot claim active lease');
select is(public.finish_exercise_visual_deletion((select id from targets),gen_random_uuid(),null),false,'stale/forged token rejected');
select is(public.finish_exercise_visual_deletion((select id from targets),(select lease_token from leased),'STORAGE_RETRY'),true,'Storage failure leaves durable retry');
select is((select status from public.exercise_visual_deletions where visual_set_id=(select id from targets)),'pending','failure never reported complete');
create temp table retried as select * from public.claim_exercise_visual_deletions((select id from targets));
select is((select attempts from retried),2,'retry gets new lease and attempt');
select is(public.finish_exercise_visual_deletion((select id from targets),(select lease_token from leased),null),false,'old worker cannot finish newer lease');
select is(public.finish_exercise_visual_deletion((select id from targets),(select lease_token from retried),null),true,'confirmed absence completes');
select is(public.request_exercise_visual_deletion((select id from targets))->>'status','complete','completed retry remains idempotent');
select throws_ok($$insert into storage.objects(bucket_id,name) values('exercise-visuals','97aaaaaa-0000-0000-0000-000000000001/v1/start.webp')$$,'55000','VISUAL_SET_DELETED','completed tombstone still blocks path resurrection');
-- Protect publication/rollback states and all previously published versions.
select public.confirm_exercise_visual_internal((select id from shared),'97000000-0000-0000-0000-000000000001','[{"role":"start","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10},{"role":"end","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10}]');
select public.publish_exercise_visual_internal((select id from shared),'97000000-0000-0000-0000-000000000001');
select throws_ok($$select public.request_exercise_visual_deletion((select id from shared))$$,'55000','VISUAL_VERSION_PROTECTED','active/published version protected');
update public.exercise_visual_sets set status='archived' where id=(select id from shared);
select throws_ok($$select public.request_exercise_visual_deletion((select id from shared))$$,'55000','VISUAL_VERSION_PROTECTED','archived rollback version protected');
select is((select count(*)::int from (select id,name,base_prompt,active from public.exercise_visual_style_profiles except select * from profile_snapshot) x),0,'style profiles and activation unchanged');
select * from finish();
rollback;
