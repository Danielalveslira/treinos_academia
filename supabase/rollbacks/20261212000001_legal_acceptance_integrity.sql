-- Rollback de 20261212000001_legal_acceptance_integrity.sql.
-- Desliga somente as exigências novas, preservando TODA evidência registrada (aceites,
-- textos e eventos de consentimento continuam no banco). Não restaura a versão antiga de
-- accept_legal_documents de propósito: ela gravava conteúdo jurídico vindo do cliente. A
-- versão nova é compatível com o frontend anterior (campos extras são ignorados).
set local lock_timeout = '5s';
drop trigger if exists body_measurements_require_health_consent on public.body_measurements;
drop trigger if exists evocash_quotes_block_minor on public.evocash_purchase_quotes;
drop trigger if exists cash_purchases_block_minor on public.cash_purchases;
drop trigger if exists commercial_orders_block_minor on public.commercial_orders;
drop trigger if exists promotions_block_minor on public.promotions;
-- legal_versions_guard, RLS de minutas e tabelas de consentimento permanecem: removê-los
-- reabriria a reescrita silenciosa de histórico jurídico.
