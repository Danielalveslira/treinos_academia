-- InfinitePay joins the existing purchase, wallet and ledger lifecycle. Historical
-- Mercado Pago rows retain their identifiers and reconciliation functions.
alter table public.cash_purchases
  add column payment_provider text not null default 'mercadopago'
    check (payment_provider in ('mercadopago', 'infinitepay')),
  add column provider_order_nsu text,
  add column provider_transaction_nsu text,
  add column provider_invoice_slug text,
  add column provider_capture_method text
    check (provider_capture_method is null or provider_capture_method in ('pix', 'credit_card')),
  add column checkout_url text,
  add column receipt_url text,
  add column checkout_lease_until timestamptz,
  add column checkout_uncertain boolean not null default false;

create unique index cash_purchases_provider_order_idx
  on public.cash_purchases(payment_provider, provider_order_nsu)
  where provider_order_nsu is not null;
create unique index cash_purchases_provider_transaction_idx
  on public.cash_purchases(payment_provider, provider_transaction_nsu)
  where provider_transaction_nsu is not null;
create index cash_purchases_provider_status_idx
  on public.cash_purchases(payment_provider, status, created_at desc);
alter table public.cash_purchases add constraint cash_purchases_infinitepay_identity_check
  check (payment_provider <> 'infinitepay' or (provider_order_nsu is not null and mp_payment_id is null));

-- This is a backend-only reservation. The Edge Function authenticates the caller and
-- checks has_app_access() with the user's JWT before invoking this as service_role.
-- Locking the user serializes two concurrent requests and preserves the one-pending rule.
create or replace function public.reserve_infinitepay_cash_purchase(p_user_id uuid, p_package_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existing public.cash_purchases;
  v_pkg jsonb;
  v_cash numeric;
  v_price integer;
  v_label text;
  v_id uuid;
  v_order text;
begin
  if p_user_id is null or p_package_id is null or length(p_package_id) > 80 then
    raise exception 'INVALID_REQUEST';
  end if;
  perform 1 from public.users where id = p_user_id and account_status <> 'deleting' for update;
  if not found then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
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
    update public.cash_purchases set checkout_lease_until = now() + interval '24 hours'
      where id = v_existing.id;
    return jsonb_build_object('id', v_existing.id, 'orderNsu', v_existing.provider_order_nsu,
      'packageLabel', v_existing.package_label, 'amountCentavos', v_existing.amount_centavos,
      'cashAmount', v_existing.cash_amount, 'status', 'pending', 'replay', true, 'createLink', true);
  end if;

  select config->'cashPackages'->p_package_id into v_pkg from public.economy_config where id;
  if v_pkg is null or coalesce((v_pkg->>'active')::boolean, false) <> true then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;
  v_cash := (v_pkg->>'cashAmount')::numeric;
  v_price := (v_pkg->>'amountCentavos')::integer;
  v_label := v_pkg->>'label';
  if v_cash is null or v_cash <= 0 or v_cash > 1000000 or
     v_price is null or v_price <= 0 or v_price > 10000000 or
     v_label is null or length(v_label) not between 1 and 80 then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;
  v_id := gen_random_uuid();
  v_order := 'evo_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.cash_purchases (
    id, user_id, request_id, package_id, package_label, cash_amount,
    amount_centavos, currency, status, payment_provider, provider_order_nsu, checkout_lease_until
  ) values (
    v_id, p_user_id, 'infinitepay:' || v_order, p_package_id, v_label, v_cash,
    v_price, 'BRL', 'pending', 'infinitepay', v_order, now() + interval '24 hours'
  );
  return jsonb_build_object('id', v_id, 'orderNsu', v_order, 'packageLabel', v_label,
    'amountCentavos', v_price, 'cashAmount', v_cash, 'status', 'pending',
    'replay', false, 'createLink', true);
end;
$$;
revoke all on function public.reserve_infinitepay_cash_purchase(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_infinitepay_cash_purchase(uuid, text) to service_role;

create or replace function public.finish_infinitepay_checkout(p_purchase_id uuid, p_checkout_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_checkout_url is null or length(p_checkout_url) > 2048 then raise exception 'INVALID_CHECKOUT_URL'; end if;
  update public.cash_purchases set checkout_url = p_checkout_url, checkout_lease_until = null
    where id = p_purchase_id and payment_provider = 'infinitepay' and status = 'pending';
  if not found then raise exception 'PURCHASE_NOT_PENDING'; end if;
end;
$$;
revoke all on function public.finish_infinitepay_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_infinitepay_checkout(uuid, text) to service_role;

create or replace function public.release_infinitepay_checkout(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.cash_purchases set checkout_lease_until = null
    where id = p_purchase_id and payment_provider = 'infinitepay' and checkout_url is null;
end;
$$;
revoke all on function public.release_infinitepay_checkout(uuid) from public, anon, authenticated;
grant execute on function public.release_infinitepay_checkout(uuid) to service_role;

-- A request may have reached InfinitePay even when our HTTP response timed out.
-- Freeze automatic link creation until an operator reconciles that order.
create or replace function public.mark_infinitepay_checkout_uncertain(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.cash_purchases set checkout_uncertain = true, checkout_lease_until = null
    where id = p_purchase_id and payment_provider = 'infinitepay' and checkout_url is null;
end;
$$;
revoke all on function public.mark_infinitepay_checkout_uncertain(uuid) from public, anon, authenticated;
grant execute on function public.mark_infinitepay_checkout_uncertain(uuid) to service_role;

-- payment_check has already returned paid=true for this exact order/transaction/slug
-- and amount. The service-role-only RPC repeats the immutable purchase checks under
-- a row lock, then reuses the same wallet/ledger and financial-case operations.
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
  if v_purchase.status <> 'pending' then
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
    receipt_url = p_receipt_url
    where id = v_purchase.id;
  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, null, null, null);
    return jsonb_build_object('credited', false, 'reason', 'held_in_financial_case');
  end if;
  if v_purchase.user_id is null then
    return jsonb_build_object('credited', false, 'reason', 'account_deleted_without_case');
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

-- The existing admin fallback remains available for historical Mercado Pago rows.
-- InfinitePay purchases must pass payment_check and the provider-specific RPC.
create or replace function public.confirm_cash_purchase(p_purchase_id uuid, p_admin_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_admin_note is not null and length(p_admin_note) > 500 then raise exception 'ADMIN_NOTE_TOO_LONG'; end if;
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider = 'infinitepay' then raise exception 'PROVIDER_VERIFICATION_REQUIRED'; end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;
  if v_purchase.cash_amount is null or v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000 or
     v_purchase.amount_centavos is null or v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000 then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;
  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, auth.uid(), null, p_admin_note);
    return jsonb_build_object('id', p_purchase_id, 'status', 'held_in_case');
  end if;
  if v_purchase.user_id is null then raise exception 'PURCHASE_ACCOUNT_DELETED'; end if;
  if public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
    raise exception 'ALREADY_CREDITED';
  end if;
  perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
  perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text,
    'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);
  update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = auth.uid(),
    confirmation_note = p_admin_note where id = p_purchase_id;
  perform public._reactivate_deletion_if_clear(v_purchase.user_id);
  return jsonb_build_object('id', p_purchase_id, 'status', 'credited');
end;
$$;

-- An issued InfinitePay link can still be paid later. Never cancel it through the
-- ordinary admin action without an explicit provider reconciliation procedure.
create or replace function public.cancel_cash_purchase(p_purchase_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider = 'infinitepay' then raise exception 'PROVIDER_RECONCILIATION_REQUIRED'; end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;
  update public.cash_purchases set status = 'cancelled', cancelled_at = now(),
    cancelled_by = auth.uid(), cancel_reason = p_reason where id = p_purchase_id;
  if v_purchase.financial_case_id is not null then
    insert into public.account_financial_case_events (case_id, kind, admin_id, note, cash_amount, purchase_id, mp_payment_id)
    values (v_purchase.financial_case_id, 'purchase_cancelled', auth.uid(), p_reason,
      v_purchase.cash_amount, v_purchase.id, v_purchase.mp_payment_id);
  end if;
  perform public._reactivate_deletion_if_clear(v_purchase.user_id);
  return jsonb_build_object('id', p_purchase_id, 'status', 'cancelled');
end;
$$;
