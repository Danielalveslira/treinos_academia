\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 superadmin, ..21 falha do corpo (last_error), ..22 retry do Auth com caso financeiro
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('62000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-hardening@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','21','22']) as n;
update public.users set role = 'superadmin' where id = '62000000-0000-0000-0000-000000000001';

select public._wallet_credit_cash('62000000-0000-0000-0000-000000000022', 40);
select public._ledger_record('62000000-0000-0000-0000-000000000022', 'seed:1', 'cash', 'credit', 40, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
select public._ledger_record('62000000-0000-0000-0000-000000000021', 'seed:1', 'coin', 'credit', 3, 'daily_activity', 'activity', 'seed');

select pg_temp.set_test_user( '62000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', '62000000-0000-0000-0000-000000000021');
select public.queue_deletion('account', '62000000-0000-0000-0000-000000000022');

-- === 1. last_error persiste e nada é corrompido ===
create function public._force_delete_failure() returns trigger language plpgsql as $$
begin raise exception 'falha forcada no teste'; end; $$;
create trigger _force_delete_failure before delete on public.users
  for each row when (old.id = '62000000-0000-0000-0000-000000000021') execute function public._force_delete_failure();

create temp table _fail as
  select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) as r;
select is((select r ->> 'error' from _fail), 'true', 'falha do job é devolvida ao worker (sem abortar a transação)');
select matches((select last_error from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'),
  'falha forcada no teste', 'last_error PERSISTE depois da falha');
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'pending', 'falha mantém o job pending (reprocessável), nunca complete');
select is((select count(*)::int from public.users where id = '62000000-0000-0000-0000-000000000021'), 1, 'falha desfaz as escritas do corpo: usuário continua existindo');
select is((select count(*)::int from public.economy_transactions where user_id = '62000000-0000-0000-0000-000000000021'), 1, 'falha não desvincula o ledger do usuário');

drop trigger _force_delete_failure on public.users;
select is((select run_result ->> 'authPending' from (select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) as run_result) x),
  'true', 'retry do job depois de corrigida a causa conclui o banco');
select ok((select last_error is null from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'sucesso limpa o last_error');
select is((select count(*)::int from public.users where id = '62000000-0000-0000-0000-000000000021'), 0, 'public.users removido');

-- === 2. Auth: estado técnico, retry idempotente, convergência ===
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'auth_cleanup', 'banco limpo, Auth não confirmado: job NÃO está complete');
select is((select count(*)::int from public.list_pending_deletion_jobs() where target_id = '62000000-0000-0000-0000-000000000021'), 1, 'auth_cleanup continua na fila do worker');
select is((select public.get_my_deletion_status()), null, 'admin sem exclusão própria não vê nada');

-- falha temporária do Auth: Edge Function registra o erro, estado não muda
select public.record_deletion_job_error((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'auth.admin.deleteUser: 503 temporariamente indisponível');
select matches((select last_error from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), '503', 'falha do Auth deixa diagnóstico');
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'auth_cleanup', 'falha do Auth mantém auth_cleanup');

-- banco limpo + Auth ainda presente: login/retry não recria usuário nem carteira
select ok(exists (select 1 from auth.users where id = '62000000-0000-0000-0000-000000000021'), 'Auth ainda presente (cenário banco limpo + Auth vivo)');
select pg_temp.set_test_user( '62000000-0000-0000-0000-000000000021', true);
do $$ begin perform public.ensure_user_profile(); exception when others then null; end $$;
select is((select public.get_my_deletion_review()), null, 'titular de banco limpo não vê revisão de exclusão');
select pg_temp.set_test_user( '62000000-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public.users where id = '62000000-0000-0000-0000-000000000021')
        + (select count(*)::int from public.wallets where user_id = '62000000-0000-0000-0000-000000000021'), 0, 'Auth vivo não recria public.users nem wallet');

-- retry reentrega o que falta, sem tocar no banco
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) ->> 'retry'), 'true', 'retry devolve só a remoção do Auth pendente');
select is((select count(*)::int from public.users where id = '62000000-0000-0000-0000-000000000021'), 0, 'retry não recria nada');

-- confirmação (Auth removido OU já inexistente -- a Edge Function trata os dois como sucesso)
select is((select public.confirm_auth_deletion((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) ->> 'replay'), 'false', 'Auth confirmado: job conclui');
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'complete', 'conclusão final = complete');
select ok((select last_error is null from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021'), 'conclusão limpa o diagnóstico do Auth');
select is((select public.confirm_auth_deletion((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) ->> 'replay'), 'true', 'confirmação é idempotente');
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000021')) ->> 'skipped'), 'true', 'job complete é ignorado');
select is((select count(*)::int from public.list_pending_deletion_jobs() where target_id = '62000000-0000-0000-0000-000000000021'), 0, 'complete sai da fila');
select throws_ok($$select public.confirm_auth_deletion((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'))$$,
  'NOT_AWAITING_AUTH_CLEANUP', 'só confirma Auth de job cujo banco já foi limpo');
select ok(not has_function_privilege('authenticated', 'public.confirm_auth_deletion(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'public.record_deletion_job_error(uuid, text)', 'execute')
      and not has_function_privilege('authenticated', 'public.run_deletion_job(uuid)', 'execute'), 'só service role executa as funções do worker');

-- === Auth com retry NÃO repete a exclusão financeira ===
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'));
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'), 'blocked_financial_review', 'conta com saldo bloqueia');
select public.separate_financial_case_and_resume_deletion((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'), 'caso para testar o retry do Auth');
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'));
create temp table _case_before as
  select cash_balance_final, finalized_at, status, (select count(*) from public.account_financial_case_events e where e.case_id = c.id) as events
  from public.account_financial_cases c where original_user_id = '62000000-0000-0000-0000-000000000022';
select public.record_deletion_job_error((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'), 'auth: timeout');
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'));
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'));
select results_eq(
  $$select cash_balance_final, finalized_at, status, (select count(*) from public.account_financial_case_events e where e.case_id = c.id) from public.account_financial_cases c where original_user_id = '62000000-0000-0000-0000-000000000022'$$,
  $$select cash_balance_final, finalized_at, status, events from _case_before$$,
  'retries do Auth não alteram o caso financeiro (saldo final, finalized_at, eventos)');
select is((select cash_balance_final from _case_before), 40, 'saldo final preservado = 40 (nunca zerado)');
select is((select sum(amount)::int from public.economy_transactions where financial_case_id = (select id from public.account_financial_cases where original_user_id = '62000000-0000-0000-0000-000000000022')), 40, 'ledger intacto depois dos retries');
select public.confirm_auth_deletion((select id from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'));
select is((select state from public.deletion_jobs where target_id = '62000000-0000-0000-0000-000000000022'), 'complete', 'caso com retry termina em complete');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '62000000-0000-0000-0000-000000000022' and status = 'open'), 1, 'caso financeiro permanece');

select * from finish();
rollback;
