\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 membro com aceite (true)  ..02 membro SEM aceite (has_app_access NULL)  ..03 não membro
-- ..04 membro banido  ..05 superadmin  ..06 autor  ..11..15 participantes  ..16 participante sem perfil público
-- ..17 participante que será excluído
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('71000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-parts@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05','06','11','12','13','14','15','16','17']) as n;

update public.legal_policy set version = 'v-test', digest = 'digest-test', published = true where id;
insert into public.legal_policy (id, version, digest, published) select true, 'v-test', 'digest-test', true
  where not exists (select 1 from public.legal_policy);
update public.users set legal_acceptance_version = 'v-test', legal_acceptance_digest = 'digest-test'
  where id::text like '71000000-%' and right(id::text, 2) not in ('02', '05');
update public.users set role = 'superadmin' where id = '71000000-0000-0000-0000-000000000005';
insert into public.public_profiles (user_id, username)
select id, 'part' || right(id::text, 2) from public.users
 where id::text like '71000000-%' and right(id::text, 2) not in ('16')
on conflict (user_id) do update set username = excluded.username;

insert into public.communities (id, name, created_by) values ('72000000-0000-0000-0000-000000000001', 'Comunidade participantes', '71000000-0000-0000-0000-000000000006');
insert into public.community_members (community_id, user_id)
select '72000000-0000-0000-0000-000000000001', ('71000000-0000-0000-0000-0000000000' || n)::uuid
  from unnest(array['01','02','04','06','11','12','13','14','15','16','17']) as n;
insert into public.community_restrictions (community_id, user_id) values ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000004');

-- treino A: vários participantes; treino B: 1 participante; treino C: vazio; D: publicação que não é treino
insert into public.statuses (id, community_id, author_id, type, workout_title, workout_date, workout_location, expires_at) values
  ('73000000-0000-0000-0000-00000000000a', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000006', 'workout', 'Treino A', now() + interval '1 day', 'Parque', now() + interval '2 days'),
  ('73000000-0000-0000-0000-00000000000b', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000006', 'workout', 'Treino B', now() + interval '1 day', 'Parque', now() + interval '2 days'),
  ('73000000-0000-0000-0000-00000000000c', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000006', 'workout', 'Treino C', now() + interval '1 day', 'Parque', now() + interval '2 days');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('73000000-0000-0000-0000-00000000000d', '72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000006', 'text', 'não é treino', now() + interval '2 days');

insert into public.status_participants (status_id, user_id, joined_at) values
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000011', now() - interval '6 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000012', now() - interval '5 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000013', now() - interval '4 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000014', now() - interval '3 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000015', now() - interval '2 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000016', now() - interval '1 hours'),
  ('73000000-0000-0000-0000-00000000000a', '71000000-0000-0000-0000-000000000017', now() - interval '30 minutes'),
  ('73000000-0000-0000-0000-00000000000b', '71000000-0000-0000-0000-000000000011', now());

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( '71000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.names(j jsonb) returns text language sql as
  $$select coalesce(string_agg(coalesce(e ->> 'username', 'Membro'), ',' order by ord), '') from jsonb_array_elements(j -> 'participants') with ordinality t(e, ord)$$;

-- premissa: os três estados de has_app_access
select pg_temp.as_user('01');
select is(public.has_app_access(), true, 'premissa: membro com aceite -> true');
select pg_temp.as_user('02');
select ok(public.has_app_access() is null, 'premissa: membro sem aceite -> NULL');

-- === lista: vários participantes, ordem de confirmação, campos mínimos ===
select pg_temp.as_user('01');
create temp table _a as select public.list_workout_participants('73000000-0000-0000-0000-00000000000a') r;
select is((select jsonb_array_length(r -> 'participants') from _a), 7, 'treino A: lista traz os 7 participantes (a RLS direta só mostraria a própria linha)');
select is(pg_temp.names((select r from _a)), 'part11,part12,part13,part14,part15,Membro,part17', 'ordem: quem confirmou primeiro, primeiro; sem perfil público vira "Membro"');
select is((select string_agg(k, ',' order by k) from _a, jsonb_object_keys(r -> 'participants' -> 0) k), 'userId,username', 'item devolve APENAS userId e username');
select ok((select r -> 'participants' -> 5 -> 'username' = 'null'::jsonb from _a), 'public_profile ausente: username null (sem quebrar)');
select is((select r -> 'nextCursor' from _a), 'null'::jsonb, 'sem próxima página quando tudo cabe');
select is(public.count_workout_participants('73000000-0000-0000-0000-00000000000a'), 7, 'contagem real = 7');

-- === 1 participante e vazio ===
select is(pg_temp.names(public.list_workout_participants('73000000-0000-0000-0000-00000000000b')), 'part11', 'treino com 1 participante');
select is(public.count_workout_participants('73000000-0000-0000-0000-00000000000b'), 1, 'contagem 1');
select is((public.list_workout_participants('73000000-0000-0000-0000-00000000000c') -> 'participants'), '[]'::jsonb, 'lista vazia');
select is(public.count_workout_participants('73000000-0000-0000-0000-00000000000c'), 0, 'contagem 0');

-- === paginação ===
create temp table _p1 as select public.list_workout_participants('73000000-0000-0000-0000-00000000000a', null, null, 3) r;
select is(pg_temp.names((select r from _p1)), 'part11,part12,part13', 'página 1 (limite 3)');
create temp table _p2 as select public.list_workout_participants('73000000-0000-0000-0000-00000000000a',
  (select (r -> 'nextCursor' ->> 'at')::timestamptz from _p1), (select (r -> 'nextCursor' ->> 'userId')::uuid from _p1), 3) r;
select is(pg_temp.names((select r from _p2)), 'part14,part15,Membro', 'página 2 continua sem repetir');
create temp table _p3 as select public.list_workout_participants('73000000-0000-0000-0000-00000000000a',
  (select (r -> 'nextCursor' ->> 'at')::timestamptz from _p2), (select (r -> 'nextCursor' ->> 'userId')::uuid from _p2), 3) r;
select is(pg_temp.names((select r from _p3)), 'part17', 'página 3 (última)');
select is((select r -> 'nextCursor' from _p3), 'null'::jsonb, 'última página sem cursor');
select is(jsonb_array_length(public.list_workout_participants('73000000-0000-0000-0000-00000000000a', null, null, 1000) -> 'participants'), 7, 'limite máximo saneado');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000a', now(), null, 5)$$, 'INVALID_CURSOR', 'cursor incompleto recusado');

-- === acesso ===
select pg_temp.as_user('02');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'has_app_access NULL (sem aceite): bloqueado -- fail-closed');
select throws_ok($$select public.count_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'contagem também fail-closed com NULL');
select pg_temp.as_user('03');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'não membro: bloqueado');
select throws_ok($$select public.count_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'não membro: contagem bloqueada');
select pg_temp.as_user('04');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'banido da comunidade: bloqueado');
select pg_temp.as_user('05');
select is(jsonb_array_length(public.list_workout_participants('73000000-0000-0000-0000-00000000000a') -> 'participants'), 7, 'superadmin: permitido (mesma regra de quem vê a publicação)');
select pg_temp.set_test_user( '', true);
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000a')$$, 'NOT_AUTHENTICATED', 'sem autenticação: bloqueado');
select ok(not has_function_privilege('anon', 'public.list_workout_participants(uuid, timestamptz, uuid, integer)', 'execute')
      and not has_function_privilege('anon', 'public.count_workout_participants(uuid)', 'execute'), 'anon não executa as RPCs');
select ok(not has_function_privilege('authenticated', 'public._can_view_workout_status(public.statuses)', 'execute'), 'helper interno não é chamável pelo cliente');

-- === publicação removida / que não é treino ===
select pg_temp.as_user('01');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-0000000000ff')$$, 'STATUS_NOT_FOUND', 'publicação inexistente/removida');
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000d')$$, 'STATUS_NOT_FOUND', 'publicação que não é treino');
select throws_ok($$select public.count_workout_participants('73000000-0000-0000-0000-0000000000ff')$$, 'STATUS_NOT_FOUND', 'contagem de publicação removida');

-- === conta excluída: some da lista, contagem acompanha, modal não quebra ===
select pg_temp.as_user('05');
select public.queue_deletion('account', '71000000-0000-0000-0000-000000000017');
select public.run_deletion_job(id) from public.deletion_jobs where target_id = '71000000-0000-0000-0000-000000000017';
select pg_temp.as_user('01');
select is(pg_temp.names(public.list_workout_participants('73000000-0000-0000-0000-00000000000a')), 'part11,part12,part13,part14,part15,Membro', 'conta excluída sai da lista, sem quebrar');
select is(public.count_workout_participants('73000000-0000-0000-0000-00000000000a'), 6, 'contagem acompanha a exclusão (7 -> 6)');
-- perfil público removido depois: continua listando como Membro
delete from public.public_profiles where user_id = '71000000-0000-0000-0000-000000000012';
select is(pg_temp.names(public.list_workout_participants('73000000-0000-0000-0000-00000000000a')), 'part11,Membro,part13,part14,part15,Membro', 'perfil público removido: "Membro"');
-- publicação removida depois: erro claro, não crash
delete from public.statuses where id = '73000000-0000-0000-0000-00000000000b';
select throws_ok($$select public.list_workout_participants('73000000-0000-0000-0000-00000000000b')$$, 'STATUS_NOT_FOUND', 'publicação apagada depois: STATUS_NOT_FOUND');

-- === por que não dá para ler direto: a RLS só mostra a própria linha (e não há FK para embutir public_profiles) ===
select is((select count(*)::int from pg_constraint c where c.conrelid = 'public.status_participants'::regclass and c.contype = 'f'
            and c.confrelid = 'public.public_profiles'::regclass), 0, 'não existe FK status_participants -> public_profiles (o embed do PostgREST não tem como funcionar)');
select is((select count(*)::int from pg_constraint c where c.conrelid = 'public.status_participants'::regclass and c.contype = 'f'
            and c.confrelid = 'public.users'::regclass), 1, 'status_participants.user_id referencia users');
set local role authenticated;
select pg_temp.as_user('11');
select is((select count(*)::int from public.status_participants where status_id = '73000000-0000-0000-0000-00000000000a'), 1, 'leitura direta (RLS): um participante só enxerga a PRÓPRIA linha, nunca os outros 5');
reset role;

select * from finish();
rollback;
