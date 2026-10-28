import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const names = [
  '20261201000001_product_storefronts.sql',
  '20261202000001_storefront_editorial_revisions.sql',
  '20261202000002_storefront_media_maintenance_legacy.sql',
  '20261203000001_professional_commercial_publication.sql',
]
const sql =
  'begin;' +
  names
    .map(
      (n) =>
        (n.startsWith('20261203')
          ? readFileSync('supabase/tests/professional_legacy_migration.sql', 'utf8')
          : '') + readFileSync('supabase/migrations/' + n, 'utf8')
    )
    .join('\n') +
  "do $$begin if not exists(select 1 from public.professional_listing_drafts where listing_id='75900000-0000-0000-0000-000000000002' and display_name='Legacy preserved' and version=7 and review_state='draft' and contacts->>'website'='https://example.invalid') then raise exception 'LEGACY_DRAFT_LOST';end if;if not exists(select 1 from public.published_professional_listings where listing_id='75900000-0000-0000-0000-000000000002' and avatar_path='historic/personal-avatar.webp') then raise exception 'LEGACY_SNAPSHOT_LOST';end if;if public.public_get_professional('75900000-0000-0000-0000-000000000002') is not null or exists(select 1 from public.visibility_entitlements where resource_id='75900000-0000-0000-0000-000000000002') then raise exception 'LEGACY_FREE_PUBLICATION';end if;end$$;select 'LEGACY_PRESERVED_PRIVATE_NO_FREE_ENTITLEMENT';rollback;"
const out = execFileSync(
  'docker',
  [
    'exec',
    '-i',
    'evolutus_commercial_phase0_20261027',
    'psql',
    '-U',
    'supabase_admin',
    '-d',
    'postgres',
    '-v',
    'ON_ERROR_STOP=1',
  ],
  { input: sql, encoding: 'utf8' }
)
writeFileSync('docs/finance-restructure/phase5/evidence/migrations-reinstall.log', out)
console.log('Complete Phase 4/4.1/5 installation rolled back on baseline')
