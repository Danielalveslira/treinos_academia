-- Rollback de 20261212000002_commercial_terms_evidence.sql.
-- Remove apenas a EXIGÊNCIA de aceite no ponto de cobrança e restaura o JSON anterior das
-- cotações. Registro de documentos, snapshots e aceites já gravados são preservados.
-- Vendas continuam governadas pelos gates comerciais existentes (desligados em produção).
set local lock_timeout = '5s';
drop trigger if exists commercial_order_terms_required on public.commercial_orders;
drop trigger if exists cash_purchase_terms_required on public.cash_purchases;

-- Definições de 20261207000002 (sem a chave `terms`).
create or replace function private.commercial_order_json(o public.commercial_orders) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',o.id,'resourceId',o.resource_id,'offeringCode',o.offering_code,'priceVersionId',o.price_version_id,
 'contentRevision',o.content_revision::text,'durationDays',o.duration_days::text,'unitPriceCash',o.unit_price_cash::text,'totalCash',o.total_cash::text,
 'status',o.status,'createdAt',o.created_at,'quoteExpiresAt',o.quote_expires_at,'fulfilledAt',o.fulfilled_at,'periodStart',o.period_start,'periodEnd',o.period_end,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where order_id=o.id))
$$;
create or replace function private.evocash_quote_json(q public.evocash_purchase_quotes) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('quoteId',q.id,'priceVersionId',q.price_version_id,'quantity',q.quantity::text,
 'unitPriceCentavos',q.unit_price_centavos::text,'totalCentavos',q.total_centavos::text,
 'currency','BRL','createdAt',q.created_at,'expiresAt',q.expires_at,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where cash_quote_id=q.id))
$$;
revoke all on function private.commercial_order_json(public.commercial_orders), private.evocash_quote_json(public.evocash_purchase_quotes)
  from public, anon, authenticated, service_role;
