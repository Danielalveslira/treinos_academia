begin;
select no_plan();

-- ..01 dono | ..02 membro que será banido | ..03 sem vínculo | ..04 só membro de B | ..05 conta desativada
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('d5000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-joinlist@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'd5000000-%';

insert into public.communities (id, name, created_by, owner_id, is_active) values
  ('d6000000-0000-0000-0000-00000000000a', 'Join A', 'd5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', true),
  ('d6000000-0000-0000-0000-00000000000b', 'Join B', 'd5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', true),
  ('d6000000-0000-0000-0000-00000000000c', 'Join C inativa', 'd5000000-0000-0000-0000-000000000001', 'd5000000-0000-0000-0000-000000000001', false);
insert into public.community_members (community_id, user_id) values
  ('d6000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-000000000001'),
  ('d6000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-000000000002'),
  ('d6000000-0000-0000-0000-00000000000b', 'd5000000-0000-0000-0000-000000000004');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', case when p = '' then '' else 'd5000000-0000-0000-0000-0000000000' || p end, true)$$;
create or replace function pg_temp.rows_affected(q text) returns bigint language plpgsql as
  $$declare n bigint; begin execute q; get diagnostics n = row_count; return n; end$$;

-- === 1) metadados de segurança ===
select is((select prosecdef from pg_proc where oid = 'public.join_community(uuid)'::regprocedure), true, 'join_community é SECURITY DEFINER');
select ok((select proconfig::text like '%pg_temp%' from pg_proc where oid = 'public.join_community(uuid)'::regprocedure), 'join_community: search_path com pg_temp');
select ok(not has_function_privilege('anon', 'public.join_community(uuid)', 'execute'), 'anon não executa join_community');
select ok(has_function_privilege('authenticated', 'public.join_community(uuid)', 'execute'), 'authenticated executa join_community');
select is((select prosecdef from pg_proc where oid = 'public.list_my_community_access()'::regprocedure), false, 'list_my_community_access é SECURITY INVOKER (só lê o que o RLS libera)');
select ok(not has_function_privilege('anon', 'public.list_my_community_access()', 'execute'), 'anon não executa list_my_community_access');
select has_index('public', 'community_restrictions', 'community_restrictions_user_idx', 'índice por user_id existe');

set local role authenticated;

-- === 2) estados de entrada ===
select pg_temp.as_user('03');
select is(public.join_community('d6000000-0000-0000-0000-00000000000a'), 'joined', 'sem vínculo: entra (joined)');
select is(public.join_community('d6000000-0000-0000-0000-00000000000a'), 'already_member', 'entrar de novo: already_member (idempotente, sem erro)');
select is(public.join_community('d6000000-0000-0000-0000-00000000000c'), 'unavailable', 'comunidade inativa: unavailable');
select is(public.join_community('d6000000-0000-0000-0000-0000000000ff'), 'unavailable', 'comunidade inexistente: unavailable');
select pg_temp.as_user('');
select throws_ok($$select public.join_community('d6000000-0000-0000-0000-00000000000a')$$, 'PERMISSION_DENIED', 'sem sessão: PERMISSION_DENIED');
select pg_temp.as_user('01');
select lives_ok(
  $$select public.set_community_member_ban('d6000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-000000000002', true, 'motivo de teste do join')$$,
  'dono bane 02');
select pg_temp.as_user('02');
select is(public.join_community('d6000000-0000-0000-0000-00000000000a'), 'banned', 'banido: banned (estado, não exceção)');
select is(public.join_community('d6000000-0000-0000-0000-00000000000a'), 'banned', 'banido tentando de novo: continua banned');
select is((select count(*) from public.community_members where user_id = 'd5000000-0000-0000-0000-000000000002'), 0::bigint, 'banido não entrou');

-- === 3) defesa backend permanece: INSERT direto é recusado COM código identificável ===
select throws_ok(
  $$insert into public.community_members (community_id, user_id) values ('d6000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-000000000002')$$,
  '42501', 'COMMUNITY_BANNED', 'INSERT direto do banido falha com COMMUNITY_BANNED');
select throws_ok(
  $$insert into public.community_members (community_id, user_id) values ('d6000000-0000-0000-0000-00000000000c', 'd5000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'INSERT direto em comunidade inativa segue recusado pelo RLS');

-- === 4) listagem: UMA consulta devolve o estado de todas as comunidades ===
select pg_temp.as_user('03');
select results_eq(
  $$select community_id::text, access from public.list_my_community_access() order by 1$$,
  $$values ('d6000000-0000-0000-0000-00000000000a', 'member')$$,
  'membro 03: só A como member');
select pg_temp.as_user('02');
select results_eq(
  $$select community_id::text, access from public.list_my_community_access() order by 1$$,
  $$values ('d6000000-0000-0000-0000-00000000000a', 'banned')$$,
  'banido 02: A como banned; as demais ficam ausentes (not_member)');
select pg_temp.as_user('04');
select results_eq(
  $$select community_id::text, access from public.list_my_community_access() order by 1$$,
  $$values ('d6000000-0000-0000-0000-00000000000b', 'member')$$,
  '04: só B como member, nunca o estado de outra pessoa');
select pg_temp.as_user('');
select is((select count(*) from public.list_my_community_access()), 0::bigint, 'sem sessão: lista vazia');

-- banido que (por dado legado) ainda tenha vínculo: banido tem precedência
reset role;
insert into public.community_members (community_id, user_id) values ('d6000000-0000-0000-0000-00000000000b', 'd5000000-0000-0000-0000-000000000002');
insert into public.community_restrictions (community_id, user_id) values ('d6000000-0000-0000-0000-00000000000b', 'd5000000-0000-0000-0000-000000000002');
set local role authenticated;
select pg_temp.as_user('02');
select is((select access from public.list_my_community_access() where community_id = 'd6000000-0000-0000-0000-00000000000b'), 'banned', 'precedência: banned vence');
select is((select count(*) from public.list_my_community_access() where community_id = 'd6000000-0000-0000-0000-00000000000b'), 1::bigint, 'e a comunidade aparece uma única vez');

-- === 5) desbanir devolve apenas a possibilidade de entrar ===
select pg_temp.as_user('01');
select lives_ok($$select public.set_community_member_ban('d6000000-0000-0000-0000-00000000000a', 'd5000000-0000-0000-0000-000000000002', false)$$, 'dono desbane 02');
select pg_temp.as_user('02');
select is((select count(*) from public.list_my_community_access() where community_id = 'd6000000-0000-0000-0000-00000000000a'), 0::bigint, 'desbanido: not_member (ausente da lista)');
select is(public.join_community('d6000000-0000-0000-0000-00000000000a'), 'joined', 'desbanido entra de novo');

-- === 6) lote grande numa única transação não esgota a memória de locks (trava em baldes fixos) ===
reset role;
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), 'authenticated', 'authenticated', 'bulk' || n || '@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1, 6000) n;
select lives_ok(
  $$insert into public.community_members (community_id, user_id)
    select 'd6000000-0000-0000-0000-00000000000b', u.id from auth.users u where u.email like 'bulk%@example.invalid'$$,
  'INSERT de 6000 vínculos numa transação funciona (sem out of shared memory)'
);
select lives_ok(
  $$insert into public.community_restrictions (community_id, user_id)
    select 'd6000000-0000-0000-0000-00000000000b', u.id from auth.users u where u.email like 'bulk%@example.invalid'$$,
  'e banir 6000 de uma vez também (o trigger remove os vínculos)'
);
select is((select count(*) from public.community_members m join public.community_restrictions r using (community_id, user_id)), 0::bigint, 'invariante mantida no lote');
select ok((select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()) <= 512, 'a transação segura no máximo 512 travas advisory');

select * from finish();
rollback;
