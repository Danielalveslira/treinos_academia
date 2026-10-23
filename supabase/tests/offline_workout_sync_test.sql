\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Fixtures (prefixo c3...): A e B, cada um com um exercício.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c3000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
  'u' || n || '-offlinesync@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01', '02']) as n;

insert into public.exercises (id, user_id, name, muscle_group) values
  ('c3e00000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', 'Supino A', 'Peito'),
  ('c3e00000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', 'Supino B', 'Peito');

-- Sessão ATIVA de A e de B (private.current_session_active() -- ver 20261113000001). Uma delas é
-- revogada mais abaixo, simulando "sair de todos os dispositivos" feito em outro aparelho.
insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('c3900000-0000-0000-0000-000000000001', 'c3000000-0000-0000-0000-000000000001', now(), now()),
  ('c3900000-0000-0000-0000-000000000002', 'c3000000-0000-0000-0000-000000000002', now(), now());

-- Igual à sessão de A, mas sua janela (not_after) já venceu -- mesmo efeito de revogada.
insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('c3900000-0000-0000-0000-000000000009', 'c3000000-0000-0000-0000-000000000001', now(), now(), now() - interval '1 minute');

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform pg_temp.as_user_with_session(p_uid,
    case p_uid
      when 'c3000000-0000-0000-0000-000000000001' then 'c3900000-0000-0000-0000-000000000001'
      when 'c3000000-0000-0000-0000-000000000002' then 'c3900000-0000-0000-0000-000000000002'
      else null
    end);
end;
$$;

-- Simula um JWT com um session_id arbitrário (nulo, de outra sessão/usuário, vencido ou
-- inexistente) -- único jeito de exercitar private.current_session_active() negando o acesso,
-- já que o cliente NUNCA escolhe seu próprio session_id (ele vem do GoTrue, não de parâmetro).
create or replace function pg_temp.as_user_with_session(p_uid text, p_session text) returns void language plpgsql as $$
begin
  perform pg_temp.set_test_user( coalesce(p_uid, ''), true);
  perform set_config(
    'request.jwt.claims',
    case when p_uid is null or p_uid = '' then '{}'
      else jsonb_build_object('sub', p_uid, 'session_id', p_session)::text
    end,
    true
  );
end;
$$;

-- Monta uma mutação no formato do cliente.
create or replace function pg_temp.m(p_op text, p_mid text, p_eid text, p_payload jsonb default null, p_base text default null)
returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('mutation_id', p_mid, 'operation', p_op, 'entity_id', p_eid,
    'payload', p_payload, 'base_updated_at', p_base))
$$;

create or replace function pg_temp.strength(p_exercise text, p_weight numeric default 80, p_date text default '2026-10-05')
returns jsonb language sql as $$
  select jsonb_build_object('exercise_id', p_exercise, 'date', p_date, 'type', 'strength',
    'set_details', jsonb_build_array(jsonb_build_object('weight', p_weight, 'reps', 10)), 'sets', 1, 'note', 'offline')
$$;

create or replace function pg_temp.sync(p_batch jsonb) returns jsonb language sql as $$
  select public.sync_workout_mutations(p_batch)
$$;

create or replace function pg_temp.status(p_result jsonb, p_idx int default 0) returns text language sql as $$
  select p_result->'results'->p_idx->>'status'
$$;

create or replace function pg_temp.code(p_result jsonb, p_idx int default 0) returns text language sql as $$
  select p_result->'results'->p_idx->>'code'
$$;

-- IDs
create temp table ids as select
  'c3000000-0000-0000-0000-000000000001'::text as a,
  'c3000000-0000-0000-0000-000000000002'::text as b,
  'c3e00000-0000-0000-0000-000000000001'::text as ex_a,
  'c3e00000-0000-0000-0000-000000000002'::text as ex_b,
  'c3a00000-0000-0000-0000-000000000001'::text as w1,
  'c3a00000-0000-0000-0000-000000000002'::text as w2,
  'c3a00000-0000-0000-0000-000000000003'::text as w3;
grant select on ids to public;
create temp table snap (k text primary key, v jsonb);

-- ===== Grants e exposição ==========================================================================
select ok(not has_function_privilege('anon', 'public.sync_workout_mutations(jsonb, uuid)', 'execute'), 'anon NÃO executa a RPC de sync');
select ok(has_function_privilege('authenticated', 'public.sync_workout_mutations(jsonb, uuid)', 'execute'), 'authenticated executa a RPC');
select ok(not has_function_privilege('authenticated', 'private.apply_workout_mutation(uuid, jsonb)', 'execute'), 'a função interna não é chamável por clientes');
select ok(not has_table_privilege('authenticated', 'public.offline_mutation_receipts', 'select')
  and not has_table_privilege('anon', 'public.offline_mutation_receipts', 'select')
  and not has_table_privilege('authenticated', 'public.offline_mutation_receipts', 'insert'), 'recibos não são acessíveis aos clientes');
select ok((select relrowsecurity from pg_class where oid = 'public.offline_mutation_receipts'::regclass), 'RLS ligada nos recibos');
select ok((select prosecdef from pg_proc where oid = 'public.sync_workout_mutations(jsonb, uuid)'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.sync_workout_mutations(jsonb, uuid)'::regprocedure) @> array['search_path=public, pg_temp'],
  'SECURITY DEFINER com search_path fixo');

-- ===== Identidade ====================================================================================
select pg_temp.as_user('');
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'NOT_AUTHENTICATED', 'sem auth.uid() nada executa');

select pg_temp.as_user((select a from ids));
select throws_ok(format($$select public.sync_workout_mutations('[]'::jsonb, %L)$$, (select b from ids)), 'USER_MISMATCH',
  'fila de B enviada sob a sessão de A é recusada inteira');
select is(public.sync_workout_mutations('[]'::jsonb, (select a::uuid from ids)), '{"results": []}'::jsonb, 'lote vazio com o usuário esperado correto');
select throws_ok($$select public.sync_workout_mutations('{"a":1}'::jsonb)$$, 'INVALID_BATCH', 'lote que não é array é recusado');
select throws_ok($$select public.sync_workout_mutations(null)$$, 'INVALID_BATCH', 'lote nulo é recusado');
select throws_ok($$select public.sync_workout_mutations((select jsonb_agg('{}'::jsonb) from generate_series(1, 51)))$$, 'BATCH_TOO_LARGE', 'lote acima de 50 é recusado');

-- ===== Sessão revogada (Etapa 3 do PROMPT_CORRECAO_LOGOUT_GLOBAL_EVOLUTUS) ==========================
-- "Sair de todos os dispositivos" em outro aparelho apaga a sessão de auth.sessions, mas o access
-- token já emitido continua assinaturalmente válido até expirar (jwt_expiry). Estas são a prova de
-- que o JWT antigo, sozinho, não basta MAIS para escrever treino: o banco confirma a sessão.
select pg_temp.as_user((select a from ids));
select is(public.sync_workout_mutations('[]'::jsonb), '{"results": []}'::jsonb, 'sessão ativa de A: lote vazio passa');

select pg_temp.as_user_with_session((select a from ids), null);
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'SESSION_REVOKED', 'JWT sem claim session_id (token emitido antes deste deploy) é recusado, não aceito como sessão antiga válida');

select pg_temp.as_user_with_session((select a from ids), 'nao-eh-um-uuid');
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'SESSION_REVOKED', 'session_id malformado nunca lança erro de cast -- falha fechada como qualquer outra sessão sem correspondência');

select pg_temp.as_user_with_session((select a from ids), 'c3900000-0000-0000-0000-000000000099');
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'SESSION_REVOKED', 'session_id que não existe em auth.sessions (já revogada/nunca existiu) é recusado');

select pg_temp.as_user_with_session((select a from ids), 'c3900000-0000-0000-0000-000000000002');
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'SESSION_REVOKED', 'session_id de OUTRO usuário nunca autoriza -- confrontado também com auth.uid()');

select pg_temp.as_user_with_session((select a from ids), 'c3900000-0000-0000-0000-000000000009');
select throws_ok($$select pg_temp.sync('[]'::jsonb)$$, 'SESSION_REVOKED', 'sessão com not_after no passado é tratada como revogada mesmo com a linha ainda existindo em auth.sessions');

select pg_temp.as_user((select a from ids)); -- restaura a sessão ativa normal de A para o resto do arquivo

-- ===== Create =========================================================================================
insert into snap select 'tx_before', to_jsonb((select count(*) from public.economy_transactions));

select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001', (select w1 from ids),
  pg_temp.strength((select ex_a from ids))))), 0), 'applied', 'create offline é aplicado');
select is((select count(*)::int from public.workouts where id = (select w1::uuid from ids) and user_id = (select a::uuid from ids)), 1,
  'a linha nasceu com o id gerado pelo cliente e o user_id do servidor');
select ok((select created_at > now() - interval '1 minute' and updated_at is not null from public.workouts where id = (select w1::uuid from ids)),
  'created_at é o carimbo do servidor (gatilho existente) e updated_at foi preenchido');

-- o mesmo lote 1x, 2x, 10x: mesmo efeito
select is((select pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001', (select w1 from ids),
  pg_temp.strength((select ex_a from ids))))), 0)), 'already_applied', 'reenviar o create não reaplica');
do $$
begin
  for i in 1..8 loop
    perform pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001',
      'c3a00000-0000-0000-0000-000000000001', pg_temp.strength('c3e00000-0000-0000-0000-000000000001'))));
  end loop;
end $$;
select is((select count(*)::int from public.workouts where user_id = (select a::uuid from ids)), 1, '10 envios do mesmo create deixam UMA linha');
select is((select count(*)::int from public.offline_mutation_receipts where user_id = (select a::uuid from ids)), 1, 'e um único recibo');

select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001', (select w1 from ids),
  pg_temp.strength((select ex_a from ids))))), 0) , 'already_applied', 'resposta repetida traz já-aplicado');
select ok((pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001', (select w1 from ids),
  pg_temp.strength((select ex_a from ids)))))->'results'->0->'row'->>'id') = (select w1 from ids), 'e devolve a linha atual para o cliente se reconciliar');

-- ===== CRÍTICO: INSERT ONLINE confirmado + timeout no cliente ===========================================================
-- Diferente de perder o ACK da RPC: aqui o INSERT direto chegou ao Postgres, NÃO existe recibo, o cliente
-- tratou o timeout como falha de rede e a MESMA criação voltou pela fila.
insert into snap select 'tx_before_insert_cases', to_jsonb((select count(*) from public.economy_transactions));

-- (a) Conteúdo igual: já-aplicado, sem duplicar, sem mexer em created_at, com recibo.
insert into public.workouts (id, user_id, exercise_id, set_details, sets, date, note, type)
  values ((select w2::uuid from ids), (select a::uuid from ids), (select ex_a::uuid from ids), '[{"weight": 50, "reps": 10}]', 1, '2026-10-05', 'offline', 'strength');
insert into snap select 'w2_created', to_jsonb((select created_at from public.workouts where id = (select w2::uuid from ids)));
insert into snap select 'w2_updated_at', to_jsonb((select updated_at from public.workouts where id = (select w2::uuid from ids)));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000002', (select w2 from ids),
  pg_temp.strength((select ex_a from ids), 50)))), 0), 'already_applied', '(a) INSERT online confirmado + create igual via fila = já-aplicado');
select is((select count(*)::int from public.workouts where id = (select w2::uuid from ids)), 1, '(a) sem duplicar');
select is((select to_jsonb(created_at) from public.workouts where id = (select w2::uuid from ids)), (select v from snap where k = 'w2_created'), '(a) created_at intacto');
select is((select to_jsonb(updated_at) from public.workouts where id = (select w2::uuid from ids)), (select v from snap where k = 'w2_updated_at'), '(a) updated_at intacto: nada foi reescrito');
select is((select count(*)::int from public.offline_mutation_receipts where mutation_id = 'c3b00000-0000-0000-0000-000000000002'), 1, '(a) recibo criado');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000002', (select w2 from ids),
  pg_temp.strength((select ex_a from ids), 50)))), 0), 'already_applied', '(a) reenvio seguinte também é já-aplicado (agora pelo recibo)');

-- (b) O usuário EDITOU depois do timeout (a edição foi compactada dentro do create) e ninguém mais mexeu na linha:
--     aplica como atualização -- a edição do usuário NÃO se perde -- sem tocar created_at.
insert into public.workouts (id, user_id, exercise_id, set_details, sets, date, note, type)
  values ('c3a00000-0000-0000-0000-0000000000f1', (select a::uuid from ids), (select ex_a::uuid from ids), '[{"weight": 40, "reps": 10}]', 1, '2026-10-05', 'offline', 'strength');
insert into snap select 'f1_created', to_jsonb((select created_at from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f1'));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f1', 'c3a00000-0000-0000-0000-0000000000f1',
  pg_temp.strength((select ex_a from ids), 45)))), 0), 'applied', '(b) linha intocada + conteúdo local mais novo = aplica a edição do usuário');
select is((select set_details->0->>'weight' from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f1'), '45', '(b) a edição do usuário chegou ao servidor');
select is((select to_jsonb(created_at) from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f1'), (select v from snap where k = 'f1_created'), '(b) created_at nunca muda');
select is((select count(*)::int from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f1'), 1, '(b) sem duplicar');

-- (c) OUTRO aparelho alterou a linha depois do INSERT, e o create antigo chega com conteúdo diferente do atual:
--     NÃO é já-aplicado às cegas e NÃO sobrescreve: conflito, com a linha do servidor para o usuário decidir.
insert into public.workouts (id, user_id, exercise_id, set_details, sets, date, note, type)
  values ('c3a00000-0000-0000-0000-0000000000f2', (select a::uuid from ids), (select ex_a::uuid from ids), '[{"weight": 30, "reps": 10}]', 1, '2026-10-05', 'offline', 'strength');
update public.workouts set set_details = '[{"weight": 33, "reps": 10}]' where id = 'c3a00000-0000-0000-0000-0000000000f2'; -- "outro aparelho"
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f2', 'c3a00000-0000-0000-0000-0000000000f2',
  pg_temp.strength((select ex_a from ids), 30)))), 0), 'conflict', '(c) INSERT confirmado, depois alterado em outro aparelho, create antigo = CONFLITO');
select is((select set_details->0->>'weight' from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f2'), '33', '(c) o que está no servidor NÃO foi sobrescrito');
select is((select count(*)::int from public.offline_mutation_receipts where mutation_id = 'c3b00000-0000-0000-0000-0000000000f2'), 0, '(c) sem recibo: a decisão do usuário ainda pode acontecer');
select ok(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f2', 'c3a00000-0000-0000-0000-0000000000f2',
  pg_temp.strength((select ex_a from ids), 30))))->'results'->0->'server_row' is not null, '(c) devolve a linha do servidor ao cliente');
-- (c2) "Manter o meu": reenvia com a versão ATUAL como base e aplica.
insert into snap select 'f2_updated', to_jsonb((select updated_at from public.workouts where id = 'c3a00000-0000-0000-0000-0000000000f2'));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f2', 'c3a00000-0000-0000-0000-0000000000f2',
  pg_temp.strength((select ex_a from ids), 30), (select (v #>> '{}') from snap where k = 'f2_updated')))), 0), 'applied', '(c2) "manter o meu" (base = versão atual) aplica');
-- (d) Outro aparelho alterou, mas o resultado já é EXATAMENTE o que o create pede: equivalente, sem conflito falso.
insert into public.workouts (id, user_id, exercise_id, set_details, sets, date, note, type)
  values ('c3a00000-0000-0000-0000-0000000000f3', (select a::uuid from ids), (select ex_a::uuid from ids), '[{"weight": 30, "reps": 10}]', 1, '2026-10-05', 'offline', 'strength');
update public.workouts set set_details = '[{"weight": 35, "reps": 10}]' where id = 'c3a00000-0000-0000-0000-0000000000f3';
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f3', 'c3a00000-0000-0000-0000-0000000000f3',
  pg_temp.strength((select ex_a from ids), 35)))), 0), 'already_applied', '(d) alterado depois, mas já igual ao pedido = já-aplicado, sem conflito falso');
-- (e) Tipo diferente nunca converte um registro.
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-0000000000f4', 'c3a00000-0000-0000-0000-0000000000f1',
  jsonb_build_object('exercise_id', (select ex_a from ids), 'date', '2026-10-05', 'type', 'cardio', 'duration_minutes', 30)))), 0), 'TYPE_IMMUTABLE', '(e) create de outro tipo sobre registro existente é recusado');
-- (f) Nenhum desses fluxos gera EvoCoins nem mexe em economia.
select is((select count(*)::int from public.economy_transactions), (select (v #>> '{}')::int from snap where k = 'tx_before_insert_cases'),
  '(f) nenhum fluxo de INSERT online + retry cria transação de EvoCoins');
select is((select count(*)::int from public.workouts where user_id = (select a::uuid from ids) and id in ('c3a00000-0000-0000-0000-0000000000f1','c3a00000-0000-0000-0000-0000000000f2','c3a00000-0000-0000-0000-0000000000f3')), 3, '(f) uma linha por id, nunca duplicada');

-- ===== Update ==========================================================================================
insert into snap select 'w1_updated_0', to_jsonb((select updated_at from public.workouts where id = (select w1::uuid from ids)));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000003', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 85), (select (v #>> '{}') from snap where k = 'w1_updated_0')))), 0), 'applied',
  'update com a versão-base certa é aplicado');
select is((select set_details->0->>'weight' from public.workouts where id = (select w1::uuid from ids)), '85', 'valor atualizado');
select ok((select updated_at > (select (v #>> '{}')::timestamptz from snap where k = 'w1_updated_0') from public.workouts where id = (select w1::uuid from ids)),
  'updated_at avançou');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000003', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 85), (select (v #>> '{}') from snap where k = 'w1_updated_0')))), 0), 'already_applied',
  'update duplicado é idempotente (recibo), mesmo com a base já velha');
select is((select set_details->0->>'weight' from public.workouts where id = (select w1::uuid from ids)), '85', 'e não reaplica');

-- Conflito: outro aparelho mudou o treino depois da versão-base deste. Nada é sobrescrito.
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000004', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 70), (select (v #>> '{}') from snap where k = 'w1_updated_0')))), 0), 'conflict',
  'base antiga + conteúdo diferente = conflito');
select is((select set_details->0->>'weight' from public.workouts where id = (select w1::uuid from ids)), '85', 'o treino remoto NÃO foi sobrescrito');
select ok(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000005', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 70), (select (v #>> '{}') from snap where k = 'w1_updated_0'))))->'results'->0->'server_row' is not null,
  'o conflito devolve a linha do servidor para o cliente decidir');
select is((select count(*)::int from public.offline_mutation_receipts where mutation_id = 'c3b00000-0000-0000-0000-000000000004'), 0, 'conflito não gera recibo (pode ser retomado)');
-- mesma mutação, mas o resultado pedido já é o que está no servidor: nada a decidir
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000006', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 85), (select (v #>> '{}') from snap where k = 'w1_updated_0')))), 0), 'already_applied',
  'conflito aparente com conteúdo idêntico vira já-aplicado');
-- "manter o meu": reenviar com a base atual aplica
insert into snap select 'w1_updated_1', to_jsonb((select updated_at from public.workouts where id = (select w1::uuid from ids)));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000007', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 70), (select (v #>> '{}') from snap where k = 'w1_updated_1')))), 0), 'applied', 'reenvio com a base atual (decisão do usuário) é aplicado');
-- sem base conhecida: só vale se o treino nunca foi editado desde a criação
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000008', (select w1 from ids),
  pg_temp.strength((select ex_a from ids), 60)))), 0), 'CONFLICT', 'sem base e treino já editado: conflito, não sobrescreve');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000009', (select w2 from ids),
  pg_temp.strength((select ex_a from ids), 61)))), 0), 'applied', 'sem base e treino nunca editado: aplica');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-00000000000a', 'c3a00000-0000-0000-0000-0000000000ff',
  pg_temp.strength((select ex_a from ids))))), 0), 'NOT_FOUND', 'update de um treino que não existe (apagado em outro aparelho) é recusado');

-- updated_at também avança no UPDATE direto (caminho online de hoje)
insert into snap select 'w2_before', to_jsonb((select updated_at from public.workouts where id = (select w2::uuid from ids)));
select pg_sleep(0.01);
update public.workouts set note = 'direto' where id = (select w2::uuid from ids);
select ok((select updated_at > (select (v #>> '{}')::timestamptz from snap where k = 'w2_before') from public.workouts where id = (select w2::uuid from ids)),
  'UPDATE direto também move updated_at (gatilho)');

-- ===== Delete ============================================================================================
insert into snap select 'w2_updated', to_jsonb((select updated_at from public.workouts where id = (select w2::uuid from ids)));
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-00000000000b', (select w2 from ids), null,
  (select (v #>> '{}') from snap where k = 'w2_before')))), 0), 'conflict', 'delete com base antiga (alterado depois) é conflito: não apaga trabalho que mudou');
select is((select count(*)::int from public.workouts where id = (select w2::uuid from ids)), 1, 'o treino segue lá');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-00000000000c', (select w2 from ids), null,
  (select (v #>> '{}') from snap where k = 'w2_updated')))), 0), 'applied', 'delete com a base certa é aplicado');
select is((select count(*)::int from public.workouts where id = (select w2::uuid from ids)), 0, 'apagado');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-00000000000c', (select w2 from ids), null,
  (select (v #>> '{}') from snap where k = 'w2_updated')))), 0), 'already_applied', 'delete duplicado é idempotente');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-00000000000d', (select w2 from ids)))), 0), 'already_applied',
  'delete de algo que já não existe: o estado desejado já vale');

-- ===== Isolamento entre usuários ==========================================================================
select pg_temp.as_user((select b from ids));
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000011', (select w1 from ids),
  pg_temp.strength((select ex_b from ids), 1)))), 0), 'NOT_FOUND', 'B não altera o treino de A (nem descobre que existe)');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-000000000012', (select w1 from ids)))), 0), 'already_applied',
  'B tentando apagar o treino de A: nada acontece com ele');
select pg_temp.as_user((select a from ids));
select is((select set_details->0->>'weight' from public.workouts where id = (select w1::uuid from ids)), '70', 'o treino de A segue intacto');
select pg_temp.as_user((select b from ids));
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000013', (select w1 from ids),
  pg_temp.strength((select ex_b from ids))))), 0), 'ENTITY_ID_IN_USE', 'B não cria usando o id de um treino de A');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000014', (select w3 from ids),
  pg_temp.strength((select ex_a from ids))))), 0), 'EXERCISE_NOT_FOUND', 'B não grava um treino com o exercício de A');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000015', (select w3 from ids),
  pg_temp.strength((select ex_b from ids))))), 0), 'applied', 'B cria o próprio treino normalmente');
select is((select user_id::text from public.workouts where id = (select w3::uuid from ids)), (select b from ids), 'e a linha é de B (identidade vem de auth.uid())');
-- o mesmo mutation_id em contas diferentes não colide (recibo é por usuário)
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000001', 'c3a00000-0000-0000-0000-0000000000b1',
  pg_temp.strength((select ex_b from ids))))), 0), 'applied', 'mutation_id igual de outra conta é independente');

-- ===== Validação de payload ===================================================================================
select pg_temp.as_user((select a from ids));
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000021', 'c3a00000-0000-0000-0000-0000000000c1',
  pg_temp.strength((select ex_a from ids)) || jsonb_build_object('user_id', (select b from ids))))), 0), 'INVALID_PAYLOAD', 'user_id no payload é recusado, não ignorado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000022', 'c3a00000-0000-0000-0000-0000000000c2',
  pg_temp.strength((select ex_a from ids)) || jsonb_build_object('created_at', '2020-01-01')))), 0), 'INVALID_PAYLOAD', 'created_at do cliente é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000023', 'c3a00000-0000-0000-0000-0000000000c3',
  pg_temp.strength((select ex_a from ids), -5)))), 0), 'INVALID_PAYLOAD', 'peso negativo viola a constraint existente e é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000024', 'c3a00000-0000-0000-0000-0000000000c4',
  pg_temp.strength((select ex_a from ids), 80, '2026-02-31')))), 0), 'INVALID_PAYLOAD', 'data impossível é recusada');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000025', 'c3a00000-0000-0000-0000-0000000000c5',
  pg_temp.strength((select ex_a from ids), 80, 'ontem')))), 0), 'INVALID_PAYLOAD', 'data fora do formato é recusada');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000026', 'c3a00000-0000-0000-0000-0000000000c6',
  jsonb_set(pg_temp.strength((select ex_a from ids)), '{sets}', '3')))), 0), 'INVALID_PAYLOAD', 'sets que não bate com set_details é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000027', 'c3a00000-0000-0000-0000-0000000000c7',
  jsonb_set(pg_temp.strength((select ex_a from ids)), '{set_details}', '[{"weight":"abc","reps":3}]')))), 0), 'INVALID_PAYLOAD', 'peso não numérico é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000028', 'c3a00000-0000-0000-0000-0000000000c8',
  jsonb_set(pg_temp.strength((select ex_a from ids)), '{set_details}', (select jsonb_agg('{"weight":1,"reps":1}'::jsonb) from generate_series(1, 11)))))), 0), 'INVALID_PAYLOAD',
  'mais de 10 séries é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000029', 'c3a00000-0000-0000-0000-0000000000c9',
  jsonb_set(pg_temp.strength((select ex_a from ids)), '{note}', to_jsonb(repeat('x', 301)))))), 0), 'INVALID_PAYLOAD', 'nota acima de 300 caracteres é recusada');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-00000000002a', 'c3a00000-0000-0000-0000-0000000000ca',
  jsonb_build_object('exercise_id', (select ex_a from ids), 'date', '2026-10-05', 'type', 'cardio', 'duration_minutes', 0)))), 0), 'INVALID_PAYLOAD', 'cardio com duração inválida é recusado');
select is(pg_temp.status(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-00000000002b', 'c3a00000-0000-0000-0000-0000000000cb',
  jsonb_build_object('exercise_id', (select ex_a from ids), 'date', '2026-10-05', 'type', 'cardio', 'duration_minutes', 30, 'distance_km', 5)))), 0), 'applied', 'cardio válido é aplicado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-00000000002c', 'c3a00000-0000-0000-0000-0000000000cc', null))), 0),
  'INVALID_PAYLOAD', 'create sem payload é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-00000000002d', 'c3a00000-0000-0000-0000-0000000000cb',
  pg_temp.strength((select ex_a from ids))))), 0), 'TYPE_IMMUTABLE', 'trocar o tipo de um treino é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(jsonb_build_object('mutation_id', 'c3b00000-0000-0000-0000-00000000002e', 'operation', 'workout.truncate',
  'entity_id', 'c3a00000-0000-0000-0000-0000000000cd'))), 0), 'UNSUPPORTED_OPERATION', 'operação fora da lista fechada é recusada');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(jsonb_build_object('mutation_id', 'nao-e-uuid', 'operation', 'workout.delete',
  'entity_id', 'c3a00000-0000-0000-0000-0000000000cd'))), 0), 'INVALID_MUTATION_ID', 'mutation_id inválido é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-00000000002f', 'não-uuid', pg_temp.strength((select ex_a from ids))))), 0),
  'INVALID_ENTITY_ID', 'entity_id inválido é recusado');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(jsonb_build_object('mutation_id', 'c3b00000-0000-0000-0000-000000000030', 'operation', 'workout.delete',
  'entity_id', 'c3a00000-0000-0000-0000-0000000000cd', 'table', 'users'))), 0), 'INVALID_MUTATION', 'campo desconhecido na mutação é recusado (nunca aceita nome de tabela)');
select is(pg_temp.code(pg_temp.sync('[1, "x", null]'::jsonb), 0), 'INVALID_MUTATION', 'elementos que não são objetos são recusados sem derrubar o lote');
select is(pg_temp.code(pg_temp.sync(jsonb_build_array(pg_temp.m('workout.delete', 'c3b00000-0000-0000-0000-000000000001', 'c3a00000-0000-0000-0000-0000000000cb'))), 0),
  'MUTATION_ID_REUSED', 'reaproveitar um mutation_id para outra operação é recusado');

-- Resultado por mutação: uma inválida não bloqueia as outras; dependente da que falhou não passa na frente.
select is((select string_agg(coalesce(r->>'code', r->>'status'), ',' order by (r->>'index')::int) from jsonb_array_elements(pg_temp.sync(jsonb_build_array(
    pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000051', 'c3a00000-0000-0000-0000-0000000000e1', pg_temp.strength((select ex_a from ids), -1)),
    pg_temp.m('workout.update', 'c3b00000-0000-0000-0000-000000000052', 'c3a00000-0000-0000-0000-0000000000e1', pg_temp.strength((select ex_a from ids), 10)),
    pg_temp.m('workout.create', 'c3b00000-0000-0000-0000-000000000053', 'c3a00000-0000-0000-0000-0000000000e2', pg_temp.strength((select ex_a from ids), 10))
  ))->'results') r), 'INVALID_PAYLOAD,DEPENDENCY_FAILED,applied', 'inválida + dependente + independente: só a independente passa');

-- ===== EvoCoins / efeitos financeiros =================================================================================
select is((select count(*)::int from public.economy_transactions), (select (v #>> '{}')::int from snap where k = 'tx_before'),
  'sincronizar treinos NÃO cria nenhuma transação de EvoCoins');
select ok((select prosrc !~* '(complete_workout_session|award_evocoins|economy_|evocoin|wallet)' from pg_proc where oid = 'private.apply_workout_mutation(uuid, jsonb)'::regprocedure)
  and (select prosrc !~* '(complete_workout_session|award_evocoins|economy_|evocoin|wallet)' from pg_proc where oid = 'public.sync_workout_mutations(jsonb, uuid)'::regprocedure),
  'o código da RPC não referencia recompensa nem economia');

-- ===== Acesso: anon e papel authenticated reais ========================================================================
set local role anon;
select throws_ok($$select public.sync_workout_mutations('[]'::jsonb)$$, '42501', null, 'anon recebe permission denied na RPC');
reset role;
set local role authenticated;
select pg_temp.as_user((select a from ids));
select throws_ok($$select * from public.offline_mutation_receipts$$, '42501', null, 'authenticated não lê os recibos');
select throws_ok($$insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome) values ('c3000000-0000-0000-0000-000000000001', gen_random_uuid(), 'workout.delete', gen_random_uuid(), 'applied')$$,
  '42501', null, 'authenticated não forja recibos');
select is(public.sync_workout_mutations('[]'::jsonb), '{"results": []}'::jsonb, 'authenticated executa a RPC de verdade');
reset role;

select * from finish();
rollback;
