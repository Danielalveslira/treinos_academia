\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('97a00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','sheet-attr-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,2) n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('97a00000-0000-0000-0000-000000000001','97a00000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('97c00000-0000-0000-0000-000000000001','evolutus_dataset','sheet-attr-1','Oficial','peito',array['peito'],'forca',array['Empurre'],'published'),
('97c00000-0000-0000-0000-000000000003','evolutus_dataset','sheet-attr-3','Outro oficial','peito',array['peito'],'forca',array['Empurre'],'published');
-- 1/2: acct1's and acct2's exercise, both ends up as sheet items. 3: acct1's exercise that is
-- NEVER added to any sheet -- used to prove sheet<->exercise membership is actually checked.
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
select ('97e00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
  case when n=2 then '97a00000-0000-0000-0000-000000000002' else '97a00000-0000-0000-0000-000000000001' end::uuid,
  'Oficial','Peito','catalog','evolutus_dataset',
 case when n=3 then 'sheet-attr-3' else 'sheet-attr-1' end,
 case when n=3 then '97c00000-0000-0000-0000-000000000003' else '97c00000-0000-0000-0000-000000000001' end::uuid,'strength'
from generate_series(1,3) n;

-- Cria uma ficha com o exercício 1 como item real e devolve {id,revision} (precisa do revision
-- certo de create_workout_sheet -- ele mesmo já grava uma vez por dentro, então a revisão de
-- partida NÃO é 1 -- para o save_workout_sheet seguinte não cair em SHEET_VERSION_CONFLICT).
create function pg_temp.new_sheet_with_item(p_name text, p_exercise_id uuid) returns jsonb
language sql as $$
  with created as (select public.create_workout_sheet(gen_random_uuid(),p_name) result)
  select public.save_workout_sheet(
    (result->>'id')::uuid,(result->>'revision')::bigint,
    jsonb_build_object('name',p_name,'weekdays','[]'::jsonb),
    jsonb_build_array(jsonb_build_object('exercise_id',p_exercise_id))
  ) from created
$$;

select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
-- Ficha A: dono = conta 1, com o exercício 1 como item real.
create temp table sheet_a as select pg_temp.new_sheet_with_item('Ficha A','97e00000-0000-0000-0000-000000000001') result;
-- Segunda ficha do MESMO dono, também com o exercício 1: isola o teste de reatribuição da
-- checagem de FK entre contas (já coberta à parte) e da checagem de associação ficha<->exercício.
create temp table sheet_a2 as select pg_temp.new_sheet_with_item('Ficha A2','97e00000-0000-0000-0000-000000000001') result;
-- Ficha arquivada (mesmo dono, mesmo item) -- iniciar um treino nela deve ser rejeitado mesmo
-- com um item válido, igual já vale para "Iniciar treino" na tela (SHEET_NOT_READY).
create temp table sheet_archived as select pg_temp.new_sheet_with_item('Ficha Arquivada','97e00000-0000-0000-0000-000000000001') result;
select public.set_workout_sheet_archived(
  (select (result->>'id')::uuid from sheet_archived),true,(select (result->>'revision')::bigint from sheet_archived)
);
reset role;

select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000002',true);
set local role authenticated;
create temp table sheet_b as select pg_temp.new_sheet_with_item('Ficha B','97e00000-0000-0000-0000-000000000002') result;
reset role;

select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
set local role authenticated;

-- === Associação válida: grava normalmente =================================================
select lives_ok(
  format($q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,sheet_id)
    values('97f00000-0000-0000-0000-000000000001',auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_a)),
  'grava sheet_id da própria ficha, com exercício que é item real dela'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),(select (result->>'id')::uuid from sheet_a),'sheet_id salvo corretamente');

-- === FK composta: propriedade da ficha ======================================================
select throws_ok(
  format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_b)),
  'P0001','SHEET_NOT_FOUND','ficha de outra conta é rejeitada (FK composta exige o mesmo user_id)'
);
select throws_ok(
  $q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',gen_random_uuid())$q$,
  'P0001','SHEET_NOT_FOUND','ficha inexistente é rejeitada'
);

-- === Associação ficha<->exercício: a FK sozinha não bastava =================================
-- Mesma conta, ficha de verdade (sheet_a), mas o exercício 3 NUNCA foi adicionado a ela.
select throws_ok(
  format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000003',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_EXERCISE_MISMATCH','exercício que não é item da ficha é rejeitado, mesmo pertencendo ao mesmo dono'
);
-- Ficha arquivada: o item É real (exercício 1 está nela), mas a ficha está arquivada.
select throws_ok(
  format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_archived)),
  'P0001','SHEET_NOT_READY','ficha arquivada é rejeitada mesmo com o item correto'
);
-- Integridade transacional: remover o item e tentar de novo no mesmo instante reflete o estado
-- ATUAL (não um cache antigo) -- prova que a checagem é contra a tabela real, não memorizada.
select public.save_workout_sheet(
  (select (result->>'id')::uuid from sheet_a2),(select (result->>'revision')::bigint from sheet_a2),
  '{"name":"Ficha A2","weekdays":[]}'::jsonb,'[]'::jsonb
);
select throws_ok(
  format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
    values(auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
    (select (result->>'id')::uuid from sheet_a2)),
  'P0001','SHEET_EXERCISE_MISMATCH','item removido da ficha deixa de valer imediatamente'
);

-- === Treino livre continua sem ficha ========================================================
select lives_ok(
  $q$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details)
    values('97f00000-0000-0000-0000-000000000002',auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":5,"reps":5}]')$q$,
  'sheet_id continua opcional (treino livre, sem ficha)'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000002'),null,'sem ficha fica null, não inventado');

-- Atribuição é um fato da criação: não pode ser adicionada retroativamente.
select throws_ok(
  format($q$update public.workouts set sheet_id=%L where id='97f00000-0000-0000-0000-000000000002'$q$,(select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_ID_IMMUTABLE','não inventa associação retroativa'
);
-- O que é bloqueado é REATRIBUIR: um registro já vinculado a uma ficha não pode "pular" para
-- outra (sheet_a2 continua sendo do mesmo dono -- isola isto da checagem de FK entre contas).
select throws_ok(
  format($q$update public.workouts set sheet_id=%L where id='97f00000-0000-0000-0000-000000000002'$q$,(select (result->>'id')::uuid from sheet_a2)),
  'P0001','SHEET_ID_IMMUTABLE','reatribuir para uma ficha diferente depois de já ter uma é bloqueado'
);
-- Só a exclusão física privilegiada, via FK, pode limpar a associação.
select throws_ok(
  $q$update public.workouts set sheet_id=null where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','SHEET_ID_IMMUTABLE','cliente não pode limpar o vínculo'
);
select lives_ok(
  $q$update public.workouts set note='ajustada' where id='97f00000-0000-0000-0000-000000000001'$q$,
  'editar outros campos continua permitido'
);
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),(select (result->>'id')::uuid from sheet_a),'editar nota não altera sheet_id');

-- === Guardas pré-existentes continuam ativas (a função foi estendida, não reduzida) =========
-- now() é fixo durante toda a transação do teste -- igual ao created_at já gravado -- por isso
-- compara contra um valor deliberadamente diferente, não contra now().
select throws_ok(
  $q$update public.workouts set created_at=created_at + interval '1 day' where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','CREATED_AT_IMMUTABLE','guarda pré-existente de created_at continua em vigor'
);
select throws_ok(
  $q$update public.workouts set type='cardio' where id='97f00000-0000-0000-0000-000000000001'$q$,
  'P0001','TYPE_IMMUTABLE','guarda pré-existente de type continua em vigor'
);

-- Updates of real mutable fields are applied, not merely accepted.
select lives_ok($q$update public.workouts set sets=1,set_details='[{"weight":25,"reps":12}]',note='ajustada'
 where id='97f00000-0000-0000-0000-000000000001'$q$,'edita peso, repetições e nota');
select is((select set_details from public.workouts where id='97f00000-0000-0000-0000-000000000001'),
 '[{"weight":25,"reps":12}]'::jsonb,'conteúdo da série realmente atualizado');
select is((select note from public.workouts where id='97f00000-0000-0000-0000-000000000001'),'ajustada','nota realmente atualizada');
select throws_ok($q$update public.workouts set exercise_id='97e00000-0000-0000-0000-000000000003'
 where id='97f00000-0000-0000-0000-000000000001'$q$,'P0001','SHEET_EXERCISE_IMMUTABLE','não troca exercício por fora da ficha');
select throws_ok($q$update public.workouts set user_id=null where id='97f00000-0000-0000-0000-000000000001'$q$,
 'P0001','USER_ID_IMMUTABLE','dono é imutável mesmo para null');
select is((select count(*)::int from public.workouts),2,'tentativas inválidas não deixam registros parciais');
-- Archive preserves attribution and editable historical rows.
select public.set_workout_sheet_archived((select (result->>'id')::uuid from sheet_a),true,
 (select (result->>'revision')::bigint from sheet_a));
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),
 (select (result->>'id')::uuid from sheet_a),'arquivar preserva vínculo histórico');
select lives_ok($q$update public.workouts set note='após arquivo' where id='97f00000-0000-0000-0000-000000000001'$q$,
 'histórico continua editável após arquivo');
select is((public.get_my_sheet_insights()->'sheets'->0->>'month_days')::int,1,'atividade parcial conta um dia, não conclusão');
reset role;
update public.exercise_catalog set status='draft' where id='97c00000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok(format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
 values(auth.uid(),'97e00000-0000-0000-0000-000000000001',(now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',%L)$q$,
 (select (result->>'id')::uuid from sheet_a2)), 'P0001','SHEET_EXERCISE_UNAVAILABLE','oficial retirado não aceita novo registro');
select throws_ok('delete from public.workout_sheets','42501',null,'usuário arquiva, não exclui fisicamente');
reset role;
select pg_temp.revoke_test_session('97a00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok('select public.get_my_sheet_insights()','P0001','SESSION_REVOKED','RPC exige sessão ativa');
select is((select count(*)::int from public.workouts),0,'RLS oculta registros com sessão revogada');
reset role;
select pg_temp.set_test_user('97a00000-0000-0000-0000-000000000001',true);
-- === Exclusão da ficha preserva o histórico E o dono do registro ===========================
reset role;
delete from public.workout_sheets where id=(select (result->>'id')::uuid from sheet_a);
select is((select count(*)::int from public.workouts where user_id='97a00000-0000-0000-0000-000000000001'),2,'excluir a ficha não apaga os treinos');
select is((select sheet_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),null,'FK on delete set null (restrita a sheet_id) limpa o vínculo');
select is((select user_id from public.workouts where id='97f00000-0000-0000-0000-000000000001'),'97a00000-0000-0000-0000-000000000001'::uuid,'o DONO do registro NUNCA é tocado pela exclusão da ficha (bug corrigido: a FK antiga zerava user_id também)');

select lives_ok($q$delete from auth.users where id='97a00000-0000-0000-0000-000000000001'$q$,'exclusão de conta mantém cascatas');
select is((select count(*)::int from public.workouts where user_id='97a00000-0000-0000-0000-000000000001'),0,'conta excluída não deixa treinos');
select matches(pg_get_constraintdef(oid),'FOREIGN KEY \(sheet_id, user_id\).*ON DELETE SET NULL \(sheet_id\)',
 'FK composta mantém propriedade e limpa somente sheet_id') from pg_constraint where conname='workouts_sheet_id_fkey';
select * from finish();
rollback;
