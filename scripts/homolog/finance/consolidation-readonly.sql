-- Reproducible audit: aggregate counts only; never repair balances here.
begin read only;
set local statement_timeout='20s';
set local lock_timeout='2s';
select jsonb_build_object(
 'wallet_ledger_mismatch',(select count(*) from public.wallets w left join (
   select user_id, sum(case when asset='cash' then case direction when 'credit' then amount else -amount end else 0 end) cash,
   sum(case when asset='coin' then case direction when 'credit' then amount else -amount end else 0 end) coins
   from public.economy_transactions group by user_id
 ) l using(user_id) where w.cash_balance<>coalesce(l.cash,0) or w.coin_balance<>coalesce(l.coins,0)),
 'negative_wallet',(select count(*) from public.wallets where cash_balance<0 or coin_balance<0),
 'fulfilled_without_debit',(select count(*) from public.commercial_orders o where status in ('fulfilled','reversed') and not exists (
   select 1 from public.economy_transactions t where t.natural_key='commercial:'||o.id and t.user_id=o.payer_user_id and t.asset='cash' and t.direction='debit' and t.amount=o.total_cash)),
 'reversed_without_refund',(select count(*) from public.commercial_orders o where status='reversed' and not exists (
   select 1 from public.economy_transactions t where t.natural_key='commercial_refund:'||o.id and t.user_id=o.payer_user_id and t.asset='cash' and t.direction='credit' and t.amount=o.total_cash)),
 'entitlement_without_fulfilled_order',(select count(*) from public.visibility_entitlements e left join public.commercial_orders o on o.id=e.origin_order_id and o.resource_id=e.resource_id where o.id is null or (e.administrative_state='enabled' and o.status<>'fulfilled')),
 'orphan_commercial_ledger',(select count(*) from public.economy_transactions t where reference_type='commercial_order' and not exists(select 1 from public.commercial_orders o where o.id::text=t.reference_id)),
 'duplicate_natural_keys',(select count(*) from (select user_id,natural_key from public.economy_transactions group by user_id,natural_key having count(*)>1)t),
 'duplicate_order_debits',(select count(*) from (select reference_id from public.economy_transactions where reference_type='commercial_order' and direction='debit' group by reference_id having count(*)>1)t),
 'credited_purchase_without_ledger',(select count(*) from public.cash_purchases p where status='credited' and user_id is not null and not exists(select 1 from public.economy_transactions t where t.user_id=p.user_id and t.natural_key='cash-purchase:'||p.id and t.amount=p.cash_amount and t.asset='cash' and t.direction='credit')),
 'wallet_update_authenticated',has_table_privilege('authenticated','public.wallets','UPDATE'),
 'wallet_update_service_role',has_table_privilege('service_role','public.wallets','UPDATE'),
 'credit_helper_authenticated',has_function_privilege('authenticated','public._wallet_credit_cash(uuid,numeric)','EXECUTE'),
 'metrics_collection_enabled',(select collection_enabled from public.sponsored_ad_metrics_settings where id)
) as integrity;
select jsonb_build_object(
 'registered_versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'phase6_objects_exist',to_regclass('public.advertising_placements') is not null,
 'domain_tables_without_rls',(select coalesce(jsonb_agg(c.relname),'[]') from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname ~ '^(commercial_|advertising_|visibility_|wallets$|economy_transactions$)' and not c.relrowsecurity),
 'definers_without_fixed_search_path',(select coalesce(jsonb_agg(p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prosecdef and p.prokind='f' and not exists(select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%')),
 'private_functions_executable_by_authenticated',(select coalesce(jsonb_agg(p.oid::regprocedure::text),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('authenticated',p.oid,'EXECUTE')),
 'duplicate_index_definitions',(select coalesce(jsonb_agg(x),'[]') from (select i.indrelid::regclass::text as relation,i.indkey::text,pg_get_expr(i.indpred,i.indrelid) predicate,array_agg(i.indexrelid::regclass::text) names from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','private') group by i.indrelid,i.indkey::text,pg_get_expr(i.indpred,i.indrelid),i.indclass::text,i.indexprs::text,i.indisunique having count(*)>1)x)
) as schema_audit;
rollback;
