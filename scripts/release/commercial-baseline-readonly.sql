-- Phase 0 only: aggregates and catalog metadata; no customer/media/provider payloads.
begin read only;
set local statement_timeout = '10s';
set local lock_timeout = '2s';
set local search_path = pg_catalog;
select jsonb_build_object(
  'read_only', current_setting('transaction_read_only'),
  'captured_at', transaction_timestamp(),
  'commercial_counts', jsonb_build_object(
    'ads', (select count(*) from public.sponsored_ads),
    'expired_ads', (select count(*) from public.sponsored_ads where expires_at <= now()),
    'ads_without_expiry', (select count(*) from public.sponsored_ads where expires_at is null),
    'products', (select count(*) from public.partner_products),
    'approved_products_without_expiry', (select count(*) from public.partner_products where approved and ends_at is null),
    'listings', (select count(*) from public.professional_listings),
    'published_listings', (select count(*) from public.published_professional_listings),
    'advertiser_accounts', (select count(*) from public.advertiser_accounts),
    'advertiser_members', (select count(*) from public.advertiser_members),
    'advertiser_campaigns', (select count(*) from public.advertiser_campaigns),
    'promotions', (select count(*) from public.promotions)
  ),
  'configuration_keys', (select jsonb_agg(k order by k) from public.economy_config c cross join lateral jsonb_object_keys(c.config) k where c.id),
  'financial_control_keys', (select jsonb_agg(k order by k) from public.economy_config c cross join lateral jsonb_object_keys(coalesce(c.config->'financialControls','{}'::jsonb)) k where c.id),
  'metrics_collection_enabled', (select collection_enabled from public.sponsored_ad_metrics_settings where id),
  'storage_buckets', (select jsonb_agg(jsonb_build_object('id',id,'public',public,'file_size_limit',file_size_limit,'allowed_mime_types',allowed_mime_types) order by id) from storage.buckets),
  'storage_policies', (select jsonb_agg(jsonb_build_object('name',polname,'command',polcmd,'roles',polroles,'using',pg_get_expr(polqual,polrelid),'check',pg_get_expr(polwithcheck,polrelid)) order by polname) from pg_policy where polrelid='storage.objects'::regclass),
  'function_hashes', (select jsonb_object_agg(p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f'),
  'dependencies', (select jsonb_agg(jsonb_build_object('source',pg_describe_object(d.classid,d.objid,d.objsubid),'target',pg_describe_object(d.refclassid,d.refobjid,d.refobjsubid),'type',d.deptype) order by d.classid,d.objid,d.objsubid,d.refclassid,d.refobjid,d.refobjsubid)
    from pg_depend d where d.refclassid='pg_class'::regclass and d.refobjid in (
      'public.wallets'::regclass, 'public.economy_transactions'::regclass,
      'public.cash_purchases'::regclass, 'public.promotions'::regclass,
      'public.sponsored_ads'::regclass, 'public.partner_products'::regclass,
      'public.professional_listings'::regclass, 'public.published_professional_listings'::regclass,
      'public.advertiser_accounts'::regclass, 'public.advertiser_members'::regclass,
      'public.advertiser_campaigns'::regclass))
) as commercial_baseline;
rollback;
