-- A provider rejection is a failed checkout, not a payment awaiting confirmation.
-- An ambiguous network/5xx result stays pending for financial reconciliation.
alter table public.cash_purchases drop constraint cash_purchases_status_check;
alter table public.cash_purchases add constraint cash_purchases_status_check
  check (status in ('pending', 'credited', 'cancelled', 'held_in_case', 'checkout_failed'));
alter table public.cash_purchases
  add column checkout_failed_at timestamptz,
  add column checkout_http_status integer
    check (checkout_http_status is null or checkout_http_status between 100 and 599);

create or replace function public.fail_infinitepay_checkout(p_purchase_id uuid, p_http_status integer)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_http_status not between 400 and 499 then raise exception 'INVALID_PROVIDER_STATUS'; end if;
  update public.cash_purchases set status = 'checkout_failed', checkout_failed_at = now(),
    checkout_http_status = p_http_status, checkout_lease_until = null, checkout_uncertain = false
    where id = p_purchase_id and payment_provider = 'infinitepay'
      and status = 'pending' and checkout_url is null;
  if not found then raise exception 'PURCHASE_NOT_PENDING'; end if;
end;
$$;
revoke all on function public.fail_infinitepay_checkout(uuid, integer) from public, anon, authenticated;
grant execute on function public.fail_infinitepay_checkout(uuid, integer) to service_role;

create or replace function public.finish_infinitepay_checkout(p_purchase_id uuid, p_checkout_url text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if p_checkout_url is null or length(p_checkout_url) > 2048 then raise exception 'INVALID_CHECKOUT_URL'; end if;
  update public.cash_purchases set checkout_url = p_checkout_url, checkout_lease_until = null,
    checkout_uncertain = false, checkout_failed_at = null, checkout_http_status = null
    where id = p_purchase_id and payment_provider = 'infinitepay' and status = 'pending';
  if not found then raise exception 'PURCHASE_NOT_PENDING'; end if;
end;
$$;
revoke all on function public.finish_infinitepay_checkout(uuid, text) from public, anon, authenticated;
grant execute on function public.finish_infinitepay_checkout(uuid, text) to service_role;

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
  v_price := (v_pkg->>'amountCentavos')::integer;
  v_label := v_pkg->>'label';
  if v_cash is null or v_cash <= 0 or v_cash > 1000000 or
     v_price is null or v_price <= 0 or v_price > 10000000 or
     v_label is null or length(v_label) not between 1 and 80 then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;

  select * into v_failed from public.cash_purchases
    where user_id = p_user_id and payment_provider = 'infinitepay'
      and package_id = p_package_id and status = 'checkout_failed'
    order by created_at desc limit 1 for update;
  if v_failed.id is not null and v_failed.amount_centavos = v_price and
     v_failed.cash_amount = v_cash and v_failed.package_label = v_label then
    update public.cash_purchases set status = 'pending', checkout_failed_at = null,
      checkout_http_status = null, checkout_lease_until = now() + interval '24 hours'
      where id = v_failed.id;
    return jsonb_build_object('id', v_failed.id, 'orderNsu', v_failed.provider_order_nsu,
      'packageLabel', v_label, 'amountCentavos', v_price, 'cashAmount', v_cash,
      'status', 'pending', 'replay', true, 'createLink', true);
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
