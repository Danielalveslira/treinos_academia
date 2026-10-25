\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('97a00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','sheet-attr-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,2) n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('97a00000-0000-0000-0000-000000000001','97a00000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('97c00000-0000-0000-0000-000000000001','evolutus_dataset','sheet-attr-1','Oficial','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
select ('97e00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,('97a00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  'Oficial','Peito','catalog','evolutus_dataset','sheet-attr-1','97c00000-0000-0000-0000-000000000001','strength'
from generate_series(1,2) n;

select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
create temp table sheet_a as
  select (public.create_workout_sheet(gen_random_uuid(),'Ficha A')->>'id')::uuid id;
reset role;
select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000002',true);
set local role authenticated;
create temp table sheet_b as
  select (public.create_workout_sheet(gen_random_uuid(),'Ficha B')->>'id')::uuid id;
reset role;

select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
set local role authenticated;

select lives_ok(
  format($q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,sheet_id)
    values('97f00000-0000-0000-0000-000000000001',auth.uid(),'97e00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select id from sheet_a)),
  'grava sheet_id da própria ficha'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),(select id from sheet_a),'sheet_id salvo corretamente');

select throws_ok(
  format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select id from sheet_b)),
  '23503',null,'ficha de outra conta é rejeitada (FK composta exige o mesmo user_id)'
);

select throws_ok(
  $q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":10,"reps":10}]',gen_random_uuid())$q$,
  '23503',null,'ficha inexistente é rejeitada'
);

select lives_ok(
  $q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details)
    values('97f00000-0000-0000-0000-000000000002',auth.uid(),'97e00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":5,"reps":5}]')$q$,
  'sheet_id continua opcional (treino livre, sem ficha)'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000002'),null,'sem ficha fica null, não inventado');

select throws_ok(
  format($q$update public.workouts set sheet_id=%L where id='97f00000-0000-0000-0000-000000000002'$q$,(select id from sheet_a)),
  'P0001','SHEET_ID_IMMUTABLE','não é possível atribuir uma ficha a um registro depois de criado'
);
select throws_ok(
  $q$update public.workouts set sheet_id=null where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','SHEET_ID_IMMUTABLE','não é possível apagar a ficha de um registro já atribuído'
);
select lives_ok(
  $q$update public.workouts set note='ajustada' where id='97f00000-0000-0000-0000-000000000001'$q$,
  'editar outros campos continua permitido'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),(select id from sheet_a),'editar nota não altera sheet_id');

-- Guardas pré-existentes (created_at/type) continuam ativas -- a função foi substituída, não reduzida.
select throws_ok(
  $q$update public.workouts set created_at=now() where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','CREATED_AT_IMMUTABLE','guarda pré-existente de created_at continua em vigor'
);
select throws_ok(
  $q$update public.workouts set type='cardio' where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','TYPE_IMMUTABLE','guarda pré-existente de type continua em vigor'
);

-- Exclusão da ficha preserva o histórico: o registro sobrevive, só perde o vínculo.
reset role;
delete from public.workout_sheets where id=(select id from sheet_a);
select is((select count(*)::int from public.workouts where user_id='97a00000-0000-0000-0000-000000000001'),2,'excluir a ficha não apaga os treinos');
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),null,'FK on delete set null limpa o vínculo, não o registro');

select * from finish();
rollback;
