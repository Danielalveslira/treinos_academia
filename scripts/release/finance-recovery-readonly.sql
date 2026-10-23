-- Recovery evidence: counts and row fingerprints only; no identities or secrets returned.
-- MD5 here detects accidental snapshot differences; encrypted dump SHA-256 is recorded separately.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
with snapshots as (
select 'public.wallets' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.wallets t
union all
select 'public.economy_transactions' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.economy_transactions t
union all
select 'public.cash_purchases' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.cash_purchases t
union all
select 'public.economy_config' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.economy_config t
union all
select 'public.economy_daily' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.economy_daily t
union all
select 'public.economy_reward_rules' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.economy_reward_rules t
union all
select 'public.economy_reward_settings' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.economy_reward_settings t
union all
select 'public.promotions' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.promotions t
union all
select 'public.account_financial_cases' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.account_financial_cases t
union all
select 'public.account_financial_case_events' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.account_financial_case_events t
union all
select 'public.account_financial_case_items' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.account_financial_case_items t
union all
select 'public.users' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from public.users t
union all
select 'auth.users' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from auth.users t
union all
select 'auth.sessions' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from auth.sessions t
union all
select 'auth.refresh_tokens' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from auth.refresh_tokens t
union all
select 'storage.buckets' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from storage.buckets t
union all
select 'storage.objects' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from storage.objects t
union all
select 'supabase_migrations.schema_migrations' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from supabase_migrations.schema_migrations t
union all
select 'cron.job' as relation,count(*) as rows,md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) as row_fingerprint from cron.job t
) select jsonb_agg(to_jsonb(s) order by relation) as finance_recovery from snapshots s;
rollback;
