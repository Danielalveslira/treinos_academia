\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 conta ativa | ..02 conta ativa de controle | ..03 conta desativada
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('e1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-greeting@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'e1000000-%';
update public.users set account_status = 'disabled' where id = 'e1000000-0000-0000-0000-000000000003';

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( case when p = '' then '' else 'e1000000-0000-0000-0000-0000000000' || p end, true)$$;

create or replace function pg_temp.error_of(q text) returns text language plpgsql as
  $$begin execute q; return null; exception when others then return sqlerrm; end$$;

-- === 1) esquema ===
select is((select greeting_voice from public.users where id = 'e1000000-0000-0000-0000-000000000001'), 'auto', 'conta nova: voz padrão é auto');
select is((select greeting_welcome_seen_at from public.users where id = 'e1000000-0000-0000-0000-000000000001'), null, 'conta nova: boas-vindas ainda não vistas');
select throws_ok(
  $$update public.users set greeting_voice = 'robo' where id = 'e1000000-0000-0000-0000-000000000001'$$,
  '23514', null, 'constraint barra valor de voz inválido');
select col_not_null('public', 'users', 'greeting_voice', 'greeting_voice é NOT NULL');

-- === 2) metadados de segurança das RPCs ===
select is((select prosecdef from pg_proc where oid = 'public.set_greeting_voice(text)'::regprocedure), true, 'set_greeting_voice é SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.ack_greeting_welcome()'::regprocedure), true, 'ack_greeting_welcome é SECURITY DEFINER');
select ok((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.set_greeting_voice(text)'::regprocedure), 'set_greeting_voice tem search_path fixo');
select ok((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.ack_greeting_welcome()'::regprocedure), 'ack_greeting_welcome tem search_path fixo');
select ok(not has_function_privilege('anon', 'public.set_greeting_voice(text)', 'execute'), 'anon não executa set_greeting_voice');
select ok(not has_function_privilege('anon', 'public.ack_greeting_welcome()', 'execute'), 'anon não executa ack_greeting_welcome');
select ok(has_function_privilege('authenticated', 'public.set_greeting_voice(text)', 'execute'), 'authenticated executa set_greeting_voice');
select ok(has_function_privilege('authenticated', 'public.ack_greeting_welcome()', 'execute'), 'authenticated executa ack_greeting_welcome');

set local role authenticated;

-- === 3) set_greeting_voice ===
select pg_temp.as_user('01');
select is(public.set_greeting_voice('feminino'), 'feminino', 'salva e devolve o valor');
select is((select greeting_voice from public.users where id = 'e1000000-0000-0000-0000-000000000001'), 'feminino', 'valor persistido na própria conta');
select is(public.set_greeting_voice('feminino'), 'feminino', 'repetir o mesmo valor é aceito (no-op)');
select is(public.set_greeting_voice('auto'), 'auto', 'volta para auto');
select is(pg_temp.error_of($$select public.set_greeting_voice('robo')$$), 'INVALID_GREETING_VOICE', 'valor fora da lista é recusado');
select is(pg_temp.error_of($$select public.set_greeting_voice('Feminino')$$), 'INVALID_GREETING_VOICE', 'sem normalização: caixa diferente é recusada');
select is(pg_temp.error_of($$select public.set_greeting_voice(' neutro')$$), 'INVALID_GREETING_VOICE', 'sem normalização: espaço é recusado');
select is(pg_temp.error_of($$select public.set_greeting_voice(null)$$), 'INVALID_GREETING_VOICE', 'null é recusado');
select is(pg_temp.error_of($$select public.set_greeting_voice('')$$), 'INVALID_GREETING_VOICE', 'vazio é recusado');
select is((select greeting_voice from public.users where id = 'e1000000-0000-0000-0000-000000000001'), 'auto', 'valor inválido não alterou nada');

select pg_temp.as_user('');
select is(pg_temp.error_of($$select public.set_greeting_voice('neutro')$$), 'NOT_AUTHENTICATED', 'sem sessão: recusado');

select pg_temp.as_user('03');
select is(pg_temp.error_of($$select public.set_greeting_voice('neutro')$$), 'FORBIDDEN', 'conta sem acesso: recusado');

-- === 4) ack_greeting_welcome ===
select pg_temp.as_user('');
select is(pg_temp.error_of($$select public.ack_greeting_welcome()$$), 'NOT_AUTHENTICATED', 'ack sem sessão: recusado');
select pg_temp.as_user('03');
select is(pg_temp.error_of($$select public.ack_greeting_welcome()$$), 'FORBIDDEN', 'ack de conta sem acesso: recusado');

select pg_temp.as_user('01');
select set_config('test.first_ack', public.ack_greeting_welcome()::text, true);
select ok(current_setting('test.first_ack') <> '', 'primeira chamada devolve o instante do servidor');
select is((select greeting_welcome_seen_at::text from public.users where id = 'e1000000-0000-0000-0000-000000000001'), current_setting('test.first_ack'), 'instante gravado é o devolvido');
select is(public.ack_greeting_welcome()::text, current_setting('test.first_ack'), 'segunda chamada devolve o instante ORIGINAL');
select is((select greeting_welcome_seen_at::text from public.users where id = 'e1000000-0000-0000-0000-000000000001'), current_setting('test.first_ack'), 'segunda chamada não regravou');

-- === 5) isolamento entre contas e ausência de escrita direta ===
select pg_temp.as_user('02');
select is((select greeting_welcome_seen_at from public.users where id = 'e1000000-0000-0000-0000-000000000002'), null, 'a conta de controle não foi afetada');
select is((select count(*) from public.users where id = 'e1000000-0000-0000-0000-000000000001'), 0::bigint, 'RLS: não lê a linha de outra conta');
select is((select greeting_voice from public.users where id = 'e1000000-0000-0000-0000-000000000002'), 'auto', 'voz da conta de controle intacta');
select throws_ok(
  $$update public.users set greeting_welcome_seen_at = now() where id = 'e1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'UPDATE direto do cliente em greeting_welcome_seen_at é negado');
select throws_ok(
  $$update public.users set greeting_voice = 'neutro' where id = 'e1000000-0000-0000-0000-000000000002'$$,
  '42501', null, 'UPDATE direto do cliente em greeting_voice é negado');

select * from finish();
rollback;
