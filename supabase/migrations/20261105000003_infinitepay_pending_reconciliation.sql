-- Root cause of InfinitePay purchases stuck 'pending' forever (admin report: protocols
-- 1b0c541b-50b1-4847-971a-f8d74f179abf and 70b8d640-617d-4319-a6b5-0f4e7562bcb9, both for
-- accounts later disabled): three independent gaps with the same symptom.
--
-- 1) AccountBlockedGate blocks a disabled account from ever reaching /evocash again, so it
--    can never trigger infinitepay-check-payment nor cancel_my_cash_purchase.
-- 2) The only admin fallback (confirm_cash_purchase/cancel_cash_purchase) never actually
--    supported InfinitePay -- 20261015000001 made both raise PROVIDER_VERIFICATION_REQUIRED/
--    PROVIDER_RECONCILIATION_REQUIRED for payment_provider = 'infinitepay' -- and
--    20261015000005 dropped them outright when Mercado Pago was retired, leaving no
--    operator-triggered path at all.
-- 3) No cron job ever reconciles or expires a stale pending purchase.
--
-- Fix:
-- a) admin_cancel_infinitepay_cash_purchase restores an admin-authorized cancellation that
--    actually works for InfinitePay. Cancelling never credits anything, and a late provider
--    confirmation still settles correctly afterwards (confirm_infinitepay_cash_purchase
--    already accepts 'cancelled' as a startable state and records paid_after_cancel_at) --
--    so this is safe to use without first proving the order was never paid.
-- b) private.expire_stale_infinitepay_purchases, run daily, applies that same safe
--    cancellation automatically once a purchase has been pending for longer than
--    economy_config.config->'cashPurchases'->>'pendingExpiryDays' (default 7) -- independent
--    of account status, so this never recurs for anyone.
-- c) confirm_infinitepay_cash_purchase gains a guard: a provider-confirmed payment for a
--    'disabled' account (NOT 'deleting' -- that path keeps its own, untouched,
--    financial-case machinery) is never auto-credited. It is parked as 'needs_review' for a
--    human decision (reembolso/reativação) -- a confirmed payment on an inactive account is
--    never resolved by the system alone. admin_resolve_cash_purchase_review records that
--    decision once an operator makes it.

alter table public.cash_purchases drop constraint cash_purchases_status_check;
alter table public.cash_purchases add constraint cash_purchases_status_check
  check (status in ('pending', 'credited', 'cancelled', 'held_in_case', 'checkout_failed', 'needs_review'));

alter table public.cash_purchases
  add column review_reason text
    check (review_reason is null or review_reason in ('payment_confirmed_inactive_account')),
  add column review_flagged_at timestamptz,
  add column review_resolved_at timestamptz,
  add column review_resolved_by uuid references public.users(id) on delete set null,
  add column review_resolution text
    check (review_resolution is null or review_resolution in ('credited', 'refunded_externally')),
  add column review_resolution_note text
    check (review_resolution_note is null or char_length(review_resolution_note) <= 500);
create index cash_purchases_needs_review_idx on public.cash_purchases(status, review_flagged_at)
  where status = 'needs_review';

-- Default expiry window for part (b); configurable the same way cashPackages already is.
update public.economy_config set config = config || jsonb_build_object(
  'cashPurchases', jsonb_build_object('pendingExpiryDays', 7)
), updated_at = now() where id;

-- Single source of "does this account still owe/is owed something that blocks deletion" --
-- the worker gate and _reactivate_deletion_if_clear both call this one function. A
-- needs_review purchase holds a REAL provider-confirmed payment that was deliberately not
-- credited; deletion must never erase user_id out from under it, same as 'pending'.
create or replace function public._compute_financial_block_reason(p_user_id uuid) returns text
  language plpgsql stable as $$
declare v_payable_purchase boolean; v_cash_balance numeric;
begin
  select exists(select 1 from public.cash_purchases where user_id = p_user_id and
    (status in ('pending', 'needs_review') or (payment_provider = 'infinitepay' and status = 'cancelled' and
      (checkout_url is not null or checkout_uncertain)))) into v_payable_purchase;
  select cash_balance into v_cash_balance from public.wallets where user_id = p_user_id;
  return case when v_payable_purchase then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance' else null end;
end;
$$;

create or replace function public.confirm_infinitepay_cash_purchase(
  p_purchase_id uuid, p_order_nsu text, p_transaction_nsu text,
  p_invoice_slug text, p_amount_centavos integer, p_capture_method text,
  p_receipt_url text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider <> 'infinitepay' or
     v_purchase.provider_order_nsu is distinct from p_order_nsu or
     v_purchase.amount_centavos is distinct from p_amount_centavos or
     v_purchase.currency <> 'BRL' or
     p_transaction_nsu is null or length(p_transaction_nsu) not between 1 and 128 or
     p_invoice_slug is null or length(p_invoice_slug) not between 1 and 128 or
     p_capture_method is null or p_capture_method not in ('pix', 'credit_card') or
     (p_receipt_url is not null and length(p_receipt_url) > 2048) then
    raise exception 'PAYMENT_MISMATCH';
  end if;
  if v_purchase.provider_transaction_nsu is not null and
     v_purchase.provider_transaction_nsu <> p_transaction_nsu then raise exception 'TRANSACTION_MISMATCH'; end if;
  if v_purchase.provider_invoice_slug is not null and
     v_purchase.provider_invoice_slug <> p_invoice_slug then raise exception 'INVOICE_MISMATCH'; end if;
  if v_purchase.status not in ('pending', 'cancelled') then
    return jsonb_build_object('credited', false, 'reason', 'already_' || v_purchase.status);
  end if;
  if v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000 or
     v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000 then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;
  update public.cash_purchases set
    provider_transaction_nsu = p_transaction_nsu,
    provider_invoice_slug = p_invoice_slug,
    provider_capture_method = p_capture_method,
    receipt_url = p_receipt_url,
    paid_after_cancel_at = case when v_purchase.status = 'cancelled' then now() else paid_after_cancel_at end
    where id = v_purchase.id;
  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, null, null, null);
    return jsonb_build_object('credited', false, 'reason', 'held_in_financial_case');
  end if;
  if v_purchase.user_id is null then
    raise exception 'PURCHASE_ACCOUNT_DELETED_WITHOUT_CASE';
  end if;
  -- A confirmed payment on a disabled account is never auto-credited: park it for a human
  -- decision instead. 'deleting' is untouched -- it either blocks deletion (still 'pending'
  -- above the worker gate) or already has financial_case_id set (handled above).
  if (select account_status from public.users where id = v_purchase.user_id) = 'disabled' then
    update public.cash_purchases set status = 'needs_review',
      review_reason = 'payment_confirmed_inactive_account', review_flagged_at = now()
      where id = v_purchase.id;
    return jsonb_build_object('credited', false, 'reason', 'needs_review');
  end if;
  if not public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
    perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
    perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text,
      'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);
  end if;
  update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = null
    where id = v_purchase.id;
  perform public._reactivate_deletion_if_clear(v_purchase.user_id);
  return jsonb_build_object('credited', true, 'status', 'credited');
end;
$$;
revoke all on function public.confirm_infinitepay_cash_purchase(uuid, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_infinitepay_cash_purchase(uuid, text, text, text, integer, text, text)
  to service_role;

-- Restored admin fallback (see note at the top) -- correctly scoped to InfinitePay this
-- time: mirrors cancel_my_cash_purchase instead of raising PROVIDER_RECONCILIATION_REQUIRED.
create or replace function public.admin_cancel_infinitepay_cash_purchase(p_purchase_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;

  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider <> 'infinitepay' then raise exception 'INVALID_PROVIDER'; end if;
  if v_purchase.status = 'cancelled' then
    return jsonb_build_object('id', p_purchase_id, 'status', 'cancelled', 'replay', true);
  end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;

  update public.cash_purchases set status = 'cancelled', cancelled_at = now(),
    cancelled_by = auth.uid(), cancel_reason = p_reason, checkout_lease_until = null,
    checkout_uncertain = checkout_uncertain or checkout_url is null
    where id = p_purchase_id;

  return jsonb_build_object('id', p_purchase_id, 'status', 'cancelled', 'replay', false);
end;
$$;
revoke all on function public.admin_cancel_infinitepay_cash_purchase(uuid, text) from public, anon;
grant execute on function public.admin_cancel_infinitepay_cash_purchase(uuid, text) to authenticated;

-- Records the human decision for a purchase confirm_infinitepay_cash_purchase parked as
-- 'needs_review'. Never moves money on its own beyond the ordinary wallet credit, which
-- only runs when the admin explicitly chooses 'credit' -- same spirit as
-- resolve_account_financial_case, which also only records a decision already made outside
-- the system.
create or replace function public.admin_resolve_cash_purchase_review(
  p_purchase_id uuid, p_resolution text, p_note text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_resolution not in ('credit', 'refund_externally') then raise exception 'INVALID_RESOLUTION'; end if;
  if p_note is null or length(trim(p_note)) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(p_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.review_resolved_at is not null then
    return jsonb_build_object('id', p_purchase_id, 'status', v_purchase.status, 'replay', true);
  end if;
  if v_purchase.status <> 'needs_review' then raise exception 'PURCHASE_NOT_IN_REVIEW'; end if;
  if v_purchase.user_id is null then raise exception 'PURCHASE_ACCOUNT_DELETED_WITHOUT_CASE'; end if;

  if p_resolution = 'credit' then
    if not public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
      perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
      perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text,
        'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);
    end if;
    update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = auth.uid(),
      confirmation_note = p_note, review_resolved_at = now(), review_resolved_by = auth.uid(),
      review_resolution = 'credited', review_resolution_note = p_note
      where id = p_purchase_id;
  else
    update public.cash_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = p_note, review_resolved_at = now(), review_resolved_by = auth.uid(),
      review_resolution = 'refunded_externally', review_resolution_note = p_note
      where id = p_purchase_id;
  end if;
  perform public._reactivate_deletion_if_clear(v_purchase.user_id);
  return jsonb_build_object('id', p_purchase_id,
    'status', case when p_resolution = 'credit' then 'credited' else 'cancelled' end, 'replay', false);
end;
$$;
revoke all on function public.admin_resolve_cash_purchase_review(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_cash_purchase_review(uuid, text, text) to authenticated;

-- Part (b): automatic recurrence prevention, independent of account status. Same safe
-- cancellation as admin_cancel_infinitepay_cash_purchase -- never credits, and a late
-- provider confirmation still settles via paid_after_cancel_at. checkout_lease_until in the
-- future means infinitepay-create-checkout may still be mid-flight; skip those to avoid
-- racing it.
create or replace function private.expire_stale_infinitepay_purchases(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_days integer;
  v_purchase public.cash_purchases;
  v_count integer := 0;
begin
  select (config->'cashPurchases'->>'pendingExpiryDays')::integer into v_days
    from public.economy_config where id;
  if v_days is null or v_days <= 0 or v_days > 90 then v_days := 7; end if;

  for v_purchase in
    select * from public.cash_purchases
    where payment_provider = 'infinitepay' and status = 'pending'
      and created_at < now() - (v_days || ' days')::interval
      and (checkout_lease_until is null or checkout_lease_until <= now())
    order by created_at
    limit least(greatest(p_limit, 1), 500)
    for update skip locked
  loop
    update public.cash_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = null,
      cancel_reason = 'Expirada automaticamente após ' || v_days || ' dias sem confirmação de pagamento.',
      checkout_lease_until = null, checkout_uncertain = checkout_uncertain or checkout_url is null
      where id = v_purchase.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.expire_stale_infinitepay_purchases(integer) from public, anon, authenticated;
grant execute on function private.expire_stale_infinitepay_purchases(integer) to service_role;

select cron.schedule('expire-stale-infinitepay-purchases', '34 4 * * *',
  $$select private.expire_stale_infinitepay_purchases(200)$$);
