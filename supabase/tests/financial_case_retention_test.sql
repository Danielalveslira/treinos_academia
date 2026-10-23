\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 superadmin  ..02 usuário comum  ..31 caso A (resolvido)  ..32 caso B (hold)  ..33 caso C (aberto)
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('63000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-retention@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','31','32','33']) as n;
update public.users set role = 'superadmin' where id = '63000000-0000-0000-0000-000000000001';

select public._wallet_credit_cash(('63000000-0000-0000-0000-0000000000' || n)::uuid, 25)
  from unnest(array['31','32','33']) as n;
select public._ledger_record(('63000000-0000-0000-0000-0000000000' || n)::uuid, 'seed:1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'seed')
  from unnest(array['31','32','33']) as n;

-- Leva cada conta ao caso financeiro separado e, para A e B, até a exclusão concluída (job complete).
select pg_temp.set_test_user( '63000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', ('63000000-0000-0000-0000-0000000000' || n)::uuid) from unnest(array['31','32','33']) as n;
select public.run_deletion_job(id) from public.deletion_jobs where target_id in
  ('63000000-0000-0000-0000-000000000031', '63000000-0000-0000-0000-000000000032', '63000000-0000-0000-0000-000000000033');
select public.separate_financial_case_and_resume_deletion(id, 'caso para testar a retenção financeira')
  from public.deletion_jobs where target_id in
  ('63000000-0000-0000-0000-000000000031', '63000000-0000-0000-0000-000000000032', '63000000-0000-0000-0000-000000000033');
select public.run_deletion_job(id) from public.deletion_jobs where target_id in
  ('63000000-0000-0000-0000-000000000031', '63000000-0000-0000-0000-000000000032');
select public.confirm_auth_deletion(id) from public.deletion_jobs where target_id in
  ('63000000-0000-0000-0000-000000000031', '63000000-0000-0000-0000-000000000032');

create temp table _cases as
  select right(original_user_id::text, 2) as k, id from public.account_financial_cases
  where original_user_id in ('63000000-0000-0000-0000-000000000031', '63000000-0000-0000-0000-000000000032', '63000000-0000-0000-0000-000000000033');
create temp table _before as
  select (select count(*) from public.economy_transactions where financial_case_id in (select id from _cases)) ledger,
         (select count(*) from public.account_financial_cases where id in (select id from _cases)) casos,
         (select sum(cash_balance_snapshot) from public.account_financial_cases where id in (select id from _cases)) saldo,
         (select string_agg(protocol, ',' order by protocol) from public.account_financial_cases where id in (select id from _cases)) protocolos;

-- === caso aberto: sem prazo ===
select ok((select retention_until is null from public.account_financial_cases where id = (select id from _cases where k = '33')), 'caso aberto: retention_until null');
select is((select retention_hold from public.account_financial_cases where id = (select id from _cases where k = '33')), false, 'hold começa desligado');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _cases where k = '33')), 'caso aberto nunca é elegível');
select is((public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '63000000-0000-0000-0000-000000000033')) -> 'case' ->> 'retentionUntil'), null, 'histórico do caso aberto: retentionUntil null');
select throws_ok($$update public.account_financial_cases set retention_until = now() where id = (select id from _cases where k = '33')$$, '23514', null, 'constraint: caso aberto não pode ter prazo');

-- === resolução: +1 ano exato, idempotente ===
create temp table _res as select public.resolve_account_financial_case((select id from _cases where k = '31'), 'resolvido para testar retenção') as r;
select is((select r ->> 'replay' from _res), 'false', 'primeira resolução');
select ok((select retention_until = resolved_at + interval '1 year' from public.account_financial_cases where id = (select id from _cases where k = '31')), 'retention_until = resolved_at + exatamente 1 ano');
create temp table _snap as select retention_until, resolved_at from public.account_financial_cases where id = (select id from _cases where k = '31');
select is((public.resolve_account_financial_case((select id from _cases where k = '31'), 'retry da resolução') ->> 'replay'), 'true', 'retry da resolução devolve replay');
select is((select count(*)::int from public.account_financial_case_events where case_id = (select id from _cases where k = '31') and kind = 'resolved'), 1, 'retry não duplica o evento de resolução');
select results_eq($$select retention_until, resolved_at from public.account_financial_cases where id = (select id from _cases where k = '31')$$,
                  $$select retention_until, resolved_at from _snap$$, 'retry não muda nem encurta o prazo');
select ok((select (public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '63000000-0000-0000-0000-000000000031')) -> 'case' ->> 'retentionUntil') is not null), 'histórico do caso resolvido mostra retentionUntil');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _cases where k = '31')), 'resolvido dentro do prazo ainda não é elegível');

-- === backfill de casos já resolvidos ===
insert into public.account_financial_cases (
  original_user_id, deletion_job_id, status, block_reason, decision_note, cash_balance_snapshot, resolved_at, resolution_note
) values (
  '63000000-0000-0000-0000-000000000031', (select id from public.deletion_jobs where target_id = '63000000-0000-0000-0000-000000000031'),
  'resolved', 'positive_cash_balance', 'caso legado resolvido sem prazo', 10, now() - interval '400 days', 'legado'
);
create temp table _legacy as select id, protocol, cash_balance_snapshot from public.account_financial_cases where decision_note = 'caso legado resolvido sem prazo';
select ok((select retention_until is null from public.account_financial_cases where id = (select id from _legacy)), 'caso legado resolvido começa sem prazo');
select is(public._backfill_financial_case_retention(), 1, 'backfill atualiza só o caso resolvido sem prazo');
select ok((select retention_until = resolved_at + interval '1 year' from public.account_financial_cases where id = (select id from _legacy)), 'backfill: resolved_at + 1 ano');
select is(public._backfill_financial_case_retention(), 0, 'backfill é idempotente');
select ok((select retention_until is null from public.account_financial_cases where id = (select id from _cases where k = '33')), 'backfill não toca em caso aberto');
select results_eq($$select protocol, cash_balance_snapshot from public.account_financial_cases where id = (select id from _legacy)$$,
                  $$select protocol, cash_balance_snapshot from _legacy$$, 'backfill não altera protocolo nem saldo');
-- 400 dias atrás + 1 ano = vencido há ~35 dias: é elegível (sem hold)
select ok(exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _legacy)), 'caso legado vencido e sem hold é elegível');

-- === hold ===
select pg_temp.set_test_user( '63000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.set_financial_case_retention_hold((select id from _cases where k = '31'), true, 'usuário comum tentando')$$, 'PERMISSION_DENIED', 'usuário comum não liga hold');
select throws_ok($$select public.set_financial_case_retention_hold((select id from _cases where k = '31'), false, 'usuário comum tentando')$$, 'PERMISSION_DENIED', 'usuário comum não remove hold');
select throws_ok($$select public.admin_list_financial_cases_retention_due(10)$$, 'PERMISSION_DENIED', 'usuário comum não lista casos elegíveis');
select throws_ok($$select public.resolve_account_financial_case((select id from _cases where k = '32'), 'usuário comum tentando')$$, 'PERMISSION_DENIED', 'usuário comum não resolve caso');
select pg_temp.set_test_user( '63000000-0000-0000-0000-000000000001', true);

select throws_ok($$select public.set_financial_case_retention_hold((select id from _legacy), true, '')$$, 'REASON_REQUIRED', 'hold exige motivo');
select is((public.set_financial_case_retention_hold((select id from _legacy), true, 'disputa judicial em andamento') ->> 'replay'), 'false', 'liga hold');
select ok((select retention_hold and retention_hold_reason = 'disputa judicial em andamento' from public.account_financial_cases where id = (select id from _legacy)), 'hold registra motivo');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _legacy)), 'hold impede o caso de aparecer como elegível');
select is((public.set_financial_case_retention_hold((select id from _legacy), true, 'disputa judicial em andamento') ->> 'replay'), 'true', 'repetir o mesmo hold é idempotente');
select is((select count(*)::int from public.account_financial_case_events where case_id = (select id from _legacy) and kind = 'retention_hold_set'), 1, 'hold repetido não duplica evento');
select is((public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '63000000-0000-0000-0000-000000000031')) -> 'case' ->> 'retentionHold'), 'false', 'histórico mostra o hold do caso do job (caso A sem hold)');
select throws_ok($$update public.account_financial_cases set retention_hold = true, retention_hold_reason = null where id = (select id from _legacy)$$, '23514', null, 'constraint: hold sem motivo é recusado');

select is((public.set_financial_case_retention_hold((select id from _legacy), false, 'disputa encerrada, hold liberado') ->> 'replay'), 'false', 'remove hold');
select ok((select not retention_hold and retention_hold_reason is null from public.account_financial_cases where id = (select id from _legacy)), 'remoção limpa hold e motivo');
select ok(exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _legacy)), 'sem hold e com prazo vencido volta a ser elegível');
select is((public.set_financial_case_retention_hold((select id from _legacy), false, 'repetindo a remoção') ->> 'replay'), 'true', 'remover hold já removido é idempotente');
select results_eq($$select kind, note from public.account_financial_case_events where case_id = (select id from _legacy) and kind like 'retention_hold%' order by created_at, kind desc$$,
  $$values ('retention_hold_set'::text, 'disputa judicial em andamento'::text), ('retention_hold_released', 'disputa encerrada, hold liberado')$$,
  'hold e liberação ficam em account_financial_case_events com o motivo');

-- Caso resolvido com prazo no futuro + hold: continua inelegível mesmo se vencer depois
select public.set_financial_case_retention_hold((select id from _cases where k = '31'), true, 'obrigação legal de guarda');
update public.account_financial_cases set retention_until = now() - interval '1 day' where id = (select id from _cases where k = '31');
select ok(not exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _cases where k = '31')), 'prazo vencido + hold: inelegível');
select public.set_financial_case_retention_hold((select id from _cases where k = '31'), false, 'obrigação legal encerrada');
select ok(exists (select 1 from jsonb_array_elements(public.admin_list_financial_cases_retention_due(500)) e where e ->> 'id' = (select id::text from _cases where k = '31')), 'remover hold com prazo vencido torna elegível');
select is((select count(*)::int from jsonb_array_elements(public.admin_list_financial_cases_retention_due(1))), 1, 'p_limit é respeitado');

-- === nada financeiro foi apagado/alterado ===
select is((select count(*) from public.economy_transactions where financial_case_id in (select id from _cases)), (select ledger from _before), 'ledger preservado');
select is((select count(*) from public.account_financial_cases where id in (select id from _cases)), (select casos from _before), 'nenhum caso apagado');
select is((select sum(cash_balance_snapshot) from public.account_financial_cases where id in (select id from _cases)), (select saldo from _before), 'saldos dos casos inalterados');
select is((select string_agg(protocol, ',' order by protocol) from public.account_financial_cases where id in (select id from _cases)), (select protocolos from _before), 'protocolos inalterados');
select throws_ok($$delete from public.account_financial_cases$$, 'FINANCIAL_CASE_IMMUTABLE', 'caso continua sem poder ser apagado');
select throws_ok($$delete from public.account_financial_case_events$$, 'FINANCIAL_CASE_IMMUTABLE', 'eventos continuam sem poder ser apagados');
select ok(not has_function_privilege('authenticated', 'public._backfill_financial_case_retention()', 'execute'), 'backfill não é chamável pelo cliente');

select * from finish();
rollback;
