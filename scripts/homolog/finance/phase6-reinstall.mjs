// Accumulated installation on the preserved disposable Phase 3 baseline. Always rollback.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const db = 'evolutus_commercial_phase0_20261027'
execFileSync('docker', ['start', db], { stdio: 'ignore' })
let ready = false
for (let i = 0; i < 30; i++) {
  try {
    execFileSync('docker', ['exec', db, 'pg_isready', '-U', 'supabase_admin'], { stdio: 'ignore' })
    ready = true
    break
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
}
if (!ready) throw Error('LOCAL_BASELINE_NOT_READY')
const early = [
  '20261201000001_product_storefronts.sql',
  '20261202000001_storefront_editorial_revisions.sql',
  '20261202000002_storefront_media_maintenance_legacy.sql',
  '20261203000001_professional_commercial_publication.sql',
  '20261204000001_multiple_professional_listings.sql',
  '20261204000002_admin_account_listing_summary.sql',
]
const phase6 = readdirSync('supabase/migrations')
  .filter((n) => n.startsWith('20261205') || n.startsWith('20261206'))
  .sort()
const digest = `select jsonb_build_object('wallet',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by user_id)::text,'')) from public.wallets t),'ledger',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.economy_transactions t),'orders',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.commercial_orders t),'rights',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.visibility_entitlements t),'prices',(select md5(coalesce(jsonb_agg(to_jsonb(t) order by id)::text,'')) from public.commercial_price_versions t),'legacyAds',(select md5(coalesce(jsonb_agg(jsonb_build_array(id,title,description,expires_at,community_ids,is_global,display_mode) order by id)::text,'')) from public.sponsored_ads)) value`
const source =
  'begin;' +
  early
    .map(
      (n) =>
        (n.startsWith('20261203')
          ? readFileSync('supabase/tests/professional_legacy_migration.sql', 'utf8')
          : '') + readFileSync('supabase/migrations/' + n, 'utf8')
    )
    .join('\n') +
  'create temp table before_phase6 as ' +
  digest +
  ';' +
  phase6.map((n) => readFileSync('supabase/migrations/' + n, 'utf8')).join('\n') +
  'create temp table after_phase6 as ' +
  digest +
  `;do $$begin if(select value from before_phase6) is distinct from(select value from after_phase6)then raise exception 'FINANCIAL_OR_LEGACY_HISTORY_CHANGED';end if;if exists(select 1 from public.advertising_placements where capacity<>0 or sales_enabled or delivery_enabled)then raise exception 'UNSAFE_INVENTORY_DEFAULTS';end if;if exists(select 1 from private.advertising_network_bundle)then raise exception 'NETWORK_SEED_FORBIDDEN';end if;end$$;select 'PHASE6_ACCUMULATED_INSTALL_SAFE_FINANCIAL_HASHES_UNCHANGED';rollback;`
const result = execFileSync(
  'docker',
  ['exec', '-i', db, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'],
  { input: source, encoding: 'utf8', maxBuffer: 8e6 }
)
writeFileSync('docs/finance-restructure/phase6/evidence/migrations-reinstall.log', result)
console.log(
  'All Phase 6 migrations installed and rolled back; financial and legacy hashes unchanged'
)
