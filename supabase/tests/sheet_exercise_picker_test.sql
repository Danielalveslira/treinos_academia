\ir _helpers/auth_session.sql
begin;
select plan(10);
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('97a00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','picker-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,2)n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('97a00000-0000-0000-0000-000000000001','97a00000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
select ('97c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'evolutus_dataset','picker-'||n,'Official '||n,'peito',array['peito'],'forca',array['Empurre'],'published' from generate_series(1,2)n;
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
select ('97e00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'97a00000-0000-0000-0000-000000000001','Official '||n,'Peito','catalog','evolutus_dataset','picker-'||n,('97c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'strength' from generate_series(1,2)n;
select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
create temp table matching as select public.create_workout_sheet(gen_random_uuid(),'Matching',p_items=>'[{"exercise_id":"97e00000-0000-0000-0000-000000000001"}]') result;
select public.create_workout_sheet(gen_random_uuid(),'Other exercise',p_items=>'[{"exercise_id":"97e00000-0000-0000-0000-000000000002"}]');
select public.create_workout_sheet(gen_random_uuid(),'Draft');
create temp table archived as select public.create_workout_sheet(gen_random_uuid(),'Archived',p_items=>'[{"exercise_id":"97e00000-0000-0000-0000-000000000001"}]') result;
select public.set_workout_sheet_archived((select (result->>'id')::uuid from archived),true,(select (result->>'revision')::bigint from archived));
select is(jsonb_array_length(public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')->'sheets'),1,'one aggregate excludes unrelated, draft and archived sheets');
select is(public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')->'sheets'->0->>'id',(select result->>'id' from matching),'only the matching eligible sheet is returned');
select is(public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')->>'today',public.get_my_sheet_insights()->>'today','business day stays server-derived');
select ok(not (public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')->'sheets'->0 ? 'items'),'no per-sheet exercise payload or catalogue is transferred');
select is(public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000002')->'sheets'->0->>'name','Other exercise','membership is filtered by the requested exercise');
select is(jsonb_array_length(public.get_my_sheet_insights_for_exercise('97000000-0000-0000-0000-000000000099')->'sheets'),0,'unknown exercise does not invent a binding');
select is(jsonb_array_length(public.get_my_sheet_insights_for_exercise(null)->'sheets'),0,'null intent cannot bypass membership');
reset role;
select ok(not has_function_privilege('anon','public.get_my_sheet_insights_for_exercise(uuid)','execute') and has_function_privilege('authenticated','public.get_my_sheet_insights_for_exercise(uuid)','execute'),'only authenticated callers have execute');
select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is(jsonb_array_length(public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')->'sheets'),0,'another account cannot obtain private membership');
reset role;
select pg_temp.revoke_test_session('97a00000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select public.get_my_sheet_insights_for_exercise('97e00000-0000-0000-0000-000000000001')$$,'P0001','SESSION_REVOKED','revocation is enforced on the aggregate');
reset role;
select * from finish();
rollback;
