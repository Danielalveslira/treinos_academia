\ir _helpers/auth_session.sql
begin;
select no_plan();

-- auth.jwt() existe no Supabase real; o container local de teste (pgtest) pode não ter. Só cria
-- se faltar, dentro desta transação (rollback no fim).
do $$
begin
  if to_regprocedure('auth.jwt()') is null then
    execute $f$create function auth.jwt() returns jsonb language sql stable as
      'select coalesce(nullif(current_setting(''request.jwt.claim'', true), ''''), nullif(current_setting(''request.jwt.claims'', true), ''''))::jsonb'$f$;
  end if;
exception when insufficient_privilege then
  raise notice 'auth.jwt() ausente e sem permissão para criar: instale-o no pgtest como supabase_admin';
end;
$$;

-- Fixtures (prefixo 81...): 01 superadmin | 02 usuário A | 03 usuário B
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('81000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-useractivity@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users set role = 'superadmin', username = 'superadminactivity' where id = '81000000-0000-0000-0000-000000000001';

create or replace function pg_temp.as_user(p_uid text, p_session text default null) returns void language plpgsql as $$
begin
  perform pg_temp.set_test_user( coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims', coalesce((
    case when p_uid is null then null else
      jsonb_build_object('sub', p_uid, 'role', 'authenticated')
      || case when p_session is null then '{}'::jsonb else jsonb_build_object('session_id', p_session) end
    end)::text, ''), true);
end;
$$;

-- ----------------------------------------------------------------------------
-- Contrato: sem parâmetros (o cliente não informa usuário, sessão nem horário)
-- ----------------------------------------------------------------------------
select is((select pronargs::int from pg_proc where oid = 'public.touch_user_activity()'::regprocedure), 0,
  'touch_user_activity não aceita parâmetros');
select is((select prosecdef from pg_proc where oid = 'public.touch_user_activity()'::regprocedure), true,
  'touch_user_activity é security definer');

-- Sem autenticação
select pg_temp.as_user(null);
select throws_ok($$ select public.touch_user_activity() $$, '28000', 'NOT_AUTHENTICATED', 'sem auth.uid() é recusado');

-- ----------------------------------------------------------------------------
-- Primeira chamada: cria 1 linha com a sessão e o horário do banco
-- ----------------------------------------------------------------------------
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'a1111111-1111-4111-8111-111111111111');
select lives_ok($$ select public.touch_user_activity() $$, 'primeira chamada funciona');
select is((select count(*)::int from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'), 1, 'uma linha por usuário');
select is((select last_session_id::text from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'),
  'a1111111-1111-4111-8111-111111111111', 'grava o session_id do JWT');
select is((select last_active_at from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'), now(),
  'horário é o do PostgreSQL');

-- Teto no servidor: outra sessão dentro de 1 minuto não regrava
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'b2222222-2222-4222-8222-222222222222');
select public.touch_user_activity();
select is((select last_session_id::text from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'),
  'a1111111-1111-4111-8111-111111111111', 'dentro de 1 minuto: sem nova gravação (teto de escrita)');

-- ----------------------------------------------------------------------------
-- Dois aparelhos: vale a atividade mais recente, de qualquer sessão
-- ----------------------------------------------------------------------------
update public.user_activity set last_active_at = now() - interval '11 minutes'
  where user_id = '81000000-0000-0000-0000-000000000002';
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'b2222222-2222-4222-8222-222222222222');
select public.touch_user_activity();
select is((select last_session_id::text from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'),
  'b2222222-2222-4222-8222-222222222222', 'sessão B (mais recente) passa a ser a última');
select is((select last_active_at from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'), now(),
  'last_active_at avança para o uso mais recente');
select is((select count(*)::int from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'), 1,
  'continua uma única linha (sem "dispositivo principal")');

update public.user_activity set last_active_at = now() - interval '12 minutes'
  where user_id = '81000000-0000-0000-0000-000000000002';
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'a1111111-1111-4111-8111-111111111111');
select public.touch_user_activity();
select is((select last_session_id::text from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'),
  'a1111111-1111-4111-8111-111111111111', 'volta a A quando A usa por último');

-- last_active_at nunca retrocede (relógio adiantado/outra transação)
update public.user_activity set last_active_at = now() + interval '1 hour'
  where user_id = '81000000-0000-0000-0000-000000000002';
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'b2222222-2222-4222-8222-222222222222');
select public.touch_user_activity();
select cmp_ok((select last_active_at from public.user_activity where user_id = '81000000-0000-0000-0000-000000000002'),
  '>=', now() + interval '59 minutes', 'valor futuro nunca é reduzido');

-- ----------------------------------------------------------------------------
-- Robustez do claim de sessão
-- ----------------------------------------------------------------------------
select pg_temp.as_user('81000000-0000-0000-0000-000000000003');   -- sem session_id
select lives_ok($$ select public.touch_user_activity() $$, 'JWT sem session_id não quebra');
select is((select last_session_id from public.user_activity where user_id = '81000000-0000-0000-0000-000000000003'), null,
  'sem session_id => last_session_id nulo');
update public.user_activity set last_active_at = now() - interval '5 minutes' where user_id = '81000000-0000-0000-0000-000000000003';
select pg_temp.as_user('81000000-0000-0000-0000-000000000003', 'não-é-uuid');
select lives_ok($$ select public.touch_user_activity() $$, 'session_id malformado não quebra');
select is((select last_session_id from public.user_activity where user_id = '81000000-0000-0000-0000-000000000003'), null,
  'session_id malformado é ignorado');
select is((select count(*)::int from public.user_activity where user_id in ('81000000-0000-0000-0000-000000000002','81000000-0000-0000-0000-000000000003')), 2,
  'usuários distintos => linhas distintas');

-- ----------------------------------------------------------------------------
-- RLS / grants: o cliente não lê nem escreve a tabela; anon não executa a RPC
-- ----------------------------------------------------------------------------
select pg_temp.as_user('81000000-0000-0000-0000-000000000002', 'a1111111-1111-4111-8111-111111111111');
set local role authenticated;
select throws_ok($$ select * from public.user_activity $$, '42501', null, 'authenticated não lê a tabela');
select throws_ok($$ update public.user_activity set last_active_at = now() + interval '10 years' $$, '42501', null, 'authenticated não escreve na tabela');
select throws_ok($$ insert into public.user_activity (user_id, last_active_at) values ('81000000-0000-0000-0000-000000000002', now()) $$, '42501', null, 'authenticated não insere');
select lives_ok($$ select public.touch_user_activity() $$, 'authenticated executa a RPC');
reset role;
set local role anon;
select throws_ok($$ select public.touch_user_activity() $$, '42501', null, 'anon não executa a RPC');
reset role;

-- ----------------------------------------------------------------------------
-- Snapshot admin: Último uso (user_activity) e Último login (auth) são campos separados
-- ----------------------------------------------------------------------------
update auth.users set last_sign_in_at = '2026-01-02T03:04:05Z' where id = '81000000-0000-0000-0000-000000000002';
update public.user_activity set last_active_at = '2026-10-01T10:00:00Z' where user_id = '81000000-0000-0000-0000-000000000002';
create or replace function pg_temp.acc(p_id text) returns jsonb language sql as $$
  select a from jsonb_array_elements(public.admin_accounts_snapshot() -> 'accounts') a where a ->> 'id' = p_id
$$;
select pg_temp.set_test_user('81000000-0000-0000-0000-000000000001');
select is(pg_temp.acc('81000000-0000-0000-0000-000000000002') ->> 'last_active_at', '2026-10-01T10:00:00+00:00', 'snapshot traz last_active_at (Último uso)');
select is(pg_temp.acc('81000000-0000-0000-0000-000000000002') ->> 'last_sign_in_at', '2026-01-02T03:04:05+00:00', 'snapshot mantém last_sign_in_at (Último login)');
select is(pg_temp.acc('81000000-0000-0000-0000-000000000001') -> 'last_active_at', 'null'::jsonb, 'conta sem atividade registrada => null');
select pg_temp.set_test_user('81000000-0000-0000-0000-000000000003');
select throws_ok($$ select public.admin_accounts_snapshot() $$, 'P0001', 'PERMISSION_DENIED', 'usuário comum continua sem acesso ao snapshot');

-- Exclusão da conta leva a linha junto
delete from public.users where id = '81000000-0000-0000-0000-000000000003';
select is((select count(*)::int from public.user_activity where user_id = '81000000-0000-0000-0000-000000000003'), 0, 'exclusão da conta apaga user_activity (cascade)');

select * from finish();
rollback;
