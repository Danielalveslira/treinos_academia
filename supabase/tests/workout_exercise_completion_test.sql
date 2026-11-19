\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
('e8a00000-0000-0000-0000-000000000001','authenticated','authenticated','partial-a@example.invalid',now(),'{}','{}',now(),now()),
('e8a00000-0000-0000-0000-000000000002','authenticated','authenticated','partial-b@example.invalid',now(),'{}','{}',now(),now());
insert into auth.sessions(id,user_id,created_at,updated_at) values
('e8b00000-0000-0000-0000-000000000001','e8a00000-0000-0000-0000-000000000001',now(),now()),
('e8b00000-0000-0000-0000-000000000002','e8a00000-0000-0000-0000-000000000002',now(),now());
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('e8c00000-0000-0000-0000-000000000001','evolutus_dataset','partial-strength','Supino','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,type) values
('e8d00000-0000-0000-0000-000000000001','e8a00000-0000-0000-0000-000000000001','Supino','Peito','catalog','evolutus_dataset','partial-strength','strength'),
('e8d00000-0000-0000-0000-000000000002','e8a00000-0000-0000-0000-000000000002','Supino','Peito','catalog','evolutus_dataset','partial-strength','strength');

select pg_temp.set_test_user('e8a00000-0000-0000-0000-000000000001',true);
-- set_test_user (linha anterior) já dá amr/role corretos; esta chamada só troca o
-- session_id para apontar à sessão manual criada acima -- precisa preservar role/amr, não
-- substituir o objeto inteiro, senão is_full_login_session() volta a negar.
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb || jsonb_build_object('sub','e8a00000-0000-0000-0000-000000000001','session_id','e8b00000-0000-0000-0000-000000000001'))::text,true);
set local role authenticated;

select lives_ok($q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,exercise_completed)
values('e8f00000-0000-0000-0000-000000000001',auth.uid(),'e8d00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":20,"reps":10}]',true)$q$,
'conclusão parcial fica persistida na linha existente');
select is((select exercise_completed from public.workouts where id='e8f00000-0000-0000-0000-000000000001'),true,'marcador lido após recarga');
select is((select count(*)::int from public.workouts where id='e8f00000-0000-0000-0000-000000000001'),1,'uma linha por exercício da sessão');

create temp table result_create as select public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
  'mutation_id','e8e00000-0000-0000-0000-000000000001','operation','workout.create',
  'entity_id','e8f00000-0000-0000-0000-000000000002',
  'payload',jsonb_build_object('exercise_id','e8d00000-0000-0000-0000-000000000001',
    'date',current_date,'type','strength','set_details','[{"weight":30,"reps":8}]'::jsonb,
    'sets',1,'note','','exercise_completed',false)))) result;
select is((select result->'results'->0->>'status' from result_create),'applied','fila offline grava a primeira série');
select is((select exercise_completed from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),false,'série salva ainda não conclui exercício');
select is((select result->'results'->0->>'status' from result_create),'applied','a criação foi confirmada');
select is((public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
  'mutation_id','e8e00000-0000-0000-0000-000000000001','operation','workout.create',
  'entity_id','e8f00000-0000-0000-0000-000000000002')))->'results'->0->>'status'),
  'already_applied','retry da mesma mutação é idempotente');
select is((select count(*)::int from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),1,'retry não duplica séries nem linhas');

create temp table result_update as select public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
  'mutation_id','e8e00000-0000-0000-0000-000000000002','operation','workout.update',
  'entity_id','e8f00000-0000-0000-0000-000000000002',
  'base_updated_at',(select updated_at from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),
  'payload',jsonb_build_object('exercise_id','e8d00000-0000-0000-0000-000000000001',
    'date',current_date,'type','strength','set_details','[{"weight":30,"reps":8}]'::jsonb,
    'sets',1,'note','','exercise_completed',true)))) result;
select is((select result->'results'->0->>'status' from result_update),'applied','finalização parcial atualiza a mesma linha');
select is((select exercise_completed from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),true,'marcador da atualização offline está no banco');
select is((select count(*)::int from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),1,'atualização não cria outra série');

select is((public.sync_workout_mutations(jsonb_build_array(jsonb_build_object(
  'mutation_id','e8e00000-0000-0000-0000-000000000003','operation','workout.create',
  'entity_id','e8f00000-0000-0000-0000-000000000003',
  'payload',jsonb_build_object('exercise_id','e8d00000-0000-0000-0000-000000000001',
    'date',current_date,'type','strength','set_details','[{"weight":30,"reps":8}]'::jsonb,
    'sets',1,'note','','exercise_completed','yes'))))->'results'->0->>'code'),
  'INVALID_PAYLOAD','marcador offline exige booleano');
select is((select count(*)::int from public.workouts where id='e8f00000-0000-0000-0000-000000000003'),0,'payload inválido não grava linha');
reset role;

select pg_temp.set_test_user('e8a00000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb || jsonb_build_object('sub','e8a00000-0000-0000-0000-000000000002','session_id','e8b00000-0000-0000-0000-000000000002'))::text,true);
set local role authenticated;
select is((select count(*)::int from public.workouts where id='e8f00000-0000-0000-0000-000000000002'),0,'RLS oculta a conclusão da outra conta');
select lives_ok($q$update public.workouts set exercise_completed=false
  where id='e8f00000-0000-0000-0000-000000000002'$q$,
  'tentativa de edição cruzada não expõe registro');
reset role;
select is((select exercise_completed from public.workouts
  where id='e8f00000-0000-0000-0000-000000000002'),true,
  'RLS preserva o marcador da outra conta');
select * from finish();
rollback;
