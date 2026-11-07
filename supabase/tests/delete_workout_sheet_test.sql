\ir _helpers/auth_session.sql
begin;
select no_plan();
-- Autenticação/sessão de private.sheet_actor() (NOT_AUTHENTICATED/SESSION_REVOKED/
-- APP_ACCESS_DENIED) e a semântica do FK "on delete set null (sheet_id)" + a imutabilidade
-- do vínculo já são provadas em workout_sheets_test.sql e workout_sheet_attribution_test.sql.
-- Este arquivo cobre só o que é novo: autorização/posse/revisão da RPC de exclusão física e
-- as cascatas (workout_sheet_exercises, workout_sheet_completions) + a não interferência em
-- workouts/economy_transactions.
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('99a00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','delete-sheet-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,2) n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('99a00000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('99c00000-0000-0000-0000-000000000001','evolutus_dataset','delete-sheet-1','Oficial','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
values('99e00000-0000-0000-0000-000000000001','99a00000-0000-0000-0000-000000000001','Oficial','Peito','catalog','evolutus_dataset','delete-sheet-1','99c00000-0000-0000-0000-000000000001','strength');

select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
-- Ficha própria, com um item real, para exercitar as duas cascatas e a atribuição em workouts.
create temp table sheet_a as select public.create_workout_sheet(
  gen_random_uuid(),'Ficha A',null,'','{}',
  '[{"exercise_id":"99e00000-0000-0000-0000-000000000001","target_sets":3}]'
) result;
select is((select count(*)::int from public.workout_sheet_exercises where sheet_id=(select (result->>'id')::uuid from sheet_a)),1,'ficha criada com um item real');
select lives_ok(
  format($q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,sheet_id)
    values('99f00000-0000-0000-0000-000000000001',auth.uid(),'99e00000-0000-0000-0000-000000000001',
    (now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_a)),
  'treino registrado sob a ficha'
);
reset role;
-- Linha de conclusão do dia inserida diretamente (como superusuário de teste): a lógica de
-- elegibilidade de complete_workout_sheet()/recompensa já é coberta em home_sheet_completion_test.sql;
-- aqui só precisamos de UMA linha para provar a cascata.
insert into public.workout_sheet_completions(user_id,sheet_id,business_day)
values('99a00000-0000-0000-0000-000000000001',(select (result->>'id')::uuid from sheet_a),(now() at time zone 'America/Sao_Paulo')::date);
set local role authenticated;
select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000001',true);

select throws_ok($$select public.delete_workout_sheet(gen_random_uuid(),1)$$,'P0001','SHEET_NOT_FOUND','ficha inexistente');

reset role;
select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok(
  format($$select public.delete_workout_sheet('%s',1)$$,(select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_NOT_FOUND','B não exclui ficha de A (sem distinguir de inexistente)'
);
reset role;

select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok(
  format($$select public.delete_workout_sheet('%s',999)$$,(select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_VERSION_CONFLICT','revisão divergente rejeitada'
);
-- Nada do acima alterou a ficha: a revisão real continua a mesma devolvida pela criação.
create temp table counts_before_delete as select
  (select count(*) from public.workouts) workouts,
  (select count(*) from public.economy_transactions) coins;
select lives_ok(
  format($$select public.delete_workout_sheet('%s',(select (result->>'revision')::bigint from sheet_a))$$,
    (select (result->>'id')::uuid from sheet_a)),
  'exclui ficha própria com a revisão correta'
);
select is((select count(*)::int from public.workout_sheets where id=(select (result->>'id')::uuid from sheet_a)),0,'ficha removida fisicamente');
reset role;
select is((select count(*)::int from public.workout_sheet_exercises where sheet_id=(select (result->>'id')::uuid from sheet_a)),0,'itens removidos via cascade');
select is((select count(*)::int from public.workout_sheet_completions where sheet_id=(select (result->>'id')::uuid from sheet_a)),0,'conclusões removidas via cascade');
select is((select sheet_id from public.workouts where id='99f00000-0000-0000-0000-000000000001'),null,'treino preservado com sheet_id zerado');
select is((select user_id from public.workouts where id='99f00000-0000-0000-0000-000000000001'),'99a00000-0000-0000-0000-000000000001'::uuid,'dono do treino nunca é tocado');
select is((select count(*) from public.workouts),(select workouts from counts_before_delete),'exclusão da ficha não apaga nenhum treino');
select is((select count(*) from public.economy_transactions),(select coins from counts_before_delete),'exclusão da ficha não altera recompensas');
set local role authenticated;
select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000001',true);

select throws_ok(
  format($$select public.delete_workout_sheet('%s',1)$$,(select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_NOT_FOUND','segunda exclusão da mesma ficha é idempotente, sem efeito colateral'
);
select throws_ok($$delete from public.workout_sheets$$,'42501',null,'exclusão direta continua bloqueada; só a RPC exclui');
reset role;

select ok(not has_function_privilege('anon','public.delete_workout_sheet(uuid,bigint)','EXECUTE'),'anônimo sem execução');
select ok(has_function_privilege('authenticated','public.delete_workout_sheet(uuid,bigint)','EXECUTE'),'autenticado com execução');

select * from finish();
rollback;
