// Upgrade proof on the disposable Phase 3 baseline, including legacy editorials.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
const container = 'evolutus_commercial_phase0_20261027'
const run = (source) =>
  execFileSync(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-U',
      'supabase_admin',
      '-d',
      'postgres',
      '-X',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { input: source, encoding: 'utf8', maxBuffer: 8000000 }
  )
const existing = run("select to_regclass('public.product_storefronts') is null as clean_boundary;")
assert.match(existing, /\bt\b/, 'A Phase 3 disposable boundary is required')
const migration = readFileSync('supabase/migrations/20261201000001_product_storefronts.sql', 'utf8')
const source = `begin;
insert into public.partner_products(name,brand,description,category,image_url,store_url,approved) values('Synthetic legacy record','Legacy brand','Legacy description preserved during upgrade','Fitness','https://example.invalid/legacy.webp','https://example.invalid/product',true);
create temp table sf_legacy_before as select to_jsonb(p) as row_data from public.partner_products p;
create temp table sf_money_before as select (select count(*) from public.economy_transactions) ledger_count,(select coalesce(sum(cash_balance),0) from public.wallets) wallet_sum;
${migration}
do $$begin
 if exists((select row_data from sf_legacy_before) except (select to_jsonb(p)-array['storefront_id','media_id','archived','display_order','price_centavos'] from public.partner_products p)) or (select count(*) from public.partner_products)<>(select count(*) from sf_legacy_before) then raise exception 'LEGACY_DATA_CHANGED';end if;
 if (select ledger_count from sf_money_before)<>(select count(*) from public.economy_transactions) or (select wallet_sum from sf_money_before)<>(select coalesce(sum(cash_balance),0) from public.wallets) then raise exception 'FINANCIAL_BASE_CHANGED';end if;
 if exists(select 1 from public.commercial_price_versions where offering_code='product_storefront') or exists(select 1 from public.commercial_offerings where code='product_storefront' and sales_enabled) or exists(select 1 from public.storefront_settings where max_products is not null or max_storefronts is not null) then raise exception 'UNAPPROVED_COMMERCIAL_DEFAULTS';end if;
end$$;
select 'Legacy editorials preserved; no financial changes; no prices/sales/limits seeded' as verification;
rollback;`
const log = run(source)
mkdirSync('docs/finance-restructure/phase4/evidence', { recursive: true })
writeFileSync('docs/finance-restructure/phase4/evidence/migration-final-install.log', log)
console.log('Phase 4 migration upgrade and preservation PASS (rolled back)')
