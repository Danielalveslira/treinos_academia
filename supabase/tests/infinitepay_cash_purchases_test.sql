\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('72000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','quantity-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,4)i;
insert into public.evocash_price_versions(revision,unit_price_centavos,minimum_unit_price_centavos,min_quantity,max_quantity,daily_quantity_limit,total_quantity_limit,quote_ttl_seconds,large_change_threshold_bps,active_from,created_by,reason)
values(9001,10,1,1,100,100,200,300,2000,clock_timestamp(),'72000000-0000-0000-0000-000000000004','Synthetic quantity tests');
update public.evocash_pricing_state set quoting_enabled=true,checkout_enabled=true where id;
create temp table results(name text primary key,value jsonb);
grant select,insert on results to authenticated;
select pg_temp.set_test_user('72000000-0000-0000-0000-000000000001',true);
select pg_temp.publish_test_commercial_terms(); -- 20261212000002: termos comerciais sintéticos publicados
set local role authenticated;
select is((public.get_evocash_purchase_settings()->>'enabled')::boolean,false,'supplier gate hides purchase availability');
select throws_ok($$select public.create_evocash_purchase_quote('25','72100000-0000-0000-0000-000000000001')$$,'SUPPLIER_INFO_NOT_CONFIGURED','supplier gate blocks EvoCash quotes');
reset role;
-- A cotação criada durante aprovação administrativa continua incapaz de abrir
-- checkout se a trava for fechada depois; todos os dados da fixture são descartados.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
insert into results values('quote',public.create_evocash_purchase_quote('25','72100000-0000-0000-0000-000000000001'));
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', false)) where id;
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001')$$,'SUPPLIER_INFO_NOT_CONFIGURED','supplier gate blocks checkout even before other controls');
select ok(not has_table_privilege('authenticated','public.cash_purchases','insert'),'client cannot insert financial rows');
reset role;
-- Only this rollback-only fixture opts into the supplier gate before checkout.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
update public.evocash_pricing_state set checkout_enabled=false where id;
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001')$$,'EVOCASH_PURCHASES_PAUSED','checkout remains paused independently of supplier approval');
reset role;
update public.evocash_pricing_state set checkout_enabled=true where id;
set local role authenticated;
insert into results values('order',pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001'));
select is((select value->>'amountCentavos' from results where name='order'),'250','order uses quote total as an exact string');
select is((select value->>'cashAmount' from results where name='order'),'25','order quantity is frozen');
select is(pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001')->>'createLink','false','concurrent retry cannot call provider twice');
select throws_ok($$select pg_temp.reserve_with_terms('72100000-0000-0000-0000-000000000099','72200000-0000-0000-0000-000000000001')$$,'IDEMPOTENCY_CONFLICT','request key cannot change quote');
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000099')$$,'QUOTE_ALREADY_RESERVED','another key cannot buy the same quote twice');
reset role;
select ok(to_regprocedure('pg_temp.reserve_with_terms(uuid,text)') is null,'package reservation is removed');
select ok(not (select config ? 'cashPackages' from public.economy_config where id),'package configuration is retired');
select throws_ok($$update public.cash_purchases set amount_centavos=1 where id=(select(value->>'id')::uuid from results where name='order')$$,'42501','PURCHASE_SNAPSHOT_IMMUTABLE','immutable purchase total');
select public.release_infinitepay_checkout((select(value->>'id')::uuid from results where name='order'));
set local role authenticated;
select is(pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001')->>'createLink','true','known pre-provider failure releases lease safely');
reset role;
select public.finish_infinitepay_checkout((select(value->>'id')::uuid from results where name='order'),'https://checkout.infinitepay.io/fixture?lenc=test');
select throws_ok($$select public.finish_infinitepay_checkout((select(value->>'id')::uuid from results where name='order'),'https://evil.test/')$$,'INVALID_CHECKOUT_URL','database also restricts URL host');
insert into public.evocash_price_versions(revision,unit_price_centavos,minimum_unit_price_centavos,min_quantity,max_quantity,daily_quantity_limit,total_quantity_limit,quote_ttl_seconds,large_change_threshold_bps,active_from,created_by,reason)
values(9002,20,1,1,100,100,200,300,2000,clock_timestamp(),'72000000-0000-0000-0000-000000000004','Synthetic price change');
set local role authenticated;
select is(pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000001')->>'amountCentavos','250','price change never changes accepted checkout');
select public.cancel_my_cash_purchase((select(value->>'id')::uuid from results where name='order'));
insert into results values('limit_quote',public.create_evocash_purchase_quote('100','72100000-0000-0000-0000-000000000002'));
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='limit_quote'),'72200000-0000-0000-0000-000000000002')$$,'PURCHASE_LIMIT_REACHED','cancelled but payable link retains limit reservation');
reset role;
select throws_ok($$select public.confirm_infinitepay_cash_purchase((select(value->>'id')::uuid from results where name='order'),(select value->>'orderNsu' from results where name='order'),'quantity-txn','quantity-invoice',251,'pix',null)$$,'PAYMENT_MISMATCH','divergent provider amount cannot credit');
select is(public.confirm_infinitepay_cash_purchase((select(value->>'id')::uuid from results where name='order'),(select value->>'orderNsu' from results where name='order'),'quantity-txn','quantity-invoice',250,'pix',null)->>'credited','true','verified late payment credits the same order');
select is(public.confirm_infinitepay_cash_purchase((select(value->>'id')::uuid from results where name='order'),(select value->>'orderNsu' from results where name='order'),'quantity-txn','quantity-invoice',250,'pix',null)->>'credited','false','duplicate webhook cannot credit twice');
select is((select cash_balance from public.wallets where user_id='72000000-0000-0000-0000-000000000001'),25,'wallet receives exact quote quantity');
select is((select count(*)::integer from public.economy_transactions where reference_id=(select value->>'id' from results where name='order')),1,'one order one ledger credit');
update public.users set role='superadmin' where id='72000000-0000-0000-0000-000000000004';
update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id;
select pg_temp.set_test_user('72000000-0000-0000-0000-000000000004',true);
select is(public.admin_record_cash_reversal((select(value->>'id')::uuid from results where name='order'),'quantity-refund-1','refund',125,'local-provider-proof','Synthetic partial refund')->>'cashUnits','12','quantity refund reuses proportional reversal engine');
select is(public.admin_record_cash_reversal((select(value->>'id')::uuid from results where name='order'),'quantity-refund-1','refund',125,'local-provider-proof','Synthetic partial refund')->>'replay','true','quantity refund event is idempotent');
select public.admin_record_cash_reversal((select(value->>'id')::uuid from results where name='order'),'quantity-refund-2','refund',125,'local-provider-proof-2','Synthetic final refund');
select is((select cash_balance from public.wallets where user_id='72000000-0000-0000-0000-000000000001'),0,'full quantity refund recovers only original credits');
select public.confirm_infinitepay_cash_purchase((select(value->>'id')::uuid from results where name='order'),(select value->>'orderNsu' from results where name='order'),'quantity-txn','quantity-invoice',250,'pix',null);
select is((select cash_balance from public.wallets where user_id='72000000-0000-0000-0000-000000000001'),0,'late paid replay cannot undo a refund');
select pg_temp.set_test_user('72000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote'),'72200000-0000-0000-0000-000000000003')$$,'QUOTE_NOT_FOUND','another user cannot redeem quote');
select is((select count(*)::integer from public.cash_purchases where id=(select(value->>'id')::uuid from results where name='order')),0,'RLS hides other user purchases');
reset role;
insert into public.evocash_purchase_quotes(user_id,request_id,quantity,unit_price_centavos,total_centavos,price_version_id,created_at,expires_at)
select '72000000-0000-0000-0000-000000000002',gen_random_uuid(),1,unit_price_centavos,unit_price_centavos,id,now()-interval '10 minutes',now()-interval '5 minutes' from public.evocash_price_versions where revision=9002;
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select id from public.evocash_purchase_quotes where user_id=auth.uid() limit 1),'72200000-0000-0000-0000-000000000004')$$,'QUOTE_EXPIRED','expired quote cannot create payment');
insert into results values('quote_b',public.create_evocash_purchase_quote('25','72100000-0000-0000-0000-000000000005'));
insert into results values('order_b',pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote_b'),'72200000-0000-0000-0000-000000000005'));
reset role;
select public.mark_infinitepay_checkout_uncertain((select(value->>'id')::uuid from results where name='order_b'));
set local role authenticated;
select is(pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote_b'),'72200000-0000-0000-0000-000000000005')->>'uncertain','true','timeout stays uncertain on retry');
reset role;
select public.fail_infinitepay_checkout((select(value->>'id')::uuid from results where name='order_b'),422);
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote_b'),'72200000-0000-0000-0000-000000000005')$$,'PURCHASE_ALREADY_FINAL','failed order never silently reopens');
reset role;
select ok(not has_function_privilege('authenticated','public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)','execute'),'confirmation remains backend only');
select ok(not has_function_privilege('service_role','public.reserve_infinitepay_cash_purchase(uuid,uuid)','execute'),'no service reservation that bypasses caller session');
update public.users set account_status='disabled' where id='72000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote_b'),'72200000-0000-0000-0000-000000000005')$$,'42501','APP_ACCESS_DENIED','disabled account cannot reuse an order to reach provider');
reset role;
update public.users set account_status='active' where id='72000000-0000-0000-0000-000000000002';
select pg_temp.revoke_test_session('72000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok($$select pg_temp.reserve_with_terms((select(value->>'quoteId')::uuid from results where name='quote_b'),'72200000-0000-0000-0000-000000000005')$$,'42501','APP_ACCESS_DENIED','revoked session cannot reserve or replay checkout');
reset role;
select * from finish();
rollback;
