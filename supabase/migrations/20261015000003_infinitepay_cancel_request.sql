-- A live InfinitePay checkout link cannot be invalidated by a documented API.
-- Keep the purchase pending so a late verified payment is still settled safely.
alter table public.cash_purchases add column cancel_requested_at timestamptz;

create or replace function public.request_infinitepay_cash_purchase_cancellation(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.user_id is distinct from auth.uid() then
    raise exception 'PURCHASE_NOT_FOUND';
  end if;
  if v_purchase.payment_provider <> 'infinitepay' then raise exception 'INVALID_PROVIDER'; end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;
  if v_purchase.cancel_requested_at is null then
    update public.cash_purchases set cancel_requested_at = now() where id = v_purchase.id;
  end if;
  return jsonb_build_object('id', v_purchase.id, 'status', 'cancel_requested');
end;
$$;
revoke all on function public.request_infinitepay_cash_purchase_cancellation(uuid) from public, anon;
grant execute on function public.request_infinitepay_cash_purchase_cancellation(uuid) to authenticated;
