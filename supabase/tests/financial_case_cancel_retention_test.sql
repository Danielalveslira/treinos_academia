begin;
select no_plan();

-- ..01 superadmin  ..41 exclusão com caso FIN depois cancelada  ..42 cancelada ANTES de existir caso
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('65000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-cancelret@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','41','42']) as n;
update public.users set role = 'superadmin' where id = '65000000-0000-0000-0000-000000000001';

select public._wallet_credit_cash(('65000000-0000-0000-0000-0000000000' || n)::uuid, 25) from unnest(array['41','42']) as n;
select public._ledger_record('65000000-0000-0000-0000-000000000041', 'seed:1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
select public._ledger_record('65000000-0000-0000-0000-000000000042', 'seed:1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'seed');

select set_config('request.jwt.claim.sub', '65000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', ('65000000-0000-0000-0000-0000000000' || n)::uuid) from unnest(array['41','42']) as n;
select public.run_deletion_job(id) from public.deletion_jobs where target_id in
  ('65000000-0000-0000-0000-000000000041', '65000000-0000-0000-0000-000000000042');

-- 1. cria o caso FIN (só para a conta 41)
select ok(public.separate_financial_case_and_resume_deletion(
  (select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041'), 'caso que será cancelado depois') ->> 'protocol' like 'FIN-%', 'cria FIN-...');
create temp table _c as select * from public.account_financial_cases where original_user_id = '65000000-0000-0000-0000-000000000041';
create temp table _before as select
  (select count(*) from public.economy_transactions where user_id = '65000000-0000-0000-0000-000000000041') ledger_n,
  (select sum(amount) from public.economy_transactions where user_id = '65000000-0000-0000-0000-000000000041') ledger_sum,
  (select cash_balance from public.wallets where user_id = '65000000-0000-0000-0000-000000000041') saldo,
  (select count(*) from public.account_financial_case_events where case_id = (select id from _c)) eventos;
select ok((select retention_until is null and status = 'open' from _c), 'antes do cancelamento: caso aberto, sem prazo');

-- 2. cancela a exclusão
select is((public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041'), 'usuário voltou e manteve a conta') ->> 'cancelled'), 'true', 'cancela a exclusão');

-- 3. conta permanece ativa
select is((select account_status from public.users where id = '65000000-0000-0000-0000-000000000041'), 'active', 'conta permanece ativa');
select is((select state from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041'), 'cancelled', 'job cancelado');

-- 4. caso encerrado  5. retention_until = resolved_at + 1 ano
select is((select status from public.account_financial_cases where id = (select id from _c)), 'cancelled', 'caso encerrado (cancelled)');
select ok((select resolved_at is not null and resolved_by is not null from public.account_financial_cases where id = (select id from _c)), 'resolved_at e resolved_by preenchidos');
select ok((select retention_until = resolved_at + interval '1 year' from public.account_financial_cases where id = (select id from _c)), 'retention_until = resolved_at + exatamente 1 ano');
select ok((select not retention_hold from public.account_financial_cases where id = (select id from _c)), 'sem hold');
select ok(exists (select 1 from public.account_financial_case_events where case_id = (select id from _c) and kind = 'cancelled'
                  and note like 'Caso encerrado por cancelamento da exclusão da conta: usuário voltou e manteve a conta'), 'evento explica o encerramento por cancelamento');
select is((public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041')) -> 'case' ->> 'status'), 'cancelled', 'histórico do admin mostra o caso encerrado');
select ok((public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041')) -> 'case' ->> 'retentionUntil') is not null, 'histórico do admin mostra o prazo');

-- 6. ledger intacto / 7. nada financeiro apagado
select is((select count(*) from public.economy_transactions where user_id = '65000000-0000-0000-0000-000000000041'), (select ledger_n from _before), 'ledger: mesmas linhas');
select is((select sum(amount) from public.economy_transactions where user_id = '65000000-0000-0000-0000-000000000041'), (select ledger_sum from _before), 'ledger: mesmos valores');
select is((select cash_balance from public.wallets where user_id = '65000000-0000-0000-0000-000000000041'), (select saldo from _before)::int, 'saldo intacto');
select results_eq($$select protocol, cash_balance_snapshot, pending_purchases_snapshot, ledger_entries_snapshot, original_user_id, decision_note from public.account_financial_cases where id = (select id from _c)$$,
                  $$select protocol, cash_balance_snapshot, pending_purchases_snapshot, ledger_entries_snapshot, original_user_id, decision_note from _c$$, 'protocolo, snapshots e decisão preservados');
select is((select count(*) from public.account_financial_case_events where case_id = (select id from _c)), (select eventos from _before) + 1, 'eventos anteriores preservados + 1 de encerramento');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '65000000-0000-0000-0000-000000000041'), 1, 'nenhum caso apagado nem duplicado');

-- retry do cancelamento: não duplica evento nem mexe no prazo
create temp table _ret as select retention_until, resolved_at from public.account_financial_cases where id = (select id from _c);
select is((public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000041'), 'repetindo o cancelamento') ->> 'replay'), 'true', 'retry do cancelamento é replay');
select results_eq($$select retention_until, resolved_at from public.account_financial_cases where id = (select id from _c)$$, $$select retention_until, resolved_at from _ret$$, 'retry não altera o prazo');
select is((select count(*)::int from public.account_financial_case_events where case_id = (select id from _c) and kind = 'cancelled'), 1, 'retry não duplica o evento');

-- elegibilidade futura (somente leitura): prazo vencido + sem hold
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _c)), 'dentro do prazo: não elegível');
update public.account_financial_cases set retention_until = now() - interval '1 day' where id = (select id from _c);
select ok(exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _c)), 'prazo vencido sem hold: elegível');
select public.set_financial_case_retention_hold((select id from _c), true, 'guarda legal do caso cancelado');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _c)), 'hold impede elegibilidade');
select is((select count(*)::int from public.account_financial_cases where id = (select id from _c)), 1, 'caso continua preservado (nada é apagado)');

-- backfill idempotente de casos cancelados antigos (sem prazo)
update public.account_financial_cases set retention_until = null, retention_hold = false, retention_hold_reason = null where id = (select id from _c);
select is(public._backfill_financial_case_retention(), 1, 'backfill cobre caso cancelado sem prazo');
select ok((select retention_until = resolved_at + interval '1 year' from public.account_financial_cases where id = (select id from _c)), 'backfill: resolved_at + 1 ano');
select is(public._backfill_financial_case_retention(), 0, 'backfill idempotente');

-- cancelamento ANTES de existir financial_case_id: nenhum caso é criado
select ok((select financial_case_id is null from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000042'), 'conta 42: sem caso');
select is((public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '65000000-0000-0000-0000-000000000042'), 'cancelando antes de separar o caso') ->> 'cancelled'), 'true', 'cancela sem caso');
select is((select account_status from public.users where id = '65000000-0000-0000-0000-000000000042'), 'active', 'conta 42 ativa');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '65000000-0000-0000-0000-000000000042'), 0, 'cancelar sem caso NÃO cria caso só para retenção');
select is((select cash_balance from public.wallets where user_id = '65000000-0000-0000-0000-000000000042'), 25, 'saldo da conta 42 intacto');

select * from finish();
rollback;
