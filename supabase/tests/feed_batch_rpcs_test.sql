begin;
select no_plan();

-- ..01 e ..02 membros da comunidade A; ..03 não membro de A (membro só de B)
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('a1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-feedbatch@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'a1000000-%';

insert into public.communities (id, name, created_by) values
  ('a2000000-0000-0000-0000-00000000000a', 'Feed Batch A', 'a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-00000000000b', 'Feed Batch B', 'a1000000-0000-0000-0000-000000000003');
insert into public.community_members (community_id, user_id) values
  ('a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000003');

-- A: enquete P1 (3 votos), enquete P2 (sem votos), treino W1 (2 participantes), treino W2 (0)
-- B: enquete PB e treino WB (invisíveis para ..01/..02)
insert into public.statuses (id, community_id, author_id, type, expires_at, poll_question, poll_options, workout_title, workout_date, workout_location)
values
  ('a3000000-0000-0000-0000-0000000000a1', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'poll', now() + interval '1 day', 'P1?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', null, null, null),
  ('a3000000-0000-0000-0000-0000000000a2', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'poll', now() + interval '1 day', 'P2?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', null, null, null),
  ('a3000000-0000-0000-0000-0000000000b1', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'workout', now() + interval '1 day', null, null, 'W1', now() + interval '2 days', 'Academia'),
  ('a3000000-0000-0000-0000-0000000000b2', 'a2000000-0000-0000-0000-00000000000a', 'a1000000-0000-0000-0000-000000000001', 'workout', now() + interval '1 day', null, null, 'W2', now() + interval '2 days', 'Academia'),
  ('a3000000-0000-0000-0000-0000000000c1', 'a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000003', 'poll', now() + interval '1 day', 'PB?', '[{"id":"0","label":"a"},{"id":"1","label":"b"}]', null, null, null),
  ('a3000000-0000-0000-0000-0000000000c2', 'a2000000-0000-0000-0000-00000000000b', 'a1000000-0000-0000-0000-000000000003', 'workout', now() + interval '1 day', null, null, 'WB', now() + interval '2 days', 'Academia');
insert into public.status_votes (status_id, user_id, option_id) values
  ('a3000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000001', '0'),
  ('a3000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000002', '0'),
  ('a3000000-0000-0000-0000-0000000000a1', 'a1000000-0000-0000-0000-000000000003', '1'),
  ('a3000000-0000-0000-0000-0000000000c1', 'a1000000-0000-0000-0000-000000000003', '1');
insert into public.status_participants (status_id, user_id) values
  ('a3000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-0000000000b1', 'a1000000-0000-0000-0000-000000000002'),
  ('a3000000-0000-0000-0000-0000000000c2', 'a1000000-0000-0000-0000-000000000003');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-0000000000' || p, true)$$;

set local role authenticated;
select pg_temp.as_user('01');

-- === enquetes: o lote devolve exatamente o que a função unitária devolve ===
select results_eq(
  $$select option_id, votes from public.get_poll_results_batch(array['a3000000-0000-0000-0000-0000000000a1']::uuid[]) order by option_id$$,
  $$select option_id, votes from public.get_poll_results('a3000000-0000-0000-0000-0000000000a1') order by option_id$$,
  'poll batch == unitária para uma enquete visível'
);
select is(
  (select count(distinct status_id)::int from public.get_poll_results_batch(array[
    'a3000000-0000-0000-0000-0000000000a1','a3000000-0000-0000-0000-0000000000a2']::uuid[])),
  1, 'enquete sem votos não gera linha (a tela completa com 0)'
);
select is(
  (select count(*)::int from public.get_poll_results_batch(array['a3000000-0000-0000-0000-0000000000c1']::uuid[])),
  0, 'enquete de comunidade onde o chamador NÃO é membro não volta (fail-closed, sem exceção)'
);
select is(
  (select count(*)::int from public.get_poll_results_batch(array[
    'a3000000-0000-0000-0000-0000000000a1','a3000000-0000-0000-0000-0000000000c1','00000000-0000-0000-0000-00000000dead']::uuid[])),
  2, 'lote misto: só as linhas visíveis (2 opções da enquete A1); id inexistente e id de B ignorados'
);
select is((select count(*)::int from public.get_poll_results_batch(null)), 0, 'array nulo = vazio');
select is(
  (select count(*)::int from public.get_poll_results_batch(array['a3000000-0000-0000-0000-0000000000b1']::uuid[])),
  0, 'id de treino não é enquete: ignorado'
);

-- === treinos ===
select results_eq(
  $$select participants from public.count_workout_participants_batch(array['a3000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  $$select public.count_workout_participants('a3000000-0000-0000-0000-0000000000b1')$$,
  'workout batch == unitária'
);
select results_eq(
  $$select status_id::text, participants from public.count_workout_participants_batch(array['a3000000-0000-0000-0000-0000000000b1','a3000000-0000-0000-0000-0000000000b2']::uuid[]) order by 1$$,
  $$values ('a3000000-0000-0000-0000-0000000000b1', 2), ('a3000000-0000-0000-0000-0000000000b2', 0)$$,
  'treino sem participantes volta com 0 (uma linha por treino visível)'
);
select is(
  (select count(*)::int from public.count_workout_participants_batch(array['a3000000-0000-0000-0000-0000000000c2']::uuid[])),
  0, 'treino de comunidade onde o chamador NÃO é membro não volta'
);

-- === teto de 100 ids: o 101º (real) é ignorado ===
select is(
  (select count(*)::int from public.get_poll_results_batch(
    array_fill('00000000-0000-0000-0000-00000000dead'::uuid, array[100]) || array['a3000000-0000-0000-0000-0000000000a1']::uuid[])),
  0, 'só os 100 primeiros ids são considerados'
);

-- === não membro de A e anon ===
select pg_temp.as_user('03');
select is(
  (select count(*)::int from public.get_poll_results_batch(array['a3000000-0000-0000-0000-0000000000a1']::uuid[])),
  0, 'não membro da comunidade A não lê os totais da enquete de A'
);
select is(
  (select count(*)::int from public.count_workout_participants_batch(array['a3000000-0000-0000-0000-0000000000b1']::uuid[])),
  0, 'não membro da comunidade A não lê os participantes de A'
);
reset role;
set local role anon;
select throws_ok(
  $$select * from public.get_poll_results_batch(array['a3000000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501', null, 'anon não executa get_poll_results_batch'
);
select throws_ok(
  $$select * from public.count_workout_participants_batch(array['a3000000-0000-0000-0000-0000000000b1']::uuid[])$$,
  '42501', null, 'anon não executa count_workout_participants_batch'
);

select * from finish();
rollback;
