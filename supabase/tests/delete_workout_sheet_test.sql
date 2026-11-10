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
  (select count(*) from public.economy_transactions) coins,
  public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date) progress;
select lives_ok(
  format($$select public.delete_workout_sheet('%s',(select (result->>'revision')::bigint from sheet_a))$$,
    (select (result->>'id')::uuid from sheet_a)),
  'exclui ficha própria com a revisão correta'
);
-- P0 (auditoria 2026-11-10): excluir deixou de ser um DELETE físico de workout_sheets -- a linha
-- agora é um tombstone (deleted_at preenchido). workouts/workout_sheet_completions continuam
-- apontando para uma linha-mãe real para sempre, e o resumo de Progresso nunca precisa "esquecer"
-- o nome/fatos de uma ficha excluída (ver asserção dedicada depois de 'reset role' abaixo).
select is((select count(*)::int from public.workout_sheets where id=(select (result->>'id')::uuid from sheet_a)),0,'ficha some para leitura direta via RLS (authenticated), mesmo sem ter sido apagada');
reset role;
select is((select count(*)::int from public.workout_sheets where id=(select (result->>'id')::uuid from sheet_a) and deleted_at is not null),1,'linha-mãe sobrevive como tombstone -- nunca mais um DELETE físico');
select is((select count(*)::int from public.workout_sheet_exercises where sheet_id=(select (result->>'id')::uuid from sheet_a)),0,'planejamento atual (não é fato histórico) é removido de verdade');
select is((select count(*)::int from public.workout_sheet_completions where sheet_id=(select (result->>'id')::uuid from sheet_a)),1,'conclusão histórica sobrevive -- não é mais cascade-deletada junto com a ficha');
select is((select sheet_id from public.workouts where id='99f00000-0000-0000-0000-000000000001'),(select (result->>'id')::uuid from sheet_a),'treino preserva o vínculo histórico EXATO com a ficha excluída (nunca mais zerado pela FK)');
select is((select user_id from public.workouts where id='99f00000-0000-0000-0000-000000000001'),'99a00000-0000-0000-0000-000000000001'::uuid,'dono do treino nunca é tocado');
select is((select count(*) from public.workouts),(select workouts from counts_before_delete),'exclusão da ficha não apaga nenhum treino');
select is((select count(*) from public.economy_transactions),(select coins from counts_before_delete),'exclusão da ficha não altera recompensas');
set local role authenticated;
select pg_temp.set_test_user('99a00000-0000-0000-0000-000000000001',true);
select is(
  public.get_my_progress_sheet_summary((now() at time zone 'America/Sao_Paulo')::date,(now() at time zone 'America/Sao_Paulo')::date),
  (select progress from counts_before_delete),
  'Progresso devolve exatamente os mesmos fatos (trainedOccurrences/completedOccurrences/distinctSheets/nomes) antes e depois da exclusão'
);
select throws_ok($$select public.get_my_workout_sheet((select (result->>'id')::uuid from sheet_a))$$,'P0001','SHEET_NOT_FOUND','ficha excluída não é mais consultável/editável, mesmo pelo dono');
select is(jsonb_array_length(public.list_my_workout_sheets(true)),0,'ficha excluída não aparece na lista de arquivadas, mesmo tendo archived_at preenchido');
select is((public.get_my_sheet_insights()->'sheets'),'[]'::jsonb,'ficha excluída não aparece no painel da Home');

select throws_ok(
  format($$select public.delete_workout_sheet('%s',1)$$,(select (result->>'id')::uuid from sheet_a)),
  'P0001','SHEET_NOT_FOUND','segunda exclusão da mesma ficha é idempotente, sem efeito colateral'
);
select throws_ok($$delete from public.workout_sheets$$,'42501',null,'exclusão direta continua bloqueada; só a RPC exclui');

-- Revisão pedida (4.3): um treino criado OFFLINE (ainda na fila, nunca chegou ao servidor)
-- aponta para esta ficha, já excluída. Sincronizar depois precisa REJEITAR com SHEET_NOT_FOUND
-- (o trigger workouts_00_validate_sheet_membership corre no INSERT de
-- private.apply_workout_mutation, chamado por public.sync_workout_mutations) -- nunca inserir
-- com o vínculo quebrado, nunca remover sheet_id do payload por conta própria do servidor.
create or replace function pg_temp.offline_create(p_mid text,p_eid text,p_exercise text,p_sheet text default null) returns jsonb
language sql as $$
  select jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'mutation_id',p_mid,'operation','workout.create','entity_id',p_eid,
    'payload',jsonb_strip_nulls(jsonb_build_object('exercise_id',p_exercise,'date','2026-10-05','type','strength',
      'set_details',jsonb_build_array(jsonb_build_object('weight',20,'reps',10)),'sets',1,'note','offline','sheet_id',p_sheet))
  )))
$$;
select is(
  public.sync_workout_mutations(pg_temp.offline_create(
    '99d00000-0000-0000-0000-000000000001','99f00000-0000-0000-0000-000000000002',
    '99e00000-0000-0000-0000-000000000001',(select (result->>'id')::uuid from sheet_a)::text
  ))->'results'->0->>'code',
  'SHEET_NOT_FOUND',
  'treino offline para ficha já excluída é rejeitado, não inserido com vínculo quebrado'
);
select is((select count(*)::int from public.workouts where id='99f00000-0000-0000-0000-000000000002'),0,'rejeição não deixa linha parcial/órfã');
-- Reenviar o MESMO mutation_id sem sheet_id (recuperação correta: o cliente larga só o vínculo
-- inválido -- o servidor nunca faz isso sozinho) aplica e preserva a atividade real do usuário.
select is(
  public.sync_workout_mutations(pg_temp.offline_create(
    '99d00000-0000-0000-0000-000000000001','99f00000-0000-0000-0000-000000000002',
    '99e00000-0000-0000-0000-000000000001'
  ))->'results'->0->>'status',
  'applied',
  'o mesmo registro, reenviado sem o vínculo quebrado, é aceito e preserva a atividade real'
);
select is((select sheet_id from public.workouts where id='99f00000-0000-0000-0000-000000000002'),null,'treino recuperado fica sem ficha, nunca com uma inventada');
reset role;

select ok(not has_function_privilege('anon','public.delete_workout_sheet(uuid,bigint)','EXECUTE'),'anônimo sem execução');
select ok(has_function_privilege('authenticated','public.delete_workout_sheet(uuid,bigint)','EXECUTE'),'autenticado com execução');

select * from finish();
rollback;
