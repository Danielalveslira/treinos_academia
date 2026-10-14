begin;
select no_plan();

-- ..01 membro de A | ..02 membro de A que será banido | ..03 só membro de B | ..04 membro de A com conta desativada
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-feedsec@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'c1000000-%';

insert into public.communities (id, name, created_by) values
  ('c2000000-0000-0000-0000-00000000000a', 'Segurança A', 'c1000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-00000000000b', 'Segurança B', 'c1000000-0000-0000-0000-000000000003');
insert into public.community_members (community_id, user_id) values
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002'),
  ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000004'),
  ('c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000003');

insert into public.statuses (id, community_id, author_id, type, expires_at, text, poll_question, poll_options, workout_title, workout_date, workout_location, promoted, promoted_until)
values
  ('c3000000-0000-0000-0000-0000000000a1', 'c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'poll', now() + interval '1 day', null, 'PA?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', null, null, null, false, null),
  ('c3000000-0000-0000-0000-0000000000b1', 'c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'workout', now() + interval '1 day', null, null, null, 'WA', now() + interval '2 days', 'Academia', false, null),
  ('c3000000-0000-0000-0000-0000000000d1', 'c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000001', 'text', now() + interval '1 day', 'texto privado de A', null, null, null, null, null, true, now() + interval '3 days'),
  ('c3000000-0000-0000-0000-0000000000c1', 'c2000000-0000-0000-0000-00000000000b', 'c1000000-0000-0000-0000-000000000003', 'poll', now() + interval '1 day', null, 'PB?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', null, null, null, false, null);
insert into public.status_votes (status_id, user_id, option_id) values
  ('c3000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000001', '0'),
  ('c3000000-0000-0000-0000-0000000000a1', 'c1000000-0000-0000-0000-000000000002', '1'),
  ('c3000000-0000-0000-0000-0000000000c1', 'c1000000-0000-0000-0000-000000000003', '0');
insert into public.status_participants (status_id, user_id) values
  ('c3000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000001'),
  ('c3000000-0000-0000-0000-0000000000b1', 'c1000000-0000-0000-0000-000000000002');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', case when p = '' then '' else 'c1000000-0000-0000-0000-0000000000' || p end, true)$$;

-- === 1) metadados de segurança das RPCs novas (como superusuário) ===
select is((select prosecdef from pg_proc where oid = 'public.get_poll_results_batch(uuid[])'::regprocedure), true, 'get_poll_results_batch é SECURITY DEFINER (precisa ler contagens que o RLS esconde)');
select is((select prosecdef from pg_proc where oid = 'public.count_workout_participants_batch(uuid[])'::regprocedure), true, 'count_workout_participants_batch é SECURITY DEFINER');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.get_poll_results_batch(uuid[])'::regprocedure), 'get_poll_results_batch tem search_path vazio e nomes qualificados');
select ok((select proconfig::text like '%search_path=public, pg_temp%' from pg_proc where oid = 'public.count_workout_participants_batch(uuid[])'::regprocedure), 'count_workout_participants_batch tem search_path fixo');
select ok(not exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.oid in ('public.get_poll_results_batch(uuid[])'::regprocedure, 'public.count_workout_participants_batch(uuid[])'::regprocedure)
    and a.grantee = 0 and a.privilege_type = 'EXECUTE'), 'nenhuma das duas é executável por PUBLIC');
select ok(not has_function_privilege('anon', 'public.get_poll_results_batch(uuid[])', 'execute') and not has_function_privilege('anon', 'public.count_workout_participants_batch(uuid[])', 'execute'), 'anon não executa nenhuma delas');
select ok(has_function_privilege('authenticated', 'public.get_poll_results_batch(uuid[])', 'execute') and has_function_privilege('authenticated', 'public.count_workout_participants_batch(uuid[])', 'execute'), 'authenticated executa as duas');

-- === 2) migrations auxiliares presentes ===
select has_index('public', 'statuses', 'statuses_community_workout_date_idx', 'índice parcial de treinos existe');
select has_index('public', 'statuses', 'statuses_community_promoted_idx', 'índice parcial de destaques existe');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'statuses_text_check'), 'CHECK (((char_length(text) >= 1) AND (char_length(text) <= 7000)))', 'limite de texto é 7000');

set local role authenticated;

-- === 3) membro legítimo vê o que é dele ===
select pg_temp.as_user('01');
select is((select count(*)::int from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1']::uuid[])), 2, 'membro de A lê os totais da enquete de A');
select is((select participants from public.count_workout_participants_batch(array['c3000000-0000-0000-0000-0000000000b1']::uuid[])), 2, 'membro de A lê os participantes do treino de A');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a'), 3, 'membro de A lê as publicações de A');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000b'), 0, 'membro de A NÃO lê publicações de B');

-- === 4) estranho: nada de A, por nenhum caminho que o app usa ===
select pg_temp.as_user('03');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a'), 0, 'estranho não lê o feed de A (consulta direta)');
select is((select count(*)::int from public.statuses where id = 'c3000000-0000-0000-0000-0000000000d1'), 0, 'estranho não resolve uma publicação de A por id (link compartilhado)');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a' and promoted), 0, 'estranho não lê os destaques de A');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a' and type = 'workout'), 0, 'estranho não lê os treinos de A');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a' and (id is not null or true)), 0, 'filtro "sempre verdadeiro" manipulado também não vaza');
select is((select count(*)::int from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1','c3000000-0000-0000-0000-0000000000c1']::uuid[])), 1, 'RPC de enquetes: só a de B (a de A, mesmo pedida, é ignorada)');
select is((select count(*)::int from public.count_workout_participants_batch(array['c3000000-0000-0000-0000-0000000000b1']::uuid[])), 0, 'RPC de treinos: nada de A para estranho');
select is((select count(*)::int from public.status_votes), 1, 'status_votes só mostra o próprio voto (nunca o de outros)');
select is((select count(*)::int from public.status_participants), 0, 'status_participants não mostra participação alheia');

-- === 5) parâmetros manipulados ===
select pg_temp.as_user('01');
select is((select count(*)::int from public.get_poll_results_batch(null)), 0, 'array nulo = vazio');
select is((select count(*)::int from public.get_poll_results_batch('{}')), 0, 'array vazio = vazio');
select is((select count(*)::int from public.get_poll_results_batch(array[null, null]::uuid[])), 0, 'elementos nulos são ignorados');
select is((select count(*)::int from public.get_poll_results_batch(array_fill('c3000000-0000-0000-0000-0000000000a1'::uuid, array[100]))), 2, 'o mesmo id repetido 100 vezes devolve o mesmo resultado (sem multiplicar linhas)');
select lives_ok($$select count(*) from public.get_poll_results_batch(array_fill('00000000-0000-0000-0000-00000000dead'::uuid, array[200000]))$$, 'array enorme (200 mil) não explode: só os 100 primeiros contam');
select throws_ok($$select * from public.get_poll_results_batch(array['x'']; drop table public.statuses; --']::text[]::uuid[])$$, '22P02', null, 'valor não-uuid é recusado como tipo inválido, sem executar nada');
select ok(to_regclass('public.statuses') is not null, 'a tabela continua existindo após a tentativa de injeção');

-- === 6) banido de A: perde acesso a tudo de A, inclusive pelas RPCs ===
reset role;
insert into public.community_restrictions (community_id, user_id, reason) values ('c2000000-0000-0000-0000-00000000000a', 'c1000000-0000-0000-0000-000000000002', 'teste');
set local role authenticated;
select pg_temp.as_user('02');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a'), 0, 'banido não lê mais o feed de A');
select is((select count(*)::int from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1']::uuid[])), 0, 'banido não lê totais da enquete (RPC em lote)');
select is((select count(*)::int from public.count_workout_participants_batch(array['c3000000-0000-0000-0000-0000000000b1']::uuid[])), 0, 'banido não lê participantes do treino (RPC em lote)');

-- === 7) conta desativada: sem acesso, mesmo sendo membro ===
reset role;
update public.users set account_status = 'disabled' where id = 'c1000000-0000-0000-0000-000000000004';
set local role authenticated;
select pg_temp.as_user('04');
select is((select count(*)::int from public.statuses where community_id = 'c2000000-0000-0000-0000-00000000000a'), 0, 'conta desativada não lê o feed');
select is((select count(*)::int from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1']::uuid[])), 0, 'conta desativada não lê enquetes pela RPC');
select is((select count(*)::int from public.count_workout_participants_batch(array['c3000000-0000-0000-0000-0000000000b1']::uuid[])), 0, 'conta desativada não lê treinos pela RPC');

-- === 8) sem identidade (token sem sub) e anônimo ===
select pg_temp.as_user('');
select is((select count(*)::int from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1']::uuid[])), 0, 'sem sub no token: RPC não devolve nada');
select is((select count(*)::int from public.statuses), 0, 'sem sub no token: nenhuma publicação');
reset role;
set local role anon;
select throws_ok($$select * from public.get_poll_results_batch(array['c3000000-0000-0000-0000-0000000000a1']::uuid[])$$, '42501', null, 'anon: RPC de enquetes negada');
select throws_ok($$select * from public.count_workout_participants_batch(array['c3000000-0000-0000-0000-0000000000b1']::uuid[])$$, '42501', null, 'anon: RPC de treinos negada');
-- (anon tem o privilégio de tabela padrão do Supabase; quem barra é o RLS: nenhuma linha)
select is((select count(*)::int from public.statuses), 0, 'anon: RLS não devolve nenhuma publicação');
select throws_ok($$select * from public.status_votes$$, '42501', null, 'anon: grant de leitura de votos revogado');

select * from finish();
rollback;
