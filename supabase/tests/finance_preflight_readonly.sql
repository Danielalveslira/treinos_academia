-- Explicitly read-only. Does not infer/rewrite an opening balance or validate constraints.
begin read only;
set local statement_timeout='5s';
select 'wallet_negative' as diagnostic,count(*) from public.wallets
 where coin_balance<0 or cash_balance<0 or lifetime_coins_earned<0;
select 'ledger_invalid_units' as diagnostic,count(*) from public.economy_transactions
 where amount::text in ('NaN','Infinity','-Infinity') or amount<>trunc(amount) or amount not between 1 and 2147483647;
select 'purchase_invalid_units' as diagnostic,count(*) from public.cash_purchases
 where cash_amount::text in ('NaN','Infinity','-Infinity') or cash_amount<>trunc(cash_amount) or cash_amount not between 1 and 1000000;
select 'promotion_invalid_units' as diagnostic,count(*) from public.promotions
 where cash_amount::text in ('NaN','Infinity','-Infinity') or cash_amount<>trunc(cash_amount) or cash_amount not between 1 and 1000000;
select 'credited_without_identity' as diagnostic,count(*) from public.cash_purchases
 where payment_provider='infinitepay' and status='credited' and (provider_transaction_nsu is null or provider_invoice_slug is null);
select conrelid::regclass as relation,conname,convalidated from pg_constraint
 where conrelid in ('public.wallets'::regclass,'public.economy_transactions'::regclass,'public.cash_purchases'::regclass,'public.promotions'::regclass)
 and contype='c' order by conrelid::regclass::text,conname;
rollback;
