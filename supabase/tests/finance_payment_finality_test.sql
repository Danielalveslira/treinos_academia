\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f2000000-0000-0000-0000-000000000001','authenticated','authenticated','payment-one@example.invalid','x',now(),'{}','{}',now(),now()),
('f2000000-0000-0000-0000-000000000002','authenticated','authenticated','payment-admin@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='f2000000-0000-0000-0000-000000000002';
create temp table reserved as select pg_temp.cash_purchase_fixture('f2000000-0000-0000-0000-000000000001') r;
select ok((select (r->>'checkoutValidUntil')::timestamptz > now() from reserved),'expiry frozen by server');
select ok(public.claim_infinitepay_payment_check((select (r->>'id')::uuid from reserved)),'provider check claimed');
select ok(not public.claim_infinitepay_payment_check((select (r->>'id')::uuid from reserved)),'second concurrent/repeated check limited persistently');
select ok(not has_function_privilege('authenticated','public.claim_infinitepay_payment_check(uuid)','execute'),'client cannot claim check');
update public.users set account_status='disabled' where id='f2000000-0000-0000-0000-000000000001';
select public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from reserved),(select r->>'orderNsu' from reserved),'finance-txn','finance-inv',590,'pix',null);
select pg_temp.set_test_user('f2000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.admin_resolve_cash_purchase_review((select (r->>'id')::uuid from reserved),null,'resolution test')$$,'INVALID_RESOLUTION','NULL resolution rejected');
select public.admin_resolve_cash_purchase_review((select (r->>'id')::uuid from reserved),'refund_externally','Refund verified externally');
select is(public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from reserved),(select r->>'orderNsu' from reserved),'finance-txn','finance-inv',590,'pix',null)->>'reason','refunded_externally','late replay cannot credit an externally refunded purchase');
select is((select count(*)::integer from public.economy_transactions where reference_id=(select r->>'id' from reserved)),0,'no ledger credit after refund');
select public.record_infinitepay_verified_conflict((select (r->>'id')::uuid from reserved),(select r->>'orderNsu' from reserved),'second-paid-txn','second-paid-invoice',590);
select public.record_infinitepay_verified_conflict((select (r->>'id')::uuid from reserved),(select r->>'orderNsu' from reserved),'second-paid-txn','second-paid-invoice',590);
select is((select count(*)::integer from private.finance_reconciliation_findings where kind='verified_payment_conflict' and evidence->>'purchaseId'=(select r->>'id' from reserved)),1,'second real payment indication kept exactly once for review');
select is((select count(*)::integer from public.economy_transactions where reference_id=(select r->>'id' from reserved)),0,'verified conflict never manufactures a second credit');
select ok(not has_function_privilege('authenticated','public.record_infinitepay_verified_conflict(uuid,text,text,text,integer)','execute'),'client cannot claim provider verification');
select * from finish();
rollback;
