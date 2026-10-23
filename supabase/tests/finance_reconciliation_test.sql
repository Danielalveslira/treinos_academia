\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f4000000-0000-0000-0000-000000000001','authenticated','authenticated','shadow-one@example.invalid','x',now(),'{}','{}',now(),now());
select public._wallet_credit_cash('f4000000-0000-0000-0000-000000000001',25);
-- Synthetic legacy opening balance intentionally lacks a ledger entry. Shadow must
-- report it, never invent an opening ledger or silently reconcile the difference.
select is(private.finance_reconcile_shadow(200)->>'mode','shadow','bounded shadow run');
select is((select cash_balance from public.wallets where user_id='f4000000-0000-0000-0000-000000000001'),25,'shadow never adjusts balance');
select is((select count(*)::integer from private.finance_reconciliation_findings where reference_id='f4000000-0000-0000-0000-000000000001'),1,'divergence captured');
select private.finance_reconcile_shadow(1) from generate_series(1,3);
select is((select count(*)::integer from private.finance_reconciliation_findings where reference_id='f4000000-0000-0000-0000-000000000001'),1,'repeated runs do not duplicate findings');
select is((select count(*)::integer from public.economy_transactions where user_id='f4000000-0000-0000-0000-000000000001'),0,'no manufactured ledger entries');
select throws_ok($$select private.finance_reconcile_shadow(201)$$,'INVALID_BATCH_SIZE','batch bound enforced');
select throws_ok($$select private.finance_reconcile_shadow(null)$$,'INVALID_BATCH_SIZE','NULL batch rejected');
select pg_temp.set_test_user('f4000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.admin_finance_findings()$$,'PERMISSION_DENIED','findings protected');
select * from finish();
rollback;
