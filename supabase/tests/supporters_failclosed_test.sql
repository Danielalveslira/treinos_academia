begin;
select no_plan();

-- ..01 membro com acesso válido (has_app_access = true)   ..02 membro SEM aceite dos Termos (NULL)
-- ..03 membro desativado (false)  ..04 não membro com acesso  ..05 superadmin  ..06 membro banido da comunidade
-- ..07 apoiador   ..08 quem NÃO curtiu   ..09 autor
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('6c000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-failclosed@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05','06','07','08','09']) as n;

-- Termos publicados: só quem aceitou a versão vigente tem has_app_access = true; quem não aceitou = NULL.
update public.legal_policy set version = 'v-test', digest = 'digest-test', published = true where id;
insert into public.legal_policy (id, version, digest, published) select true, 'v-test', 'digest-test', true
  where not exists (select 1 from public.legal_policy);
update public.users set legal_acceptance_version = 'v-test', legal_acceptance_digest = 'digest-test'
  where id::text like '6c000000-%' and right(id::text, 2) not in ('02', '05');
update public.users set role = 'superadmin' where id = '6c000000-0000-0000-0000-000000000005';
update public.users set account_status = 'disabled', disabled_reason = 'teste fail-closed' where id = '6c000000-0000-0000-0000-000000000003';
insert into public.public_profiles (user_id, username)
select id, 'curtidor' || right(id::text, 2) from public.users where id::text like '6c000000-%'
on conflict (user_id) do update set username = excluded.username;

insert into public.communities (id, name, created_by) values ('6d000000-0000-0000-0000-000000000001', 'Comunidade fail-closed', '6c000000-0000-0000-0000-000000000009');
insert into public.community_members (community_id, user_id)
select '6d000000-0000-0000-0000-000000000001', ('6c000000-0000-0000-0000-0000000000' || n)::uuid from unnest(array['01','02','03','06','07','08','09']) as n;
insert into public.community_restrictions (community_id, user_id) values ('6d000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000006');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('6e000000-0000-0000-0000-000000000001', '6d000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000009', 'text', 'publicação', now() + interval '2 days');
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('6e000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000007', '6c000000-0000-0000-0000-000000000009', 1),
       ('6e000000-0000-0000-0000-000000000001', '6c000000-0000-0000-0000-000000000008', '6c000000-0000-0000-0000-000000000009', -1);

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', '6c000000-0000-0000-0000-0000000000' || p, true)$$;

-- === premissas: os três valores possíveis de has_app_access() ===
select pg_temp.as_user('01');
select is(public.has_app_access(), true, 'premissa: membro com aceite -> has_app_access() = true');
select pg_temp.as_user('02');
select ok(public.has_app_access() is null, 'premissa: membro SEM aceite dos Termos -> has_app_access() IS NULL');
select ok(public.is_community_member('6d000000-0000-0000-0000-000000000001') is null, 'premissa: is_community_member também vira NULL (a origem do fail-open)');
select pg_temp.as_user('03');
select is(public.has_app_access(), false, 'premissa: conta desativada -> has_app_access() = false');

-- === has_app_access() = true -> permitido ===
select pg_temp.as_user('01');
select is(jsonb_array_length(public.list_post_supporters('6e000000-0000-0000-0000-000000000001') -> 'supporters'), 1, 'has_app_access = true: membro vê a lista');
-- === NULL -> BLOQUEADO (o bug) ===
select pg_temp.as_user('02');
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001')$$, 'PERMISSION_DENIED', 'has_app_access IS NULL (sem aceite): bloqueado -- NULL nunca significa permitido');
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001', null, null, 5)$$, 'PERMISSION_DENIED', 'NULL continua bloqueado com paginação/limite');
-- === false -> bloqueado ===
select pg_temp.as_user('03');
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001')$$, 'PERMISSION_DENIED', 'has_app_access = false: bloqueado');
-- === não membro -> bloqueado ===
select pg_temp.as_user('04');
select is(public.has_app_access(), true, 'premissa: não membro tem app access');
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001')$$, 'PERMISSION_DENIED', 'não membro: bloqueado');
-- === superadmin -> permitido (regra atual), mesmo sem aceite/sem ser membro ===
select pg_temp.as_user('05');
select ok(public.has_app_access() is not true, 'premissa: superadmin sem aceite também não tem has_app_access = true');
select is(jsonb_array_length(public.list_post_supporters('6e000000-0000-0000-0000-000000000001') -> 'supporters'), 1, 'superadmin: permitido conforme a regra atual');
-- === membro banido da comunidade -> bloqueado ===
select pg_temp.as_user('06');
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001')$$, 'PERMISSION_DENIED', 'membro com restrição na comunidade: bloqueado');
-- === sem autenticação ===
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.list_post_supporters('6e000000-0000-0000-0000-000000000001')$$, 'NOT_AUTHENTICATED', 'sem autenticação: bloqueado');

-- === minimização: só userId e username; negativos nunca ===
select pg_temp.as_user('01');
create temp table _r as select public.list_post_supporters('6e000000-0000-0000-0000-000000000001') r;
select is((select string_agg(k, ',' order by k) from _r, jsonb_object_keys(r -> 'supporters' -> 0) k), 'userId,username', 'item devolve APENAS userId e username (sem avatarPath)');
select is((select r -> 'supporters' -> 0 ->> 'username' from _r), 'curtidor07', 'username do apoiador');
select ok(not (select r::text like '%avatar%' from _r), 'nenhum campo/valor de avatar no retorno');
select ok(not exists (select 1 from _r, jsonb_array_elements(r -> 'supporters') e where e ->> 'userId' = '6c000000-0000-0000-0000-000000000008'), 'quem não curtiu nunca aparece');
select is((select jsonb_array_length(r -> 'supporters') from _r), 1, 'apenas curtidas');

select * from finish();
rollback;
