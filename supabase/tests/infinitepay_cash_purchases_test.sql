begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('72000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'buyer-a@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('72000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'buyer-b@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('72000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'buyer-c@example.invalid', 'unused', now(), '{}', '{}', now(), now());

select ok(not has_function_privilege('authenticated', 'public.reserve_infinitepay_cash_purchase(uuid,text)', 'EXECUTE'), 'ordinary user cannot reserve via privileged RPC');
select ok(not has_function_privilege('authenticated', 'public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)', 'EXECUTE'), 'ordinary user cannot credit');
select ok(has_function_privilege('service_role', 'public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)', 'EXECUTE'), 'service role can credit after provider check');

create temp table _ip_a as
  select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000001', 'pack_25') as r;
select is((select r->>'amountCentavos' from _ip_a), '590', 'server chooses package price');
select ok((select r->>'orderNsu' from _ip_a) like 'evo_%', 'server generated order');
select is((select count(*)::int from public.cash_purchases where user_id = '72000000-0000-0000-0000-000000000001'), 1, 'one purchase created');
select is((public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000001', 'pack_25')->>'inProgress'), 'true', 'retry while link is being created');
select throws_ok($$select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000001', 'pack_120')$$,
  'PENDING_CASH_PURCHASE_EXISTS', 'different package cannot bypass pending purchase');
select throws_ok($$select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000002', 'missing')$$,
  'CASH_PACKAGE_UNAVAILABLE', 'inactive or unknown package refused');

select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _ip_a), 'https://checkout.infinitepay.com.br/tag?lenc=test');
select is((public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000001', 'pack_25')->>'checkoutUrl'),
  'https://checkout.infinitepay.com.br/tag?lenc=test', 'retry reuses saved checkout');

create temp table _ip_b as
  select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000002', 'pack_25') as r;
select public.mark_infinitepay_checkout_uncertain((select (r->>'id')::uuid from _ip_b));
select throws_ok($$select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000002', 'pack_25')$$,
  'CHECKOUT_RECONCILIATION_REQUIRED', 'uncertain link cannot be recreated automatically');

select throws_ok($$select public.confirm_infinitepay_cash_purchase(
  (select (r->>'id')::uuid from _ip_a), (select r->>'orderNsu' from _ip_a),
  'txn-a', 'invoice-a', 591, 'pix', null)$$,
  'PAYMENT_MISMATCH', 'wrong amount cannot credit');
select is((select coalesce((select cash_balance::int from public.wallets where user_id = '72000000-0000-0000-0000-000000000001'), 0)), 0, 'wallet unchanged after bad amount');

select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _ip_a),
  (select r->>'orderNsu' from _ip_a), 'txn-a', 'invoice-a', 590, 'pix', null)->>'credited'),
  'true', 'verified Pix credits');
select is((select cash_balance::int from public.wallets where user_id = '72000000-0000-0000-0000-000000000001'), 25, 'wallet credited once');
select is((select count(*)::int from public.economy_transactions where reference_id = (select r->>'id' from _ip_a)), 1, 'one ledger row');
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _ip_a),
  (select r->>'orderNsu' from _ip_a), 'txn-a', 'invoice-a', 590, 'pix', null)->>'credited'),
  'false', 'duplicate webhook does not credit');
select is((select cash_balance::int from public.wallets where user_id = '72000000-0000-0000-0000-000000000001'), 25, 'retry leaves wallet unchanged');

select throws_ok($$select public.confirm_infinitepay_cash_purchase(
  (select (r->>'id')::uuid from _ip_b), (select r->>'orderNsu' from _ip_b),
  'txn-a', 'invoice-b', 590, 'credit_card', null)$$,
  '23505', null, 'same transaction cannot pay two purchases');
select is((select coalesce((select cash_balance::int from public.wallets where user_id = '72000000-0000-0000-0000-000000000002'), 0)), 0, 'failed duplicate rolls back wallet');
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _ip_b),
  (select r->>'orderNsu' from _ip_b), 'txn-b', 'invoice-b', 590, 'credit_card', null)->>'credited'),
  'true', 'verified card follows same credit path');

create temp table _ip_c as
  select public.reserve_infinitepay_cash_purchase('72000000-0000-0000-0000-000000000003', 'pack_25') as r;
update public.users set role = 'superadmin' where id = '72000000-0000-0000-0000-000000000001';
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', '72000000-0000-0000-0000-000000000003');
select public.run_deletion_job(id) from public.deletion_jobs where target_id = '72000000-0000-0000-0000-000000000003';
select public.separate_financial_case_and_resume_deletion(id, 'separar compra pendente para teste')
  from public.deletion_jobs where target_id = '72000000-0000-0000-0000-000000000003';
select public.run_deletion_job(id) from public.deletion_jobs where target_id = '72000000-0000-0000-0000-000000000003';
select is((select user_id from public.cash_purchases where id = (select (r->>'id')::uuid from _ip_c)),
  null, 'purchase survives deleted account without owner');
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _ip_c),
  (select r->>'orderNsu' from _ip_c), 'txn-c', 'invoice-c', 590, 'pix', null)->>'reason'),
  'held_in_financial_case', 'late payment is held in financial case');
select is((select status from public.cash_purchases where id = (select (r->>'id')::uuid from _ip_c)),
  'held_in_case', 'purchase marked held');
select is((select count(*)::int from public.economy_transactions where reference_id = (select r->>'id' from _ip_c)),
  0, 'held payment creates no ledger credit');
select is((select coalesce((select cash_balance::int from public.wallets where user_id = '72000000-0000-0000-0000-000000000003'), 0)),
  0, 'held payment creates no wallet balance');

select throws_ok($$select public.confirm_cash_purchase((select (r->>'id')::uuid from _ip_b), null)$$,
  'PROVIDER_VERIFICATION_REQUIRED', 'admin cannot manually credit InfinitePay');
select throws_ok($$select public.cancel_cash_purchase((select (r->>'id')::uuid from _ip_b), 'cancelar sem consulta')$$,
  'PROVIDER_RECONCILIATION_REQUIRED', 'admin cannot cancel payable InfinitePay link');
select set_config('request.jwt.claim.sub', '72000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.confirm_cash_purchase((select (r->>'id')::uuid from _ip_b), null)$$,
  'PERMISSION_DENIED', 'ordinary user cannot use manual admin fallback');

select * from finish();
rollback;
