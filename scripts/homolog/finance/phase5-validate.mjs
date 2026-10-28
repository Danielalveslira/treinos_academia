process.env.FINANCE_EVIDENCE_DIR = 'docs/finance-restructure/phase5/evidence'
if (process.argv.length === 2)
  process.argv.push(
    'professional_commercial_test.sql',
    'storefront_revisions_test.sql',
    'product_storefronts_test.sql',
    'commercial_engine_test.sql',
    'evocash_pricing_test.sql',
    'infinitepay_cash_purchases_test.sql',
    'finance_integrity_test.sql',
    'finance_reversals_test.sql',
    'public_professional_directory_test.sql',
    'showcase_publish_recovery_test.sql',
    'admin_vitrines_denuncias_test.sql',
    'aud_has_app_access_gates_test.sql',
    'session_revocation_guard_test.sql',
    'notification_security_test.sql',
    'security_followup_test.sql',
    'public_commercial_test.sql',
    'partner_products_require_image_test.sql'
  )
await import('./phase41-validate.mjs')
