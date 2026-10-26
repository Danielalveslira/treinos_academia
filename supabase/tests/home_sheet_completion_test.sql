\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98a00000-0000-0000-0000-000000000001','authenticated','authenticated','home-insights@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98a00000-0000-0000-0000-000000000001';
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('98c00000-0000-0000-0000-000000000001','evolutus_dataset','home-insights','Oficial','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
values('98e00000-0000-0000-0000-000000000001','98a00000-0000-0000-0000-000000000001','Oficial','Peito','catalog','evolutus_dataset','home-insights','98c00000-0000-0000-0000-000000000001','strength');
select pg_temp.set_test_user('98a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
create temp table fixture_sheets as select n,public.create_workout_sheet(gen_random_uuid(),'Home '||n,
 p_items=>'[{"exercise_id":"98e00000-0000-0000-0000-000000000001"}]') result from generate_series(1,3) n;

select ok(not has_table_privilege('authenticated','public.workout_sheet_completions','INSERT'),'no direct insert');
select ok(not has_table_privilege('authenticated','public.workout_sheet_completions','UPDATE'),'no direct update');
select ok(not has_table_privilege('authenticated','public.workout_sheet_completions','DELETE'),'no direct delete');
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=1))->>'status','insufficient_activity','no activity cannot complete');
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid from fixture_sheets where n=1;
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=1))->>'status','insufficient_activity','one point is insufficient');
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid from fixture_sheets,generate_series(1,2) where n=1;
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=2))->>'status','insufficient_activity','another sheet activity does not complete this one');
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=1))->>'status','completed','explicit valid finish');
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=1))->>'status','already_completed','lost response retry is idempotent');
select is((select count(*)::int from public.workout_sheet_completions),1,'only one completion');
select is((select count(*)::int from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s where (s->>'completed_today')::boolean),1,'summary reports only real completion');
select is(public.complete_workout_sheet('00000000-0000-0000-0000-000000000001')->>'status','not_allowed','unknown sheet denied');

-- Legacy payload and new create protocol both remain valid; server ACK contains attribution.
create temp table sync_new as select public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
 'mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),
 'payload',jsonb_build_object('exercise_id','98e00000-0000-0000-0000-000000000001',
 'date',(now() at time zone 'America/Sao_Paulo')::date,'type','strength','sets',1,
 'set_details','[{"weight":10,"reps":10}]'::jsonb,'note','',
 'sheet_id',(select result->>'id' from fixture_sheets where n=2))))) result;
select is((select result#>>'{results,0,status}' from sync_new),'applied','offline create accepted');
select is((select result#>>'{results,0,row,sheet_id}' from sync_new),(select result->>'id' from fixture_sheets where n=2),'ACK preserves sheet identity');
select is((public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=2))->>'awardedCoins')::int,0,'valid completion after daily reward pays zero');
select is((select count(*)::int from public.workout_sheet_completions),2,'zero coins still persists completion');
select is(public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
 'mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),
 'payload',jsonb_build_object('exercise_id','98e00000-0000-0000-0000-000000000001',
 'date',(now() at time zone 'America/Sao_Paulo')::date,'type','strength','sets',1,
 'set_details','[{"weight":10,"reps":10}]'::jsonb,'note',''))))#>>'{results,0,status}',
 'applied','old client without sheet_id still works');
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date-1,
1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid from fixture_sheets where n=3;
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=3))->>'status','insufficient_activity','old history never concludes today');
select public.set_workout_sheet_archived((select (result->>'id')::uuid from fixture_sheets where n=3),true,(select (result->>'revision')::bigint from fixture_sheets where n=3));
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=3))->>'status','not_allowed','archived sheet rejected');
select is(public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
 'mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),
 'payload',jsonb_build_object('exercise_id','98e00000-0000-0000-0000-000000000001',
 'date',(now() at time zone 'America/Sao_Paulo')::date,'type','strength','sets',1,
 'set_details','[{"weight":10,"reps":10}]'::jsonb,'note','',
 'sheet_id',(select result->>'id' from fixture_sheets where n=3)))))#>>'{results,0,code}',
 'SHEET_NOT_READY','archived offline create is rejected visibly, never silently unlinked');
select is(public.complete_workout_sheet((public.create_workout_sheet(gen_random_uuid(),'Empty')->>'id')::uuid)->>'status',
 'not_allowed','empty sheet cannot complete');
reset role;
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98a00000-0000-0000-0000-000000000002','authenticated','authenticated','home-completion-other@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98a00000-0000-0000-0000-000000000002';
select pg_temp.set_test_user('98a00000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::int from public.workout_sheet_completions),0,'RLS isolates second account');
-- fixture IDs live in the session's own temp table, independent of public RLS.
select is(public.complete_workout_sheet((select (result->>'id')::uuid from fixture_sheets where n=1))->>'status','not_allowed','another user cannot complete sheet');
reset role;
select pg_temp.set_test_user('98a00000-0000-0000-0000-000000000001',true);
reset role;
select pg_temp.revoke_test_session('98a00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok('select public.complete_workout_sheet(gen_random_uuid())','P0001','SESSION_REVOKED','revoked session cannot complete');
reset role;
select * from finish();
rollback;
