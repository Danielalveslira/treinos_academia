\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
begin;
select no_plan();
delete from public.legal_policy;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fd000000-0000-0000-0000-000000000001','authenticated','authenticated','refund-chargeback-owner@example.invalid','x',now(),'{}','{}',now(),now()),
('fd000000-0000-0000-0000-000000000002','authenticated','authenticated','refund-chargeback-admin@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='fd000000-0000-0000-0000-000000000002';
create temp table purchase as select pg_temp.cash_purchase_fixture('fd000000-0000-0000-0000-000000000001') p;
select public.confirm_infinitepay_cash_purchase((select(p->>'id')::uuid from purchase),(select p->>'orderNsu' from purchase),'chargeback-txn','chargeback-inv',590,'pix',null);
update private.refund_settings set financial_requests_enabled=true where id;
update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id;
select pg_temp.set_test_user('fd000000-0000-0000-0000-000000000001',true);
create temp table req as select public.create_refund_request('purchase',(select(p->>'id')::uuid from purchase),'withdrawal','',gen_random_uuid()) r;
select pg_temp.set_test_user('fd000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.admin_record_cash_reversal((select(p->>'id')::uuid from purchase),'independent-chargeback','chargeback',590,'synthetic-provider-proof','Chargeback comprovado enquanto há reserva')$$,'verified external reversal survives a wallet hold');
select is((select status from public.refund_requests where id=(select(r->>'id')::uuid from req)),'disputed','external chargeback routes open claim to investigation');
select is(private.cash_debt('fd000000-0000-0000-0000-000000000001'),25::bigint,'existing debt records recovery still owed');
select is((select cash_balance from public.wallets where user_id='fd000000-0000-0000-0000-000000000001'),25,'held units not consumed silently');
select is((select reserved_units from public.refund_requests where id=(select(r->>'id')::uuid from req)),25::bigint,'hold persists pending reviewed disposition');
select is((select count(*)::integer from public.cash_purchase_reversals where provider_event_id='independent-chargeback'),1,'one external reversal');
select is((select reversed_centavos from public.cash_purchases where id=(select(p->>'id')::uuid from purchase)),590,'provider reversal aggregate retained');
select pg_temp.set_test_user('fd000000-0000-0000-0000-000000000001',true);
select is(public.get_refund_balance()->>'available','0','held or owed credits not presented as spendable');
select pg_temp.set_test_user('fd000000-0000-0000-0000-000000000002',true);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint)))::text,true);
select throws_ok($$select public.act_on_refund_request((select(r->>'id')::uuid from req),'complete','Tentativa indevida de segunda devolução',gen_random_uuid(),2)$$,'REFUND_TRANSITION_DENIED','previous chargeback prevents duplicate completion');
select public.act_on_refund_request((select(r->>'id')::uuid from req),'reject','Não há nova restituição: chargeback integral já registrado e comprovado',gen_random_uuid(),2);
select public._wallet_credit_cash('fd000000-0000-0000-0000-000000000001',1);
select public._ledger_record('fd000000-0000-0000-0000-000000000001','synthetic-credit-after-chargeback','cash','credit',1,'synthetic','fixture','chargeback-test');
select is(private.cash_debt('fd000000-0000-0000-0000-000000000001'),0::bigint,'released hold permits existing audited debt recovery');
select is((select cash_balance from public.wallets where user_id='fd000000-0000-0000-0000-000000000001'),1,'only unrelated credit remains after recovery');
select is((select sum(case direction when 'credit' then amount else -amount end) from public.economy_transactions where user_id='fd000000-0000-0000-0000-000000000001' and asset='cash'),1::numeric,'existing ledger and wallet still match');
select * from finish();
rollback;
