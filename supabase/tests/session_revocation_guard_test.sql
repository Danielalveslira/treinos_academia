\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Fixtures (prefixo c4...): A e B, cada um com uma sessão ativa.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c4000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
  'u' || n || '-sessionguard@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01', '02']) as n;

insert into auth.sessions (id, user_id, created_at, updated_at) values
  ('c4900000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', now(), now()),
  ('c4900000-0000-0000-0000-000000000002', 'c4000000-0000-0000-0000-000000000002', now(), now());

insert into auth.sessions (id, user_id, created_at, updated_at, not_after) values
  ('c4900000-0000-0000-0000-000000000009', 'c4000000-0000-0000-0000-000000000001', now(), now(), now() - interval '1 minute');

create temp table ids as select
  'c4000000-0000-0000-0000-000000000001'::text as a,
  'c4000000-0000-0000-0000-000000000002'::text as b;

create or replace function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform pg_temp.set_test_user( '', true);
  perform set_config('request.jwt.claims', '{}', true);
end;
$$;

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

-- ===== Grants e exposição =============================================================
select ok(not has_function_privilege('anon', 'public.is_session_active()', 'execute'), 'anon NÃO executa is_session_active()');
select ok(has_function_privilege('authenticated', 'public.is_session_active()', 'execute'), 'authenticated executa is_session_active()');
select ok((select prosecdef from pg_proc where oid = 'public.is_session_active()'::regprocedure)
  and (select proconfig from pg_proc where oid = 'public.is_session_active()'::regprocedure) @> array['search_path=public, pg_temp'],
  'SECURITY DEFINER com search_path fixo');
select ok(not has_table_privilege('authenticated', 'auth.sessions', 'select')
  and not has_table_privilege('anon', 'auth.sessions', 'select'), 'clientes nunca têm select direto em auth.sessions');

-- ===== private.current_session_active() (unidade) ======================================
select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000001');
select ok(private.current_session_active(), 'sessão ativa de A: current_session_active() = true');

select pg_temp.as_user_with_session((select a from ids), null);
select ok(not coalesce(private.current_session_active(), false), 'JWT sem session_id: nega (falha fechada)');

select pg_temp.as_user_with_session((select a from ids), 'nao-eh-um-uuid');
select ok(not coalesce(private.current_session_active(), false), 'session_id malformado: nega sem lançar erro de cast');

select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000099');
select ok(not coalesce(private.current_session_active(), false), 'session_id inexistente (já revogado): nega');

select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000002');
select ok(not coalesce(private.current_session_active(), false), 'session_id de OUTRO usuário nunca autoriza');

select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000009');
select ok(not coalesce(private.current_session_active(), false), 'sessão com not_after vencido: nega mesmo a linha existindo');

-- ===== public.is_session_active() (a RPC que o cliente chama) ==========================
select pg_temp.as_anon();
select is(public.is_session_active(), null, 'sem auth.uid(): devolve NULL (nunca false "por engano")');

select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000001');
select is(public.is_session_active(), true, 'sessão ativa de A: a RPC pública confirma');

select pg_temp.as_user_with_session((select a from ids), 'c4900000-0000-0000-0000-000000000099');
select is(public.is_session_active(), false, 'sessão revogada: a RPC pública nega (é o que AuthContext.jsx consulta)');

-- B nunca é afetado pela revogação/expiração da sessão de A.
select pg_temp.as_user_with_session((select b from ids), 'c4900000-0000-0000-0000-000000000002');
select is(public.is_session_active(), true, 'sessão de B segue ativa, isolada da de A');

-- ===== 20261114000002: comment_delete e delete_professional_listing (nem admin, nem financeiro,
-- mas "operação sensível" -- exclusão é irreversível; comment_delete também cobre a ação de
-- MODERADOR, não só a do próprio autor) ================================================
select pg_temp.set_test_user((select a from ids), true);
insert into public.communities (id, name, created_by, owner_id) values
  ('c4200000-0000-0000-0000-000000000001', 'Guard A', (select a from ids)::uuid, (select a from ids)::uuid);
insert into public.community_members (community_id, user_id) values
  ('c4200000-0000-0000-0000-000000000001', (select a from ids)::uuid);
insert into public.statuses (id, community_id, author_id, type, expires_at, text) values
  ('c4300000-0000-0000-0000-000000000001', 'c4200000-0000-0000-0000-000000000001', (select a from ids)::uuid,
   'text', now() + interval '1 day', 'post para testar comment_delete');
select public.comment_create('c4300000-0000-0000-0000-000000000001', null, 'comentário de A', gen_random_uuid());
create temp table c4_comment as
  select id from public.post_comments where status_id = 'c4300000-0000-0000-0000-000000000001' and author_id = (select a from ids)::uuid limit 1;

insert into public.professional_listings (id, owner_id, kind, lifecycle_state, published_version)
values ('c4400000-0000-0000-0000-000000000001', (select a from ids)::uuid, 'professional', 'draft', null);

-- Sessão revogada: nem o próprio autor consegue apagar o comentário ou a própria vitrine.
select pg_temp.as_user_with_session((select a from ids), null);
select throws_ok(
  format($$select public.comment_delete(%L)$$, (select id from c4_comment)),
  'SESSION_REVOKED', 'comment_delete nega sessão revogada mesmo sendo o próprio autor'
);
select throws_ok(
  $$select public.delete_professional_listing('c4400000-0000-0000-0000-000000000001')$$,
  'SESSION_REVOKED', 'delete_professional_listing nega sessão revogada mesmo sendo o próprio titular'
);
select is((select status from public.post_comments where id = (select id from c4_comment)), 'active',
  'comentário intacto: a tentativa com sessão revogada não teve efeito nenhum');
select is((select count(*)::int from public.professional_listings where id = 'c4400000-0000-0000-0000-000000000001'), 1,
  'vitrine intacta: a tentativa com sessão revogada não teve efeito nenhum');

-- Sessão ativa de novo (novo login): as mesmas ações voltam a funcionar sem mecanismo extra.
select pg_temp.set_test_user((select a from ids), true);
select is((public.comment_delete((select id from c4_comment))).status::text, 'deleted_by_author',
  'sessão ativa de novo: comment_delete volta a funcionar');
select is((public.delete_professional_listing('c4400000-0000-0000-0000-000000000001'))->>'deleted', 'true',
  'sessão ativa de novo: delete_professional_listing volta a funcionar');

select * from finish();
rollback;
