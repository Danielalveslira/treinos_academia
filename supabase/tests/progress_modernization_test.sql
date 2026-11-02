\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('', true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98100000-0000-0000-0000-000000000001','authenticated','authenticated','progress-modern@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98100000-0000-0000-0000-000000000001';
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('98100000-0000-0000-0000-000000000002','evolutus_dataset','progress-modern','Teste','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
values('98100000-0000-0000-0000-000000000003','98100000-0000-0000-0000-000000000001','Teste','Peito','catalog','evolutus_dataset','progress-modern','98100000-0000-0000-0000-000000000002','strength');
select pg_temp.set_test_user('98100000-0000-0000-0000-000000000001', true);
set local role authenticated;
create temp table progress_sheets as select n, public.create_workout_sheet(gen_random_uuid(), 'Ficha '||n,
  p_items=>'[{"exercise_id":"98100000-0000-0000-0000-000000000003","target_sets":3}]') result
  from generate_series(1,2) n;
reset role;
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id,exercise_completed)
select '98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000003',
  (now() at time zone 'America/Sao_Paulo')::date, 1, '[{"weight":10,"reps":10}]',
  (result->>'id')::uuid, false from progress_sheets where n=1;
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id,exercise_completed)
select '98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000003',
  (now() at time zone 'America/Sao_Paulo')::date, 1, '[{"weight":20,"reps":5}]',
  (result->>'id')::uuid, true from progress_sheets where n=1;
insert into public.workouts(user_id,exercise_id,date,sets,set_details,exercise_completed)
values('98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000003',
  (now() at time zone 'America/Sao_Paulo')::date, 1, '[{"weight":0,"reps":8}]', false);
set local role authenticated;
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)->>'trainedOccurrences')::int,1,'two exercise rows count as one sheet/day');
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)->>'completedOccurrences')::int,0,'sets do not conclude a sheet');
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)->>'exerciseRecords')::int,3,'legacy unlinked row stays counted');
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)->>'completedExercises')::int,1,'explicit exercise completion only for partial rows');
select throws_ok('select public.save_body_check_in(''{"date":"2999-01-01","weightKg":80}''::jsonb)','P0001','INVALID_DATE','future measurement rejected atomically');
select throws_ok('select public.save_body_check_in(jsonb_build_object(''date'',(now() at time zone ''America/Sao_Paulo'')::date,''weightKg'',401))','P0001','INVALID_MEASUREMENT','implausible weight rejected by server');
select throws_ok('select public.save_body_check_in(jsonb_build_object(''date'',(now() at time zone ''America/Sao_Paulo'')::date,''weightKg'',80,''note'',repeat(''x'',301)))','23514',null,'note limit matches the form');
reset role;
insert into public.workout_sheet_completions(user_id,sheet_id,business_day)
select '98100000-0000-0000-0000-000000000001',(result->>'id')::uuid,
  (now() at time zone 'America/Sao_Paulo')::date from progress_sheets where n=1;
set local role authenticated;
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date)->>'completedOccurrences')::int,1,'server completion event counted once');
reset role;
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id,exercise_completed)
select '98100000-0000-0000-0000-000000000001','98100000-0000-0000-0000-000000000003',
  (now() at time zone 'America/Sao_Paulo')::date-1, 3,
  '[{"weight":10,"reps":10},{"weight":10,"reps":10},{"weight":10,"reps":10}]',
  (result->>'id')::uuid, false from progress_sheets where n=2;
set local role authenticated;
select public.set_workout_sheet_archived((select (result->>'id')::uuid from progress_sheets where n=2),true,
  (select (result->>'revision')::bigint from progress_sheets where n=2));
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date-1,(now() at time zone 'America/Sao_Paulo')::date)->>'trainedOccurrences')::int,2,'archived sheet remains in historical activity');
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date-1,(now() at time zone 'America/Sao_Paulo')::date)->>'distinctSheets')::int,2,'distinct sheets count archived and active');
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date-1,(now() at time zone 'America/Sao_Paulo')::date)->>'completedExercises')::int,2,'legacy full row is compatible with exercise completion');
reset role;
select pg_temp.set_test_user('', true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98100000-0000-0000-0000-000000000004','authenticated','authenticated','progress-other@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98100000-0000-0000-0000-000000000004';
select pg_temp.set_test_user('98100000-0000-0000-0000-000000000004', true);
set local role authenticated;
select is((public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date-1,(now() at time zone 'America/Sao_Paulo')::date)->>'exerciseRecords')::int,0,'security definer summary isolates users');
select * from finish();
rollback;
