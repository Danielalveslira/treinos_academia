# Arquivos da entrega

Comparação com a base aprovada da Fase 1 (`d4f0bff`). M = alterado, D = removido; novos listados abaixo.

```text
M	scripts/evocash-pricing-concurrency.mjs
M	scripts/finance-audit-local.py
M	scripts/homolog/finance/http-integration.mjs
M	scripts/homolog/finance/stack.mjs
M	scripts/homolog/finance/wait-ready.mjs
D	src/components/CashPackageCards.jsx
D	src/components/CashPackageCards.test.js
M	src/components/CommunityCreationSteps.test.js
M	src/components/CopyButton.test.js
M	src/components/EvoCashPricing.jsx
M	src/contexts/WalletContext.jsx
M	src/pages/AdminAccountDeletions.jsx
M	src/pages/AdminCashPurchases.jsx
M	src/pages/EconomyGuide.jsx
M	src/pages/EvoCash.jsx
M	src/services/cashPurchaseService.js
D	src/utils/cashPackagePresentation.js
D	src/utils/cashPackagePresentation.test.js
M	src/utils/cashPurchaseFlow.js
M	supabase/functions/_shared/infinitepay.js
M	supabase/functions/infinitepay-admin-reconcile/batch.test.js
M	supabase/functions/infinitepay-create-checkout/core.js
M	supabase/functions/infinitepay-create-checkout/core.test.js
M	supabase/functions/infinitepay-create-checkout/index.ts
M	supabase/functions/infinitepay-webhook/payment.test.js
M	supabase/functions/send-cash-purchase-reminder-emails/messages.js
M	supabase/functions/send-cash-purchase-reminder-emails/messages.test.js
M	supabase/functions/send-cash-purchase-reminder-emails/processor.js
M	supabase/tests/account_deletion_financial_case_test.sql
M	supabase/tests/aud_01_aud_02_security_test.sql
M	supabase/tests/cash_purchase_reminder_emails_test.sql
M	supabase/tests/evocash_pricing_test.sql
M	supabase/tests/finance_payment_finality_test.sql
M	supabase/tests/finance_reminder_session_guard_test.sql
M	supabase/tests/finance_reversals_test.sql
M	supabase/tests/financial_case_cancel_traceability_test.sql
M	supabase/tests/infinitepay_cash_purchases_test.sql
M	supabase/tests/infinitepay_pending_reconciliation_test.sql
M	supabase/tests/security_followup_test.sql
```

Novos arquivos de implementação e documentação:

```text
docs/finance-restructure/phase2/ENTREGA.md
docs/finance-restructure/phase2/PR.md
docs/finance-restructure/phase2/evidence/account_deletion_financial_case_test.log
docs/finance-restructure/phase2/evidence/aud_01_aud_02_security_test.log
docs/finance-restructure/phase2/evidence/browser.json
docs/finance-restructure/phase2/evidence/build.log
docs/finance-restructure/phase2/evidence/cash_purchase_reminder_emails_test.log
docs/finance-restructure/phase2/evidence/concurrency.json
docs/finance-restructure/phase2/evidence/edge-tests.log
docs/finance-restructure/phase2/evidence/evocash_pricing_test.log
docs/finance-restructure/phase2/evidence/finance_integrity_test.log
docs/finance-restructure/phase2/evidence/finance_payment_finality_test.log
docs/finance-restructure/phase2/evidence/finance_reminder_session_guard_test.log
docs/finance-restructure/phase2/evidence/finance_reversals_test.log
docs/finance-restructure/phase2/evidence/financial_case_cancel_traceability_test.log
docs/finance-restructure/phase2/evidence/http-results.json
docs/finance-restructure/phase2/evidence/infinitepay_cash_purchases_test.log
docs/finance-restructure/phase2/evidence/infinitepay_pending_reconciliation_test.log
docs/finance-restructure/phase2/evidence/lint.log
docs/finance-restructure/phase2/evidence/migration-install.log
docs/finance-restructure/phase2/evidence/security_followup_test.log
docs/finance-restructure/phase2/evidence/sql-summary.json
docs/finance-restructure/phase2/evidence/ui-shared-tests.log
scripts/homolog/finance/quantity-preview.mjs
src/components/EvoCashQuantityPurchase.jsx
src/utils/quantityPurchase.js
src/utils/quantityPurchase.test.js
supabase/migrations/20261129000001_evocash_quantity_checkout.sql
supabase/tests/_helpers/cash_purchase.sql
```

As evidências e este manifesto também integram a entrega. Capturas PNG permanecem locais e ignoradas.
