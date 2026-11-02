\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 conta ativa | ..02 conta ativa de controle | ..03 conta desativada
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('e2000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-rest@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'e2000000-%';
update public.users set account_status = 'disabled' where id = 'e2000000-0000-0000-0000-000000000003';

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( case when p = '' then '' else 'e2000000-0000-0000-0000-0000000000' || p end, true)$$;

create or replace function pg_temp.error_of(q text) returns text language plpgsql as
  $$begin execute q; return null; exception when others then return sqlerrm; end$$;

-- === 1) esquema: contas existentes ficam sem preferência (o cliente usa 90s) ===
select is((select default_rest_seconds from public.users where id = 'e2000000-0000-0000-0000-000000000001'), null, 'conta sem preferência: null');
select throws_ok(
  $$update public.users set default_rest_seconds = 901 where id = 'e2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'constraint barra valor acima de 900');
select throws_ok(
  $$update public.users set default_rest_seconds = -1 where id = 'e2000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'constraint barra valor negativo');

-- === 2) metadados de segurança da RPC ===
select is((select prosecdef from pg_proc where oid = 'public.set_default_rest_seconds(integer)'::regprocedure), true, 'set_default_rest_seconds é SECURITY DEFINER');
select ok((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.set_default_rest_seconds(integer)'::regprocedure), 'search_path fixo');
select ok(not has_function_privilege('anon', 'public.set_default_rest_seconds(integer)', 'execute'), 'anon não executa');
select ok(has_function_privilege('authenticated', 'public.set_default_rest_seconds(integer)', 'execute'), 'authenticated executa');

set local role authenticated;

-- === 3) set_default_rest_seconds ===
select pg_temp.as_user('01');
select is(public.set_default_rest_seconds(60), 60, 'salva e devolve o valor');
select is((select default_rest_seconds::int from public.users where id = 'e2000000-0000-0000-0000-000000000001'), 60, 'valor persistido na própria conta');
select is(public.set_default_rest_seconds(60), 60, 'repetir o mesmo valor é aceito (no-op)');
select is(public.set_default_rest_seconds(0), 0, '0 (descanso desativado) é um valor válido');
select is((select default_rest_seconds::int from public.users where id = 'e2000000-0000-0000-0000-000000000001'), 0, '0 persistido, não trocado por padrão');
select is(public.set_default_rest_seconds(900), 900, 'limite superior aceito');
select is(pg_temp.error_of($$select public.set_default_rest_seconds(901)$$), 'INVALID_REST_SECONDS', 'acima de 900 é recusado');
select is(pg_temp.error_of($$select public.set_default_rest_seconds(-1)$$), 'INVALID_REST_SECONDS', 'negativo é recusado');
select is(pg_temp.error_of($$select public.set_default_rest_seconds(null)$$), 'INVALID_REST_SECONDS', 'null é recusado');
select is((select default_rest_seconds::int from public.users where id = 'e2000000-0000-0000-0000-000000000001'), 900, 'valor inválido não alterou nada');

select pg_temp.as_user('');
select is(pg_temp.error_of($$select public.set_default_rest_seconds(30)$$), 'NOT_AUTHENTICATED', 'sem sessão: recusado');

select pg_temp.as_user('03');
select is(pg_temp.error_of($$select public.set_default_rest_seconds(30)$$), 'FORBIDDEN', 'conta sem acesso: recusado');

-- === 4) isolamento entre contas e ausência de escrita direta ===
select pg_temp.as_user('02');
select is((select default_rest_seconds from public.users where id = 'e2000000-0000-0000-0000-000000000002'), null, 'a conta de controle não foi afetada');
select is((select count(*) from public.users where id = 'e2000000-0000-0000-0000-000000000001'), 0::bigint, 'RLS: não lê a linha de outra conta');
select throws_ok(
  $$update public.users set default_rest_seconds = 30 where id = 'e2000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'UPDATE direto do cliente em default_rest_seconds é negado');

-- === 5) salvar o plano semanal não apaga a preferência (colunas independentes) ===
select pg_temp.as_user('01');
select lives_ok(
  $$select public.set_training_preferences(jsonb_build_object(
    'plannedTrainingDays', '["monday"]'::jsonb, 'reminderEnabled', false, 'weeklyTimes', '{}'::jsonb,
    'timezone', 'America/Sao_Paulo', 'effectiveFrom', '2026-11-01'))$$,
  'plano semanal salvo');
select is((select default_rest_seconds::int from public.users where id = 'e2000000-0000-0000-0000-000000000001'), 900, 'preferência de descanso preservada');

select * from finish();
rollback;
