alter table public.cash_purchases add column checkout_valid_until timestamptz;
-- Preserve verified payment identity, including review/refund finality.
create or replace function public.admin_resolve_cash_purchase_review(
  p_purchase_id uuid, p_resolution text, p_note text
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_resolution is null or p_resolution not in ('credit', 'refund_externally') then raise exception 'INVALID_RESOLUTION'; end if;
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
    if v_purchase.provider_transaction_nsu is null or v_purchase.provider_invoice_slug is null then raise exception 'PAYMENT_NOT_VERIFIED'; end if;
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
  if v_purchase.review_resolution = 'refunded_externally' then
    return jsonb_build_object('credited', false, 'reason', 'refunded_externally', 'status', 'cancelled');
  end if;
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
create or replace function public.reserve_infinitepay_cash_purchase(p_user_id uuid, p_package_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.cash_purchases;
  v_failed public.cash_purchases;
  v_pkg jsonb;
  v_cash numeric;
  v_price integer;
  v_label text;
  v_id uuid;
  v_order text;
  v_days integer;
  v_valid_until timestamptz;
begin
  if p_user_id is null or p_package_id is null or length(p_package_id) > 80 then
    raise exception 'INVALID_REQUEST';
  end if;
  perform 1 from public.users where id = p_user_id and account_status <> 'deleting' for update;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  if not private.user_app_access(p_user_id) then raise exception 'APP_ACCESS_DENIED'; end if;
  select * into v_existing from public.cash_purchases
    where user_id = p_user_id and status = 'pending' for update;
  if v_existing.id is not null then
    if v_existing.payment_provider <> 'infinitepay' or v_existing.package_id <> p_package_id then
      raise exception 'PENDING_CASH_PURCHASE_EXISTS';
    end if;
    if v_existing.checkout_url is not null then
      return jsonb_build_object('id', v_existing.id, 'checkoutUrl', v_existing.checkout_url,
        'status', v_existing.status, 'replay', true, 'createLink', false);
    end if;
    if v_existing.checkout_uncertain then raise exception 'CHECKOUT_RECONCILIATION_REQUIRED'; end if;
    if v_existing.checkout_lease_until > now() then
      return jsonb_build_object('id', v_existing.id, 'status', 'pending', 'replay', true,
        'createLink', false, 'inProgress', true);
    end if;
    -- The previous request may have reached the provider before the worker died.
    update public.cash_purchases set checkout_uncertain = true, checkout_lease_until = null
      where id = v_existing.id;
    return jsonb_build_object('id', v_existing.id, 'status', 'pending',
      'replay', true, 'createLink', false, 'uncertain', true);
  end if;

  select config->'cashPackages'->p_package_id into v_pkg from public.economy_config where id;
  if v_pkg is null or coalesce((v_pkg->>'active')::boolean, false) <> true then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;
  v_cash := (v_pkg->>'cashAmount')::numeric;
  if coalesce(v_pkg->>'amountCentavos','') !~ '^[0-9]{1,8}$' then raise exception 'CASH_PACKAGE_UNAVAILABLE'; end if;
  v_price := (v_pkg->>'amountCentavos')::integer;
  v_label := v_pkg->>'label';
  if v_cash is null or v_cash <= 0 or v_cash > 1000000 or v_cash <> trunc(v_cash) or v_cash::text = 'NaN' or
     v_price is null or v_price <= 0 or v_price > 10000000 or
     v_label is null or length(v_label) not between 1 and 80 then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;

  select (config->'cashPurchases'->>'pendingExpiryDays')::integer into v_days from public.economy_config where id;
  if v_days is null or v_days <= 0 or v_days > 90 then v_days := 7; end if;
  v_valid_until := now() + make_interval(days => v_days);
  select * into v_failed from public.cash_purchases
    where user_id = p_user_id and payment_provider = 'infinitepay'
      and package_id = p_package_id and status = 'checkout_failed'
    order by created_at desc limit 1 for update;
  if v_failed.id is not null and v_failed.amount_centavos = v_price and
     v_failed.cash_amount = v_cash and v_failed.package_label = v_label then
    update public.cash_purchases set status = 'pending', checkout_failed_at = null,
      checkout_http_status = null, checkout_valid_until = v_valid_until, checkout_lease_until = now() + interval '24 hours'
      where id = v_failed.id;
    return jsonb_build_object('id', v_failed.id, 'orderNsu', v_failed.provider_order_nsu,
      'packageLabel', v_label, 'amountCentavos', v_price, 'cashAmount', v_cash,
      'status', 'pending', 'replay', true, 'createLink', true, 'checkoutValidUntil', v_valid_until);
  end if;

  v_id := gen_random_uuid();
  v_order := 'evo_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.cash_purchases (
    id, user_id, request_id, package_id, package_label, cash_amount,
    amount_centavos, currency, status, payment_provider, provider_order_nsu, checkout_lease_until, checkout_valid_until
  ) values (
    v_id, p_user_id, 'infinitepay:' || v_order, p_package_id, v_label, v_cash,
    v_price, 'BRL', 'pending', 'infinitepay', v_order, now() + interval '24 hours', v_valid_until
  );
  return jsonb_build_object('id', v_id, 'orderNsu', v_order, 'packageLabel', v_label,
    'amountCentavos', v_price, 'cashAmount', v_cash, 'status', 'pending',
    'replay', false, 'createLink', true, 'checkoutValidUntil', v_valid_until);
end;
$$;

-- Shared durable per-order provider-call budget. Unknown orders never call provider.
alter table public.cash_purchases add column payment_check_after timestamptz;
create or replace function public.claim_infinitepay_payment_check(p_purchase_id uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
 update public.cash_purchases set payment_check_after = clock_timestamp() + interval '30 seconds'
 where id = p_purchase_id and payment_provider = 'infinitepay'
   and status in ('pending','cancelled','credited','held_in_case','needs_review','checkout_failed')
   and (payment_check_after is null or payment_check_after <= clock_timestamp());
 return found;
end;
$$;
revoke all on function public.claim_infinitepay_payment_check(uuid) from public, anon, authenticated;
grant execute on function public.claim_infinitepay_payment_check(uuid) to service_role;
