# Arquivos da Fase 4

Base: `finance-commercial-phase3` (`cd0fb0e`). Implementação isolada na branch `finance-storefront-phase4`.

## Modificados

```text
.github/workflows/supabase-tests.yml
scripts/homolog/finance/index.ts
scripts/public-pages-template.mjs
scripts/public-preview-plugin.js
scripts/service-worker.js
src/App.jsx
src/components/CommercialAdmin.jsx
src/components/CommercialAdmin.test.js
src/components/PartnerProductForm.jsx
src/components/PartnerProductList.jsx
src/features/publicProducts/ProductCard.jsx
src/features/publicProducts/ProductDialog.jsx
src/features/publicProducts/ProductGroups.jsx
src/features/publicProducts/PublicProductsIsland.jsx
src/features/publicProducts/publicProductCatalogService.js
src/pages/AdminSponsoredAds.jsx
src/pwa/serviceWorker.test.js
supabase/config.toml
supabase/tests/public_commercial_test.sql
vercel.json
```

## Novos

```text
api/storefront.js
docs/finance-restructure/phase4/ARQUIVOS.md
docs/finance-restructure/phase4/ENTREGA.md
docs/finance-restructure/phase4/INVENTARIO.md
docs/finance-restructure/phase4/evidence/browser.json
docs/finance-restructure/phase4/evidence/browser.log
docs/finance-restructure/phase4/evidence/budget.log
docs/finance-restructure/phase4/evidence/build.log
docs/finance-restructure/phase4/evidence/commercial_engine_test.log
docs/finance-restructure/phase4/evidence/concurrency.json
docs/finance-restructure/phase4/evidence/concurrency.log
docs/finance-restructure/phase4/evidence/evocash_pricing_test.log
docs/finance-restructure/phase4/evidence/finance_integrity_test.log
docs/finance-restructure/phase4/evidence/finance_reversals_test.log
docs/finance-restructure/phase4/evidence/http.json
docs/finance-restructure/phase4/evidence/http.log
docs/finance-restructure/phase4/evidence/infinitepay_cash_purchases_test.log
docs/finance-restructure/phase4/evidence/js.log
docs/finance-restructure/phase4/evidence/lint.log
docs/finance-restructure/phase4/evidence/migration-final-install.log
docs/finance-restructure/phase4/evidence/migration-install.log
docs/finance-restructure/phase4/evidence/partner_products_require_image_test.log
docs/finance-restructure/phase4/evidence/performance.log
docs/finance-restructure/phase4/evidence/preview.json
docs/finance-restructure/phase4/evidence/product_storefronts_test.log
docs/finance-restructure/phase4/evidence/public_commercial_test.log
docs/finance-restructure/phase4/evidence/quality.json
docs/finance-restructure/phase4/evidence/release.log
docs/finance-restructure/phase4/evidence/source-manifest.json
docs/finance-restructure/phase4/evidence/sql-summary.json
public/storefront-detail.css
public/storefront-detail.js
scripts/homolog/finance/phase4-browser.mjs
scripts/homolog/finance/phase4-http.mjs
scripts/homolog/finance/phase4-migration-check.mjs
scripts/homolog/finance/phase4-preview.mjs
scripts/homolog/finance/phase4-seed.mjs
scripts/homolog/finance/phase4-validate.mjs
scripts/storefront-concurrency.mjs
src/components/CommercialLeasePurchase.jsx
src/components/StorefrontImage.jsx
src/components/StorefrontManager.jsx
src/pages/MyProductStorefronts.jsx
src/services/storefrontService.js
src/services/storefrontService.test.js
src/utils/storefront.js
src/utils/storefront.test.js
supabase/functions/storefront-media/index.ts
supabase/migrations/20261201000001_product_storefronts.sql
supabase/tests/product_storefronts_performance.sql
supabase/tests/product_storefronts_test.sql
tests/storefront-public-handler.test.mjs
```

Nenhum arquivo versionado removido. Removidos a função obsoleta `productStatus`, seu parâmetro `now` e o cálculo de relógio da lista legada; substituídas a policy e a consulta pública que não exigiam contrato. Os demais consumidores de carteira, promoções, relatórios, profissionais e InfinitePay permanecem.

Capturas, credenciais, tokens, configurações e caches locais não integram esta lista. `source-manifest.json` registra os hashes SHA-256 dos arquivos entregues, sem hash recursivo de si próprio.
