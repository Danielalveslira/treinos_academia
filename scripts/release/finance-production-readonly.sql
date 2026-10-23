-- Read-only production preflight. No customer identities, payment payloads or secrets.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
select jsonb_build_object(
 'latest_migration',(select max(version) from supabase_migrations.schema_migrations),
 'migration_versions',(select jsonb_agg(version order by version) from supabase_migrations.schema_migrations),
 'server_version',current_setting('server_version'),
 'invalid_wallets',(select count(*) from public.wallets where coin_balance<0 or cash_balance<0 or lifetime_coins_earned<0),
 'fractional_ledger',(select count(*) from public.economy_transactions where amount::text in ('NaN','Infinity','-Infinity') or amount<>trunc(amount) or amount not between 1 and 2147483647),
 'invalid_purchase_units',(select count(*) from public.cash_purchases where cash_amount::text in ('NaN','Infinity','-Infinity') or cash_amount<>trunc(cash_amount) or cash_amount not between 1 and 1000000),
 'invalid_promotion_units',(select count(*) from public.promotions where cash_amount::text in ('NaN','Infinity','-Infinity') or cash_amount<>trunc(cash_amount) or cash_amount not between 1 and 1000000),
 'economy_sizes',jsonb_build_object('wallets',(select count(*) from public.wallets),'ledger',(select count(*) from public.economy_transactions),'purchases',(select count(*) from public.cash_purchases)),
 'reward_cap',(select daily_cap from public.economy_reward_settings where id),
 'credited_without_provider_identity',(select count(*) from public.cash_purchases where payment_provider='infinitepay' and status='credited' and (provider_transaction_nsu is null or provider_invoice_slug is null)),
 'session_columns',(select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema='auth' and table_name='sessions'),
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',p.proacl::text) order by p.oid::regprocedure::text)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
 'relations',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'rls',c.relrowsecurity,'acl',c.relacl::text,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('name',k.conname,'definition',pg_get_constraintdef(k.oid),'validated',k.convalidated) order by k.conname) from pg_constraint k where k.conrelid=c.oid),
  'policies',(select jsonb_agg(jsonb_build_object('name',p.polname,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname) from pg_policy p where p.polrelid=c.oid),
  'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by x.relname) from pg_index i join pg_class x on x.oid=i.indexrelid where i.indrelid=c.oid)) order by c.oid::regclass::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r')
) as financial_preflight;
rollback;
