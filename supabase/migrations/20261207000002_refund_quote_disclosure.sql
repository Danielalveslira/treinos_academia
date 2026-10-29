-- Freeze the exact offered policy at quote creation, so a later policy publication
-- cannot shorten an accepted acquisition's rights. This is a disclosure snapshot,
-- NOT evidence of a legal waiver or fabricated acceptance by an old frontend.
set local lock_timeout='5s';
create table private.refund_quote_terms (
 id uuid primary key default gen_random_uuid(),
 cash_quote_id uuid unique references public.evocash_purchase_quotes(id),
 order_id uuid unique references public.commercial_orders(id),
 check(num_nonnulls(cash_quote_id,order_id)=1),
 policy_snapshot jsonb not null,
 offered_at timestamptz not null default clock_timestamp()
);
revoke all on private.refund_quote_terms from public,anon,authenticated,service_role;
create trigger refund_quote_immutable before update or delete on private.refund_quote_terms for each row execute function private.commercial_immutable();
create function private.capture_refund_quote() returns trigger language plpgsql security definer set search_path='' as $$
declare policy jsonb;
begin
 select to_jsonb(p) into policy from public.refund_policies p join private.refund_settings s on s.policy_version=p.version;
 insert into private.refund_quote_terms(cash_quote_id,order_id,policy_snapshot)
 values(case when tg_table_name='evocash_purchase_quotes' then new.id end,case when tg_table_name='commercial_orders' then new.id end,policy);
 return new;
end $$;
revoke all on function private.capture_refund_quote() from public,anon,authenticated,service_role;
create trigger refund_cash_quote after insert on public.evocash_purchase_quotes for each row execute function private.capture_refund_quote();
create trigger refund_service_quote after insert on public.commercial_orders for each row execute function private.capture_refund_quote();
create or replace function private.evocash_quote_json(q public.evocash_purchase_quotes) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('quoteId',q.id,'priceVersionId',q.price_version_id,'quantity',q.quantity::text,
 'unitPriceCentavos',q.unit_price_centavos::text,'totalCentavos',q.total_centavos::text,
 'currency','BRL','createdAt',q.created_at,'expiresAt',q.expires_at,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where cash_quote_id=q.id))
$$;
create or replace function private.commercial_order_json(o public.commercial_orders) returns jsonb
language sql stable set search_path='' as $$
select jsonb_build_object('id',o.id,'resourceId',o.resource_id,'offeringCode',o.offering_code,'priceVersionId',o.price_version_id,
 'contentRevision',o.content_revision::text,'durationDays',o.duration_days::text,'unitPriceCash',o.unit_price_cash::text,'totalCash',o.total_cash::text,
 'status',o.status,'createdAt',o.created_at,'quoteExpiresAt',o.quote_expires_at,'fulfilledAt',o.fulfilled_at,'periodStart',o.period_start,'periodEnd',o.period_end,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where order_id=o.id))
$$;
create or replace function private.capture_refund_terms() returns trigger
language plpgsql security definer set search_path='' as $$
declare policy jsonb; t timestamptz; offered timestamptz;
begin
 if tg_table_name='cash_purchases' then
  if new.status<>'credited' or (tg_op='UPDATE' and old.status='credited') then return new; end if;
  select policy_snapshot,offered_at into policy,offered from private.refund_quote_terms where cash_quote_id=new.quote_id;
  t:=coalesce(new.credited_at,clock_timestamp());
 else
  if new.status<>'fulfilled' or (tg_op='UPDATE' and old.status='fulfilled') then return new; end if;
  select policy_snapshot,offered_at into policy,offered from private.refund_quote_terms where order_id=new.id;
  t:=new.fulfilled_at;
 end if;
 if policy is null then
  select to_jsonb(p)||'{"disclosureUnverified":true}'::jsonb into policy from public.refund_policies p join private.refund_settings s on s.policy_version=p.version;
 end if;
 insert into public.refund_contract_terms(purchase_id,order_id,policy_version,policy_snapshot,origin_at,origin_kind,deadline_at,presented_at)
 values(case when tg_table_name='cash_purchases' then new.id end,case when tg_table_name='commercial_orders' then new.id end,
 policy->>'version',policy,t,case when tg_table_name='cash_purchases' then 'receipt' else 'contract' end,
 private.refund_deadline(t,(policy->>'days')::integer),coalesce(offered,clock_timestamp())) on conflict do nothing;
 return new;
end $$;
-- Re-assert private access after replacement, preserving existing public API grants.
revoke all on function private.capture_refund_terms(),private.evocash_quote_json(public.evocash_purchase_quotes),private.commercial_order_json(public.commercial_orders) from public,anon,authenticated,service_role;
