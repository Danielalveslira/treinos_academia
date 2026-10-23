\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('73000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'recon-active@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('73000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'recon-disabled@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('73000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'recon-unpaid@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('73000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'recon-stale@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('73000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'recon-admin@example.invalid', 'unused', now(), '{}', '{}', now(), now());
update public.users set role = 'superadmin' where id = '73000000-0000-0000-0000-000000000005';

-- ============================================================================
-- Pagamento confirmado, conta ATIVA: comportamento existente, sem regressão.
-- ============================================================================
create temp table _r_active as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000001', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_active), 'https://checkout.infinitepay.io/evolutus?lenc=active');
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_active),
  (select r->>'orderNsu' from _r_active), 'txn-active', 'invoice-active', 590, 'pix', null)->>'credited'),
  'true', 'active account: confirmed payment credits normally');
select is((select status from public.cash_purchases where id = (select (r->>'id')::uuid from _r_active)),
  'credited', 'active account purchase ends credited');

-- ============================================================================
-- Pagamento confirmado, conta DESATIVADA: nunca credita sozinho -- needs_review.
-- ============================================================================
create temp table _r_disabled as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000002', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_disabled), 'https://checkout.infinitepay.io/evolutus?lenc=disabled');
update public.users set account_status = 'disabled' where id = '73000000-0000-0000-0000-000000000002';
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_disabled),
  (select r->>'orderNsu' from _r_disabled), 'txn-disabled', 'invoice-disabled', 590, 'pix', null)->>'reason'),
  'needs_review', 'disabled account: confirmed payment is parked for manual decision');
select is((select status from public.cash_purchases where id = (select (r->>'id')::uuid from _r_disabled)),
  'needs_review', 'purchase status is needs_review');
select is((select review_reason from public.cash_purchases where id = (select (r->>'id')::uuid from _r_disabled)),
  'payment_confirmed_inactive_account', 'review reason recorded');
select ok((select review_flagged_at is not null from public.cash_purchases where id = (select (r->>'id')::uuid from _r_disabled)),
  'review flagged timestamp recorded');
select is((select coalesce((select cash_balance::int from public.wallets where user_id = '73000000-0000-0000-0000-000000000002'), 0)),
  0, 'disabled account wallet is never credited automatically');
select is((select count(*)::int from public.economy_transactions where reference_id = (select r->>'id' from _r_disabled)),
  0, 'disabled account: no ledger entry written');
select is(public._compute_financial_block_reason('73000000-0000-0000-0000-000000000002'),
  'pending_cash_purchase', 'needs_review purchase still blocks account deletion like a pending one');

-- Reprocessamento idempotente: webhook retry não credita, não reflag, não duplica.
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_disabled),
  (select r->>'orderNsu' from _r_disabled), 'txn-disabled', 'invoice-disabled', 590, 'pix', null)->>'reason'),
  'already_needs_review', 'idempotent retry after needs_review does not re-flag or credit');

-- Admin credita manualmente (ex.: conta foi reativada) -- idempotente.
select pg_temp.set_test_user( '73000000-0000-0000-0000-000000000005', true);
select is((public.admin_resolve_cash_purchase_review((select (r->>'id')::uuid from _r_disabled), 'credit', 'Conta reativada, creditar normalmente.')->>'status'),
  'credited', 'admin resolves needs_review by crediting');
select is((select cash_balance::int from public.wallets where user_id = '73000000-0000-0000-0000-000000000002'), 25, 'wallet credited once after manual decision');
select is((select count(*)::int from public.economy_transactions where reference_id = (select r->>'id' from _r_disabled)),
  1, 'exactly one ledger entry after manual credit');
select is((public.admin_resolve_cash_purchase_review((select (r->>'id')::uuid from _r_disabled), 'credit', 'Conta reativada, creditar normalmente.')->>'replay'),
  'true', 'repeating the resolve call is idempotent');
select is((select cash_balance::int from public.wallets where user_id = '73000000-0000-0000-0000-000000000002'), 25, 'retry does not credit twice');

-- Resolução por reembolso externo: nunca credita.
update public.users set account_status='active' where id='73000000-0000-0000-0000-000000000002';
create temp table _r_disabled2 as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000002', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_disabled2), 'https://checkout.infinitepay.io/evolutus?lenc=disabled2');
update public.users set account_status='disabled' where id='73000000-0000-0000-0000-000000000002';
select public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_disabled2),
  (select r->>'orderNsu' from _r_disabled2), 'txn-disabled2', 'invoice-disabled2', 590, 'pix', null);
select pg_temp.set_test_user( '73000000-0000-0000-0000-000000000005', true);
select is((public.admin_resolve_cash_purchase_review((select (r->>'id')::uuid from _r_disabled2), 'refund_externally', 'Reembolsado fora do app, não creditar EvoCash.')->>'status'),
  'cancelled', 'admin resolves needs_review by external refund, never crediting');
select is((select cash_balance::int from public.wallets where user_id = '73000000-0000-0000-0000-000000000002'), 25, 'external refund does not touch wallet');
select is((select review_resolution from public.cash_purchases where id = (select (r->>'id')::uuid from _r_disabled2)),
  'refunded_externally', 'review resolution recorded');

select pg_temp.set_test_user( '73000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.admin_resolve_cash_purchase_review('00000000-0000-0000-0000-000000000000', 'credit', 'tentativa sem permissao')$$,
  'PERMISSION_DENIED', 'ordinary user cannot resolve a review');

-- ============================================================================
-- Sem pagamento confirmado: cancelamento oficial via fallback admin (fluxo ausente antes
-- desta migration -- confirm_cash_purchase/cancel_cash_purchase nunca funcionaram para
-- InfinitePay e foram removidos).
-- ============================================================================
create temp table _r_unpaid as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000003', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_unpaid), 'https://checkout.infinitepay.io/evolutus?lenc=unpaid');
select pg_temp.set_test_user( '73000000-0000-0000-0000-000000000003', true);
select throws_ok($$select public.admin_cancel_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_unpaid), 'tentativa sem permissao')$$,
  'PERMISSION_DENIED', 'ordinary user cannot use the admin cancellation fallback');
select pg_temp.set_test_user( '73000000-0000-0000-0000-000000000005', true);
select throws_ok($$select public.admin_cancel_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_unpaid), 'oi')$$,
  'REASON_REQUIRED', 'reason must be at least 5 characters');
select is((public.admin_cancel_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_unpaid), 'Sem pagamento confirmado na InfinitePay após verificação manual.')->>'status'),
  'cancelled', 'admin cancels a stuck unpaid purchase');
select ok((select cancelled_by = '73000000-0000-0000-0000-000000000005' from public.cash_purchases where id = (select (r->>'id')::uuid from _r_unpaid)),
  'admin identity recorded on the purchase');
select is((public.admin_cancel_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_unpaid), 'segunda tentativa, mesmo motivo')->>'replay'),
  'true', 'duplicate admin cancellation is idempotent');
-- Pagamento tardio depois do cancelamento administrativo ainda é reconciliado -- nunca perdido.
select is((public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _r_unpaid),
  (select r->>'orderNsu' from _r_unpaid), 'txn-unpaid', 'invoice-unpaid', 590, 'pix', null)->>'credited'),
  'true', 'late confirmed payment after admin cancellation still settles');

-- ============================================================================
-- Expiração automática (prevenção de recorrência, independente do status da conta).
-- ============================================================================
create temp table _r_stale as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000004', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_stale), 'https://checkout.infinitepay.io/evolutus?lenc=stale');
update public.cash_purchases set created_at = now() - interval '10 days' where id = (select (r->>'id')::uuid from _r_stale);
select is(private.expire_stale_infinitepay_purchases(200), 1, 'one stale pending purchase expired');
select is((select status from public.cash_purchases where id = (select (r->>'id')::uuid from _r_stale)),
  'cancelled', 'stale purchase is cancelled, not deleted');
select matches((select cancel_reason from public.cash_purchases where id = (select (r->>'id')::uuid from _r_stale)),
  '^Expirada automaticamente', 'cancellation reason explains automatic expiry');
select is((select coalesce((select cash_balance::int from public.wallets where user_id = '73000000-0000-0000-0000-000000000004'), 0)),
  0, 'expiry never credits anything');
select is(private.expire_stale_infinitepay_purchases(200), 0, 'running the cron body again is a no-op (idempotent)');

create temp table _r_fresh as
  select public.reserve_infinitepay_cash_purchase('73000000-0000-0000-0000-000000000004', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _r_fresh), 'https://checkout.infinitepay.io/evolutus?lenc=fresh');
select is(private.expire_stale_infinitepay_purchases(200), 0, 'a fresh pending purchase within the window is left alone');
select is((select status from public.cash_purchases where id = (select (r->>'id')::uuid from _r_fresh)),
  'pending', 'fresh purchase remains pending');

select * from finish();
rollback;
