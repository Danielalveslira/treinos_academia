\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Fixtures (UUIDs 6x...): superadmin, usuário comum e contas-alvo de cada cenário.
--   ..01 superadmin            ..02 usuário comum (sem poder admin)
--   ..11 sem saldo (exclusão automática)
--   ..12 saldo positivo (separa caso -> worker conclui)
--   ..13 saldo + compra PIX pendente (pagamento tardio)
--   ..14 conta desativada com saldo (cancelar em blocked)
--   ..15 saldo + pagamento tardio retido, depois cancelado (reativa) e reenfileirado
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('60000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-delcase@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','11','12','13','14','15']) as n;

update public.users set role = 'superadmin' where id = '60000000-0000-0000-0000-000000000001';
update public.users set account_status = 'disabled', disabled_reason = 'moderação de teste'
  where id = '60000000-0000-0000-0000-000000000014';

-- Saldos (via as mesmas funções internas do app) + 1 lançamento de ledger cada.
select public._wallet_credit_cash('60000000-0000-0000-0000-000000000012', 50);
select public._ledger_record('60000000-0000-0000-0000-000000000012', 'seed:1', 'cash', 'credit', 50, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
select public._wallet_credit_cash('60000000-0000-0000-0000-000000000013', 20);
select public._ledger_record('60000000-0000-0000-0000-000000000013', 'seed:1', 'cash', 'credit', 20, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
select public._wallet_credit_cash('60000000-0000-0000-0000-000000000014', 10);
select public._ledger_record('60000000-0000-0000-0000-000000000014', 'seed:1', 'cash', 'credit', 10, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
select public._wallet_credit_cash('60000000-0000-0000-0000-000000000015', 30);
select public._ledger_record('60000000-0000-0000-0000-000000000015', 'seed:1', 'cash', 'credit', 30, 'cash_purchase_confirmed', 'cash_purchase', 'seed');

-- Compras Pix pendentes com links emitidos.
insert into public.cash_purchases (id, user_id, request_id, package_id, package_label, cash_amount, amount_centavos, status, payment_provider, provider_order_nsu, checkout_url)
values
  ('61000000-0000-0000-0000-000000000013', '60000000-0000-0000-0000-000000000013', 'req-13', 'pack_25', 'Essencial', 25, 590, 'pending', 'infinitepay', 'evo_13131313131313131313131313131313', 'https://checkout.infinitepay.io/test-13'),
  ('61000000-0000-0000-0000-000000000015', '60000000-0000-0000-0000-000000000015', 'req-15', 'pack_25', 'Essencial', 25, 590, 'pending', 'infinitepay', 'evo_15151515151515151515151515151515', 'https://checkout.infinitepay.io/test-15');

-- === usuário comum não acessa nenhuma ação admin ===
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.queue_deletion('account', '60000000-0000-0000-0000-000000000011')$$, 'PERMISSION_DENIED', 'usuário comum não enfileira exclusão');
select throws_ok($$select public.separate_financial_case_and_resume_deletion(gen_random_uuid(), 'tentativa de usuário comum')$$, 'PERMISSION_DENIED', 'usuário comum não separa caso financeiro');
select throws_ok($$select public.cancel_account_deletion(gen_random_uuid(), 'tentativa de usuário comum')$$, 'PERMISSION_DENIED', 'usuário comum não cancela exclusão');
select throws_ok($$select public.review_blocked_account_deletion(gen_random_uuid(), 'tentativa de usuário comum')$$, 'PERMISSION_DENIED', 'usuário comum não revalida bloqueio');
select throws_ok($$select public.admin_list_account_deletions('open')$$, 'PERMISSION_DENIED', 'usuário comum não lista exclusões');
select throws_ok($$select public.admin_get_deletion_financial_history(gen_random_uuid())$$, 'PERMISSION_DENIED', 'usuário comum não abre histórico financeiro');
select throws_ok($$select public.resolve_account_financial_case(gen_random_uuid(), 'tentativa de usuário comum')$$, 'PERMISSION_DENIED', 'usuário comum não resolve caso');

-- === exclusão sem saldo: automática, sem caso ===
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000011');
select is((select account_status from public.users where id = '60000000-0000-0000-0000-000000000011'), 'deleting', 'conta enfileirada vira deleting');
select is(
  (select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000011')) ->> 'authPending'),
  'true', 'sem saldo: o worker limpa o banco direto (falta só confirmar o Auth)');
select is((select count(*)::int from public.users where id = '60000000-0000-0000-0000-000000000011'), 0, 'sem saldo: public.users removido');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000011'), 0, 'sem saldo: nenhum caso financeiro criado');

-- === saldo positivo: revisão ===
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000012');
select is(
  (select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012')) ->> 'reason'),
  'positive_cash_balance', 'saldo positivo: worker bloqueia');
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'blocked_financial_review', 'job em blocked_financial_review');

-- gasto/compra comum bloqueados durante a exclusão
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000012', true);
select throws_ok($$select public.reserve_infinitepay_cash_purchase('60000000-0000-0000-0000-000000000012', 'pack_25')$$, 'ACCOUNT_UNAVAILABLE', 'conta em exclusão não abre compra nova');
select throws_ok($$select public._wallet_debit_cash('60000000-0000-0000-0000-000000000012', 1)$$, 'ACCOUNT_DELETING', 'conta em exclusão não gasta EvoCash');
select is((select public.get_my_deletion_review() ->> 'financialCaseSeparated'), 'false', 'usuário: pendência ainda não separada');
select ok(not (public.get_my_deletion_review() ? 'cashBalance') and not (public.get_my_deletion_review() ? 'blockReason'),
  'usuário: revisão não expõe saldo nem motivo financeiro');
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000001', true);

select throws_ok(
  $$select public.separate_financial_case_and_resume_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), '')$$,
  'NOTE_REQUIRED', 'separar exige nota administrativa');
select throws_ok(
  $$select public.review_blocked_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), null)$$,
  'NOTE_REQUIRED', 'revalidar exige nota administrativa');
select throws_ok(
  $$select public.separate_financial_case_and_resume_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000011'), 'job já concluído sem caso')$$,
  'NOT_BLOCKED', 'job concluído sem caso não pode ser separado');
select is(
  (select public.review_blocked_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'revalidando antes de decidir') ->> 'resumed'),
  'false', 'revalidar mantém bloqueado enquanto há saldo');

select is(
  (select (e ->> 'cashBalance')::int from jsonb_array_elements(public.admin_list_account_deletions('open')) e
   where e ->> 'targetId' = '60000000-0000-0000-0000-000000000012'),
  50, 'painel mostra saldo da solicitação bloqueada');

-- === admin separa o caso financeiro ===
create temp table _r1 as
  select public.separate_financial_case_and_resume_deletion(
    (select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'),
    'saldo de EvoCash será tratado pelo financeiro') as r;
select is((select r ->> 'replay' from _r1), 'false', 'separação: primeira chamada cria o caso');
select is((select r ->> 'cashBalanceSnapshot' from _r1), '50', 'snapshot do saldo = 50');
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'pending', 'job volta a pending para o worker');
select is((select cash_balance from public.wallets where user_id = '60000000-0000-0000-0000-000000000012'), 50, 'separação NÃO altera o saldo');
select is(
  (select count(*)::int from public.economy_transactions where user_id = '60000000-0000-0000-0000-000000000012' and financial_case_id is not null),
  1, 'ledger do usuário vinculado ao caso');
select is(
  (select amount from public.economy_transactions where user_id = '60000000-0000-0000-0000-000000000012'),
  50::numeric, 'valor do ledger intacto');

-- retry idempotente
select is(
  (select public.separate_financial_case_and_resume_deletion(
     (select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'retry do mesmo clique') ->> 'replay'),
  'true', 'retry devolve o caso existente');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000012'), 1, 'retry não duplica caso');
select is((select count(*)::int from public.account_financial_case_events where case_id = (select r ->> 'caseId' from _r1)::uuid), 1, 'retry não duplica eventos');
select throws_ok(
  $$select public.resolve_account_financial_case((select (r ->> 'caseId')::uuid from _r1), 'tentando resolver antes da exclusão')$$,
  'DELETION_NOT_COMPLETE', 'caso só é resolvido depois da exclusão concluída');

-- usuário vê a pendência separada (sem valores)
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000012', true);
select is((select public.get_my_deletion_review() ->> 'financialCaseSeparated'), 'true', 'usuário: pendência separada');
select is((select public.get_my_deletion_review() ->> 'financialCaseProtocol'), (select protocol from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000012'), 'usuário vê o protocolo do caso');
select pg_temp.set_test_user( '60000000-0000-0000-0000-000000000001', true);

-- worker conclui a exclusão
select is(
  (select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012')) ->> 'deleteAuthUser'),
  'true', 'worker conclui e pede a remoção do Auth (Edge Function)');
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'auth_cleanup', 'banco limpo: job aguarda a confirmação do Auth');
select public.confirm_auth_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'));
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'complete', 'Auth confirmado: job chega a complete');
select is((select count(*)::int from public.users where id = '60000000-0000-0000-0000-000000000012'), 0, 'public.users removido');
select is((select count(*)::int from public.wallets where user_id = '60000000-0000-0000-0000-000000000012'), 0, 'carteira removida com a conta (valor preservado no caso)');
select is((select count(*)::int from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000012' and status = 'open'), 1, 'caso financeiro permanece aberto');
select is((select cash_balance_final from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000012'), 50, 'saldo final registrado no caso = 50 (nunca zerado)');
select is(
  (select sum(amount)::int from public.economy_transactions where financial_case_id = (select r ->> 'caseId' from _r1)::uuid and user_id is null),
  50, 'ledger preservado, referenciado pelo caso, sem user_id');
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012')) ->> 'skipped'), 'true', 'segunda execução do worker não faz nada');
select is(
  (select public.separate_financial_case_and_resume_deletion(
     (select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'retry depois de concluído') ->> 'replay'),
  'true', 'retry depois de concluído continua idempotente');
select throws_ok($$delete from public.account_financial_cases$$, 'FINANCIAL_CASE_IMMUTABLE', 'caso financeiro não pode ser apagado');
select throws_ok(
  $$select public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012'), 'tarde demais para cancelar')$$,
  'NOT_CANCELLABLE', 'depois de concluída não é mais reversível');
select is(
  (select public.resolve_account_financial_case((select (r ->> 'caseId')::uuid from _r1), 'tratado pelo financeiro') ->> 'resolved'),
  'true', 'caso resolvido depois da exclusão');
select ok((select resolved_at is not null from public.account_financial_cases where id = (select (r ->> 'caseId')::uuid from _r1)), 'resolução registra resolved_at');
select hasnt_column('public', 'account_financial_cases', 'retain_until', 'nenhum prazo de retenção é assumido (PENDENTE DE DEFINIÇÃO)');
select is((select (public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000012')) -> 'ledger' -> 0 ->> 'amount')::int), 50, 'histórico financeiro acessível depois da exclusão');

-- === pagamento tardio: PIX pendente pago depois da separação ===
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000013');
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000013')) ->> 'reason'), 'pending_cash_purchase', 'compra pendente bloqueia');
select is(
  (select (public.separate_financial_case_and_resume_deletion(
    (select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000013'), 'PIX pendente acompanhado pelo financeiro') ->> 'cashBalanceSnapshot')),
  '20', 'caso com compra pendente registra saldo');
select is((select pending_purchases_snapshot from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000013'), 1, 'caso registra a compra pendente');
select is((select public.confirm_infinitepay_cash_purchase('61000000-0000-0000-0000-000000000013', 'evo_13131313131313131313131313131313', 'txn-13', 'inv-13', 590, 'pix', null) ->> 'reason'), 'held_in_financial_case', 'pagamento tardio vai para o caso');
select is((select cash_balance from public.wallets where user_id = '60000000-0000-0000-0000-000000000013'), 20, 'pagamento tardio não credita a carteira');
select is((select status from public.cash_purchases where id = '61000000-0000-0000-0000-000000000013'), 'held_in_case', 'compra marcada como retida no caso');
select is((select public.confirm_infinitepay_cash_purchase('61000000-0000-0000-0000-000000000013', 'evo_13131313131313131313131313131313', 'txn-13', 'inv-13', 590, 'pix', null) ->> 'reason'), 'already_held_in_case', 'reentrega do webhook é idempotente');
select is((select count(*)::int from public.account_financial_case_events where kind = 'late_payment_held'
           and case_id = (select id from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000013')), 1, 'um único evento de pagamento retido');
select is((select count(*)::int from public.economy_transactions where natural_key = 'cash-purchase:61000000-0000-0000-0000-000000000013'), 0, 'nenhum ledger de crédito criado para o pagamento retido');
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000013')) ->> 'authPending'), 'true', 'exclusão conclui no banco com pagamento retido');
select is((select public.confirm_infinitepay_cash_purchase('61000000-0000-0000-0000-000000000013', 'evo_13131313131313131313131313131313', 'txn-13', 'inv-13', 590, 'pix', null) ->> 'reason'), 'already_held_in_case', 'webhook depois da exclusão continua só retendo');
select is((select count(*)::int from public.wallets where user_id = '60000000-0000-0000-0000-000000000013')
        + (select count(*)::int from public.users where id = '60000000-0000-0000-0000-000000000013'), 0, 'pagamento tardio não recria conta nem carteira');
select is((select count(*)::int from public.cash_purchases where financial_case_id is not null and user_id is null and id = '61000000-0000-0000-0000-000000000013'), 1, 'compra continua referenciada pelo caso');

-- Compra sem dono e sem caso (exclusão anterior a este fluxo): nunca credita, nunca erra.
insert into public.cash_purchases (id, user_id, request_id, package_id, package_label, cash_amount, amount_centavos, status, payment_provider, provider_order_nsu)
values ('61000000-0000-0000-0000-000000000099', null, 'req-99', 'pack_25', 'Essencial', 25, 590, 'pending', 'infinitepay', 'evo_99999999999999999999999999999999');
select throws_ok($$select public.confirm_infinitepay_cash_purchase('61000000-0000-0000-0000-000000000099', 'evo_99999999999999999999999999999999', 'txn-99', 'inv-99', 590, 'pix', null)$$, 'PURCHASE_ACCOUNT_DELETED_WITHOUT_CASE', 'compra órfã sem caso não credita nada');
select is((select status from public.cash_purchases where id = '61000000-0000-0000-0000-000000000099'), 'pending', 'compra órfã segue pendente (rastreável)');

-- === cancelar solicitação enquanto reversível: sem caso, conta desativada antes ===
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000014');
select is((select previous_account_status from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'), 'disabled', 'status anterior guardado');
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'));
select is((select public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'), 'solicitação feita por engano') ->> 'cancelled'), 'true', 'cancela enquanto bloqueado');
select is((select account_status from public.users where id = '60000000-0000-0000-0000-000000000014'), 'disabled', 'cancelar não promove conta desativada a ativa');
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'), 'cancelled', 'job cancelado');
select is((select cash_balance from public.wallets where user_id = '60000000-0000-0000-0000-000000000014'), 10, 'cancelar não altera saldo');
select is((select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014')) ->> 'skipped'), 'true', 'worker ignora job cancelado');
select is((select public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'), 'repetindo o cancelamento') ->> 'replay'), 'true', 'cancelar é idempotente');
select throws_ok(
  $$select public.separate_financial_case_and_resume_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000014'), 'separar job cancelado')$$,
  'DELETION_CANCELLED', 'job cancelado não pode ser separado');

-- === separar -> pagamento tardio retido -> cancelar (reativa e credita) -> reenfileirar ===
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000015');
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'));
select public.separate_financial_case_and_resume_deletion(
  (select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'), 'separando antes de reconsiderar');
select public.confirm_infinitepay_cash_purchase('61000000-0000-0000-0000-000000000015', 'evo_15151515151515151515151515151515', 'txn-15', 'inv-15', 590, 'pix', null);
select is((select cash_balance from public.wallets where user_id = '60000000-0000-0000-0000-000000000015'), 30, 'retido: carteira intacta antes do cancelamento');
select public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'), 'usuário voltou e pediu para manter a conta');
select is((select account_status from public.users where id = '60000000-0000-0000-0000-000000000015'), 'active', 'conta reativada');
select is((select status from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000015'), 'cancelled', 'caso cancelado, não apagado');
select is((select cash_balance from public.wallets where user_id = '60000000-0000-0000-0000-000000000015'), 55, 'pagamento retido creditado na carteira ao cancelar (30 + 25)');
select is((select status from public.cash_purchases where id = '61000000-0000-0000-0000-000000000015'), 'credited', 'compra retida vira credited');
select is((select count(*)::int from public.economy_transactions where natural_key = 'cash-purchase:61000000-0000-0000-0000-000000000015' and user_id = '60000000-0000-0000-0000-000000000015'), 1, 'crédito com ledger');
select is((select count(*)::int from public.economy_transactions where user_id = '60000000-0000-0000-0000-000000000015' and financial_case_id is not null), 0, 'ledger desvinculado do caso cancelado');
select is((select count(*)::int from public.account_financial_case_events where kind in ('late_payment_held', 'held_payment_restored', 'cancelled')
           and case_id = (select id from public.account_financial_cases where original_user_id = '60000000-0000-0000-0000-000000000015')), 3, 'eventos do caso preservados (retido, restaurado, cancelado)');
select public.queue_deletion('account', '60000000-0000-0000-0000-000000000015');
select is((select state from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'), 'pending', 'job cancelado pode ser reenfileirado');
select ok((select financial_case_id is null from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'), 'novo pedido começa sem caso');
select is((select count(*)::int from public.deletion_jobs where target_id = '60000000-0000-0000-0000-000000000015'), 1, 'continua um único job por conta');

-- === histórico/auditoria visível no painel ===
select is(
  (select jsonb_array_length(e -> 'history') from jsonb_array_elements(public.admin_list_account_deletions('closed')) e
   where e ->> 'targetId' = '60000000-0000-0000-0000-000000000014'),
  1, 'painel (encerradas) mostra o histórico de revisão do job cancelado');

select * from finish();
rollback;
