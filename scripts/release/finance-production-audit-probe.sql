-- Strictly read-only production identity/coverage probe. No app RPCs or data writes.
begin read only;
set local statement_timeout='5s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
select jsonb_build_object(
 'captured_at',transaction_timestamp(),
 'read_only',current_setting('transaction_read_only'),
 'database',current_database(),
 'server_version',current_setting('server_version'),
 'role',current_user,
 'role_bypass_rls',(select rolbypassrls from pg_catalog.pg_roles where rolname=current_user),
 'role_superuser',(select rolsuper from pg_catalog.pg_roles where rolname=current_user),
 'migration_count',(select count(*) from supabase_migrations.schema_migrations),
 'latest_migration',(select max(version) from supabase_migrations.schema_migrations),
 'commercial_orders',to_regclass('public.commercial_orders') is not null,
 'evocash_price_versions',to_regclass('public.evocash_price_versions') is not null,
 'storefronts',to_regclass('public.product_storefronts') is not null,
 'advertising_placements',to_regclass('public.advertising_placements') is not null
) as production_probe;
rollback;
