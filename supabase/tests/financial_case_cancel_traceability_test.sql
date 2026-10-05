begin;
select no_plan();

-- ..01 superadmin  ..51 caso FIN depois cancelado  ..52 retardatário amarrado pelo worker
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('66000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-trace@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','51','52']) as n;
update public.users set role = 'superadmin' where id = '66000000-0000-0000-0000-000000000001';

select public._wallet_credit_cash('66000000-0000-0000-0000-000000000051', 25);
select public._ledger_record('66000000-0000-0000-0000-000000000051', 'seed:1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'seed');
insert into public.cash_purchases (id, user_id, request_id, package_id, package_label, cash_amount, amount_centavos, status, payment_provider, provider_order_nsu, checkout_url)
values ('67000000-0000-0000-0000-000000000051', '66000000-0000-0000-0000-000000000051', 'req-51', 'pack_25', 'Essencial', 25, 590, 'pending', 'infinitepay', 'evo_51515151515151515151515151515151', 'https://checkout.infinitepay.io/test-51');
select public._wallet_credit_cash('66000000-0000-0000-0000-000000000052', 10);
select public._ledger_record('66000000-0000-0000-0000-000000000052', 'seed:1', 'cash', 'credit', 10, 'cash_purchase_confirmed', 'cash_purchase', 'seed');

select set_config('request.jwt.claim.sub', '66000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', ('66000000-0000-0000-0000-0000000000' || n)::uuid) from unnest(array['51','52']) as n;
select public.run_deletion_job(id) from public.deletion_jobs where target_id in
  ('66000000-0000-0000-0000-000000000051', '66000000-0000-0000-0000-000000000052');
select public.separate_financial_case_and_resume_deletion(id, 'caso para testar a rastreabilidade')
  from public.deletion_jobs where target_id in
  ('66000000-0000-0000-0000-000000000051', '66000000-0000-0000-0000-000000000052');

create temp table _c as select * from public.account_financial_cases where original_user_id = '66000000-0000-0000-0000-000000000051';
create temp table _ids as select
  (select id from public.economy_transactions where user_id = '66000000-0000-0000-0000-000000000051' and natural_key = 'seed:1') ledger_id,
  '67000000-0000-0000-0000-000000000051'::uuid purchase_id;

-- 1. FIN com ledger e compra vinculados
select ok((select financial_case_id = (select id from _c) from public.economy_transactions where id = (select ledger_id from _ids)), 'ledger vinculado ao FIN');
select ok((select financial_case_id = (select id from _c) from public.cash_purchases where id = (select purchase_id from _ids)), 'compra vinculada ao FIN');
select is((select count(*)::int from public.account_financial_case_items where case_id = (select id from _c)), 2, 'vínculo histórico gravado (1 ledger + 1 compra)');
create temp table _items_before as select ledger_id, purchase_id, linked_at from public.account_financial_case_items where case_id = (select id from _c);

-- 2. cancela a exclusão
select is((public.cancel_account_deletion((select id from public.deletion_jobs where target_id = '66000000-0000-0000-0000-000000000051'), 'usuário manteve a conta; rastreabilidade') ->> 'cancelled'), 'true', 'cancela a exclusão');
select is((select account_status from public.users where id = '66000000-0000-0000-0000-000000000051'), 'active', 'conta volta ativa');
select ok((select financial_case_id is null from public.economy_transactions where id = (select ledger_id from _ids)) and
          (select financial_case_id is null from public.cash_purchases where id = (select purchase_id from _ids)), 'efeito funcional preservado: vínculo ativo zerado');
select ok((select retention_until = resolved_at + interval '1 year' and status = 'cancelled' from public.account_financial_cases where id = (select id from _c)), 'retenção +1 ano mantida');

-- 3. admin ainda identifica o que pertenceu ao caso
create temp table _h as select public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '66000000-0000-0000-0000-000000000051')) h;
select is((select h -> 'case' ->> 'protocol' from _h), (select protocol from _c), 'histórico mostra o caso FIN depois do cancelamento');
select is((select (h -> 'case' -> 'items' -> 'ledger' -> 0 ->> 'id')::uuid from _h), (select ledger_id from _ids), 'admin identifica o lançamento que pertenceu ao caso');
select is((select (h -> 'case' -> 'items' -> 'ledger' -> 0 ->> 'amount')::int from _h), 25, 'valor do lançamento histórico');
select is((select (h -> 'case' -> 'items' -> 'purchases' -> 0 ->> 'id')::uuid from _h), (select purchase_id from _ids), 'admin identifica a compra que pertenceu ao caso');
select is((select (h -> 'case' -> 'items' -> 'purchases' -> 0 ->> 'cashAmount')::int from _h), 25, 'valor da compra histórica');
select ok((select exists (select 1 from jsonb_array_elements(h -> 'case' -> 'events') e where e ->> 'kind' = 'cancelled' and e ->> 'note' like 'Caso encerrado por cancelamento da exclusão da conta:%') from _h), 'evento com o motivo do cancelamento');
select is((select h -> 'case' ->> 'decisionNote' from _h), 'caso para testar a rastreabilidade', 'decisão original preservada');
select ok((select jsonb_array_length(h -> 'ledger') >= 1 and jsonb_array_length(h -> 'purchases') >= 1 from _h), 'listas gerais de ledger e compras continuam');
select results_eq($$select ledger_id, purchase_id, linked_at from public.account_financial_case_items where case_id = (select id from _c)$$,
                  $$select ledger_id, purchase_id, linked_at from _items_before$$, 'itens históricos inalterados pelo cancelamento');

-- 4. operações financeiras normais continuam; a compra antiga NÃO vira held_in_case
select is((public.confirm_infinitepay_cash_purchase('67000000-0000-0000-0000-000000000051', 'evo_51515151515151515151515151515151', 'txn-51', 'inv-51', 590, 'pix', null) ->> 'credited'), 'true', 'pagamento confirmado credita normalmente na carteira');
select is((select status from public.cash_purchases where id = (select purchase_id from _ids)), 'credited', 'compra antiga não é tratada como held_in_case');
select is((select cash_balance from public.wallets where user_id = '66000000-0000-0000-0000-000000000051'), 50, 'carteira = 25 + 25');
select is((select count(*)::int from public.account_financial_case_events where case_id = (select id from _c) and kind = 'late_payment_held'), 0, 'nenhum pagamento retido no caso cancelado');
select lives_ok($$select public._wallet_debit_cash('66000000-0000-0000-0000-000000000051', 5)$$, 'conta reativada pode gastar EvoCash');
select is((select cash_balance from public.wallets where user_id = '66000000-0000-0000-0000-000000000051'), 45, 'débito aplicado');
select set_config('request.jwt.claim.sub', '66000000-0000-0000-0000-000000000051', true);
select lives_ok($$select public.reserve_infinitepay_cash_purchase('66000000-0000-0000-0000-000000000051', 'pack_25')$$, 'conta reativada pode comprar EvoCash');
select throws_ok($$select public.admin_get_deletion_financial_history((select id from public.deletion_jobs where target_id = '66000000-0000-0000-0000-000000000051'))$$, 'PERMISSION_DENIED', 'usuário comum não vê histórico financeiro');
select set_config('request.jwt.claim.sub', '66000000-0000-0000-0000-000000000001', true);

-- sem duplicar ledger
select is((select count(*)::int from public.economy_transactions where user_id = '66000000-0000-0000-0000-000000000051' and natural_key = 'seed:1'), 1, 'ledger original não duplicado');
select is((select count(*)::int from public.economy_transactions where user_id = '66000000-0000-0000-0000-000000000051'), 2, 'ledger: original + 1 crédito da compra (nada duplicado)');
select is((select count(*)::int from public.account_financial_case_items where case_id = (select id from _c)), 2, 'itens históricos continuam 2 (operações novas não entram no caso cancelado)');
select ok((select retention_until = resolved_at + interval '1 year' from public.account_financial_cases where id = (select id from _c)), 'retenção continua +1 ano depois das operações');
select throws_ok($$delete from public.account_financial_case_items$$, 'FINANCIAL_CASE_IMMUTABLE', 'itens históricos não podem ser apagados');

-- worker: lançamento criado DEPOIS da separação também é amarrado e registrado como item
select public._ledger_record('66000000-0000-0000-0000-000000000052', 'late:1', 'coin', 'credit', 1, 'daily_activity', 'activity', 'late');
select is((select count(*)::int from public.account_financial_case_items i join public.account_financial_cases c on c.id = i.case_id where c.original_user_id = '66000000-0000-0000-0000-000000000052'), 1, 'antes do worker: só o lançamento da separação');
select public.run_deletion_job((select id from public.deletion_jobs where target_id = '66000000-0000-0000-0000-000000000052'));
select is((select count(*)::int from public.account_financial_case_items i join public.account_financial_cases c on c.id = i.case_id where c.original_user_id = '66000000-0000-0000-0000-000000000052'), 2, 'worker registra o retardatário como item do caso');
select is((select count(*)::int from public.economy_transactions t join public.account_financial_cases c on c.id = t.financial_case_id where c.original_user_id = '66000000-0000-0000-0000-000000000052' and t.user_id is null), 2, 'ledger do caso excluído preservado e vinculado');

-- backfill idempotente de vínculo legado (linha vinculada sem item)
insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, financial_case_id)
values ('66000000-0000-0000-0000-000000000051', 'legacy:1', 'coin', 'credit', 1, 'legacy', (select id from _c));
select is(public._backfill_financial_case_items(), 1, 'backfill cria o item faltante');
select is(public._backfill_financial_case_items(), 0, 'backfill idempotente');
select ok(not has_function_privilege('authenticated', 'public._backfill_financial_case_items()', 'execute'), 'backfill não é chamável pelo cliente');

select * from finish();
rollback;
