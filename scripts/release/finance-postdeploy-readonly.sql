-- Run only after all planned migrations are recorded. Monitoring, never repair.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
select jsonb_build_object(
 'latest_migration',(select max(version) from supabase_migrations.schema_migrations),
 'reversals_enabled',(select coalesce((config#>>'{financialControls,reversalsEnabled}')='true',false) from public.economy_config where id),
 'unapproved_new_financial_jobs',(select count(*) from cron.job where active and (jobname ilike '%finance%reconcil%' or jobname ilike '%cash%reversal%')),
 'purchase_statuses',(select jsonb_agg(x order by x.status) from (select status,count(*) from public.cash_purchases group by status) x),
 'credited_missing_ledger',(select count(*) from public.cash_purchases p where status='credited' and p.user_id is not null and not exists(select 1 from public.economy_transactions t where t.natural_key='cash-purchase:'||p.id and t.asset='cash' and t.direction='credit' and t.amount=p.cash_amount and t.user_id=p.user_id)),
 'duplicate_purchase_credits',(select count(*) from (select reference_id from public.economy_transactions where asset='cash' and direction='credit' and reference_type='cash_purchase' group by reference_id having count(*)>1) d),
 'reconciliation_exhausted',(select count(*) from public.cash_purchases where payment_provider='infinitepay' and status in ('pending','cancelled') and reconciliation_attempts>=10),
 'identified_pending_purchases',(select count(*) from public.cash_purchases where status='pending' and provider_transaction_nsu is not null and provider_invoice_slug is not null),
 'review_required',(select count(*) from public.cash_purchases where status='needs_review'),
 'reversal_aggregate_mismatch',(select count(*) from public.cash_purchases p where reversed_centavos<>(select coalesce(sum(r.amount_centavos),0) from public.cash_purchase_reversals r where r.purchase_id=p.id)),
 'outstanding_reversal_units',(select coalesce(sum(cash_units-recovered_units),0) from public.cash_purchase_reversals),
 'findings',(select jsonb_agg(x order by x.kind) from (select kind,count(*) from private.finance_reconciliation_findings group by kind) x),
 'negative_wallets',(select count(*) from public.wallets where coin_balance<0 or cash_balance<0 or lifetime_coins_earned<0),
 'daily_cap_excess',(select count(*) from public.economy_daily where earned_total>10),
 'permissions',jsonb_build_object('authenticated_wallet_update',has_table_privilege('authenticated','public.wallets','update'),'authenticated_credit_helper',has_function_privilege('authenticated','public._wallet_credit_cash(uuid,numeric)','execute'),'anon_confirmation',has_function_privilege('anon','public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)','execute')),
 'deadlocks',(select deadlocks from pg_stat_database where datname=current_database())
) as finance_postdeploy;
rollback;
