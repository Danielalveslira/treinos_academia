# Inventário de arquivos — Fase 3

Comparação com `finance-quantity-phase2` (`48ea165`). Alterações restritas a este worktree; não houve push ou merge. Arquivos gerados/segredos locais e capturas não integram a entrega.

## Arquivos alterados

```text
.github/workflows/supabase-tests.yml
eslint.config.js
src/hooks/useAdminCommunities.js
src/hooks/useAdminSponsoredAds.js
src/pages/AdminSponsoredAds.jsx
```

## Arquivos novos

```text
docs/finance-restructure/phase3/ARQUIVOS.md
docs/finance-restructure/phase3/ENTREGA.md
docs/finance-restructure/phase3/INVENTARIO.md
docs/finance-restructure/phase3/evidence/browser.json
docs/finance-restructure/phase3/evidence/browser.log
docs/finance-restructure/phase3/evidence/build.log
docs/finance-restructure/phase3/evidence/businessdate-retry.log
docs/finance-restructure/phase3/evidence/commercial_engine_test.log
docs/finance-restructure/phase3/evidence/concurrency.json
docs/finance-restructure/phase3/evidence/evocash_pricing_test.log
docs/finance-restructure/phase3/evidence/finance_integrity_test.log
docs/finance-restructure/phase3/evidence/finance_reversals_test.log
docs/finance-restructure/phase3/evidence/infinitepay_cash_purchases_test.log
docs/finance-restructure/phase3/evidence/js.log
docs/finance-restructure/phase3/evidence/lint.log
docs/finance-restructure/phase3/evidence/migration-install.log
docs/finance-restructure/phase3/evidence/performance.log
docs/finance-restructure/phase3/evidence/quality.json
docs/finance-restructure/phase3/evidence/release-tests.log
docs/finance-restructure/phase3/evidence/source-manifest.json
docs/finance-restructure/phase3/evidence/sql-summary.json
scripts/commercial-engine-concurrency.mjs
scripts/homolog/finance/phase3-browser.mjs
scripts/homolog/finance/phase3-preview.mjs
scripts/homolog/finance/phase3-seed.mjs
scripts/homolog/finance/phase3-validate.mjs
src/components/CommercialContractPreview.jsx
src/components/CommercialEngineAdmin.jsx
src/services/commercialService.js
src/services/commercialService.test.js
src/utils/commercial.js
src/utils/commercial.test.js
supabase/migrations/20261130000001_commercial_engine.sql
supabase/tests/commercial_engine_performance.sql
supabase/tests/commercial_engine_test.sql
```

Nenhum arquivo versionado removido. Preservados todos os consumidores financeiros e editoriais existentes; somente um probe temporário não versionado foi eliminado.
