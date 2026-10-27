-- Phase 2. Single quantity checkout; no activation or production prices seeded.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.evocash_pricing_state add column checkout_enabled boolean not null default false;
alter table public.cash_purchases
  alter column package_id drop not null,
  alter column package_label drop not null,
  add column quote_id uuid unique references public.evocash_purchase_quotes(id),
  add column price_version_id uuid references public.evocash_price_versions(id),
  add column unit_price_centavos bigint;
alter table public.cash_purchases add constraint cash_purchase_quote_shape check (
  (quote_id is null and price_version_id is null and unit_price_centavos is null and package_id is not null and package_label is not null)
  or (quote_id is not null and price_version_id is not null and unit_price_centavos is not null and unit_price_centavos>0 and package_id is null and package_label is null
    and payment_provider='infinitepay' and cash_amount*unit_price_centavos=amount_centavos)
);

create function private.protect_cash_purchase_snapshot() returns trigger
language plpgsql set search_path='' as $$
declare q public.evocash_purchase_quotes;
begin
  if tg_op='UPDATE' then
    if (new.quote_id,new.price_version_id,new.unit_price_centavos,new.cash_amount,new.amount_centavos,new.currency,new.request_id,new.package_id,new.package_label,new.payment_provider,new.provider_order_nsu)
      is distinct from (old.quote_id,old.price_version_id,old.unit_price_centavos,old.cash_amount,old.amount_centavos,old.currency,old.request_id,old.package_id,old.package_label,old.payment_provider,old.provider_order_nsu)
      then raise exception 'PURCHASE_SNAPSHOT_IMMUTABLE' using errcode='42501'; end if;
  elsif new.quote_id is not null then
    select * into q from public.evocash_purchase_quotes where id=new.quote_id;
    if not found or (new.user_id,new.price_version_id,new.cash_amount,new.unit_price_centavos,new.amount_centavos,new.currency)
      is distinct from (q.user_id,q.price_version_id,q.quantity::numeric,q.unit_price_centavos,q.total_centavos::integer,'BRL'::text) then
      raise exception 'INVALID_PURCHASE_SNAPSHOT';
    end if;
  end if;
  return new;
end $$;
create trigger cash_purchase_protect_snapshot before insert or update on public.cash_purchases
for each row execute function private.protect_cash_purchase_snapshot();
revoke all on function private.protect_cash_purchase_snapshot() from public,anon,authenticated,service_role;

-- Remove the only package reservation after callers have moved to quote+request UUID.
-- RESTRICT is intentional: unreviewed SQL dependencies must stop the migration.
drop function public.reserve_infinitepay_cash_purchase(uuid,text);
update public.economy_config set config=config-'cashPackages',updated_at=now() where id;

create function public.get_evocash_purchase_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions;
begin
  if not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into s from public.evocash_pricing_state where id;
  select * into v from public.evocash_price_versions where active_from<=statement_timestamp() order by active_from desc limit 1;
  return jsonb_build_object('enabled',s.quoting_enabled and s.checkout_enabled and v.id is not null,
    'serverTime',statement_timestamp(),'priceVersionId',v.id,'unitPriceCentavos',v.unit_price_centavos::text,
    'minQuantity',v.min_quantity::text,'maxQuantity',v.max_quantity::text,
    'dailyQuantityLimit',v.daily_quantity_limit::text,'totalQuantityLimit',v.total_quantity_limit::text,
    'quoteTtlSeconds',v.quote_ttl_seconds::text);
end $$;

create function private.cash_checkout_reservation(p public.cash_purchases,p_create boolean default false) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object('id',p.id,'quoteId',p.quote_id,'orderNsu',p.provider_order_nsu,
  'amountCentavos',p.amount_centavos::text,'cashAmount',p.cash_amount::text,'status',p.status,
  'checkoutUrl',p.checkout_url,'checkoutValidUntil',p.checkout_valid_until,'createLink',p_create,'uncertain',p.checkout_uncertain)
$$;
revoke all on function private.cash_checkout_reservation(public.cash_purchases,boolean) from public,anon,authenticated,service_role;

create function public.reserve_infinitepay_cash_purchase(p_quote_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  s public.evocash_pricing_state; q public.evocash_purchase_quotes; v public.evocash_price_versions;
  p public.cash_purchases; v_now timestamptz; daily numeric; total numeric; days integer;
begin
  if auth.uid() is null or not coalesce(public.has_app_access(),false) then raise exception 'APP_ACCESS_DENIED' using errcode='42501'; end if;
  if p_quote_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
  -- Serialize pause, quote publication and per-user limit reservation in this order.
  select * into s from public.evocash_pricing_state where id for share;
  perform pg_catalog.pg_advisory_xact_lock(82101,pg_catalog.hashtext(auth.uid()::text));
  perform 1 from public.users where id=auth.uid() and account_status='active' for no key update;
  if not found or not coalesce(public.has_app_access(),false) then raise exception 'APP_ACCESS_DENIED' using errcode='42501'; end if;
  v_now := clock_timestamp();
  select * into p from public.cash_purchases where user_id=auth.uid() and request_id=p_request_id::text for update;
  if found then
    if p.quote_id is distinct from p_quote_id then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if p.status<>'pending' then raise exception 'PURCHASE_ALREADY_FINAL'; end if;
    if p.checkout_valid_until<=v_now then raise exception 'CHECKOUT_EXPIRED'; end if;
    if p.checkout_url is not null then return private.cash_checkout_reservation(p); end if;
    if p.checkout_uncertain then return private.cash_checkout_reservation(p); end if;
    if p.checkout_lease_until is null then
      update public.cash_purchases set checkout_lease_until=v_now+interval '1 minute' where id=p.id returning * into p;
      return private.cash_checkout_reservation(p,true);
    end if;
    -- An abandoned lease may have called the provider: never issue a second link.
    if p.checkout_lease_until<=v_now then
      update public.cash_purchases set checkout_uncertain=true,checkout_lease_until=null where id=p.id returning * into p;
    end if;
    return private.cash_checkout_reservation(p);
  end if;
  if not s.quoting_enabled or not s.checkout_enabled then raise exception 'EVOCASH_PURCHASES_PAUSED'; end if;
  select * into q from public.evocash_purchase_quotes where id=p_quote_id and user_id=auth.uid();
  if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
  if q.expires_at<=v_now then raise exception 'QUOTE_EXPIRED'; end if;
  if exists(select 1 from public.cash_purchases where quote_id=q.id) then raise exception 'QUOTE_ALREADY_RESERVED'; end if;
  if exists(select 1 from public.cash_purchases where user_id=auth.uid() and status='pending') then raise exception 'PENDING_CASH_PURCHASE_EXISTS'; end if;
  if (select count(*) from public.cash_purchases where user_id=auth.uid() and created_at>v_now-interval '1 minute')>=5 then raise exception 'CHECKOUT_RATE_LIMIT'; end if;
  select * into v from public.evocash_price_versions where id=q.price_version_id;
  if not found or q.quantity not between v.min_quantity and v.max_quantity
    or q.total_centavos<>q.quantity*v.unit_price_centavos or q.unit_price_centavos<>v.unit_price_centavos then raise exception 'INVALID_PURCHASE_SNAPSHOT'; end if;
  -- Keep cancelled/uncertain links reserved while the provider may still accept payment.
  select coalesce(sum(cash_amount) filter(where created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(cash_amount),0)
    into daily,total from public.cash_purchases where user_id=auth.uid()
      and (status in ('credited','held_in_case','needs_review') or checkout_uncertain
        or (status in ('pending','cancelled') and checkout_valid_until>v_now));
  if daily+q.quantity>v.daily_quantity_limit or total+q.quantity>v.total_quantity_limit then raise exception 'PURCHASE_LIMIT_REACHED'; end if;
  -- Also respect stricter limits published since this quote, without repricing it.
  select * into v from public.evocash_price_versions where active_from<=v_now order by active_from desc limit 1;
  if q.quantity not between v.min_quantity and v.max_quantity or daily+q.quantity>v.daily_quantity_limit or total+q.quantity>v.total_quantity_limit then raise exception 'PURCHASE_LIMIT_REACHED'; end if;
  select (config#>>'{cashPurchases,pendingExpiryDays}')::integer into days from public.economy_config where id;
  if days is null or days not between 1 and 90 then days:=7; end if;
  insert into public.cash_purchases(user_id,request_id,quote_id,price_version_id,unit_price_centavos,
    cash_amount,amount_centavos,currency,status,payment_provider,provider_order_nsu,checkout_lease_until,checkout_valid_until)
  values(auth.uid(),p_request_id::text,q.id,q.price_version_id,q.unit_price_centavos,q.quantity,q.total_centavos::integer,'BRL','pending','infinitepay',
    'evo_'||replace(gen_random_uuid()::text,'-',''),v_now+interval '1 minute',v_now+make_interval(secs=>days*86400)) returning * into p;
  return private.cash_checkout_reservation(p,true);
end $$;
revoke all on function public.get_evocash_purchase_settings(),public.reserve_infinitepay_cash_purchase(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_evocash_purchase_settings(),public.reserve_infinitepay_cash_purchase(uuid,uuid) to authenticated;

-- Persisted checkout URLs must match the same allowlist enforced by the Edge.
create or replace function public.finish_infinitepay_checkout(p_purchase_id uuid,p_checkout_url text) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin
  if p_checkout_url is null or length(p_checkout_url)>2048
    or p_checkout_url !~ '^https://checkout[.]infinitepay[.](io|com[.]br)/[^[:space:]]*$' then raise exception 'INVALID_CHECKOUT_URL'; end if;
  update public.cash_purchases set checkout_url=p_checkout_url,checkout_lease_until=null
    where id=p_purchase_id and payment_provider='infinitepay' and status='pending' and checkout_url is null;
  if not found then raise exception 'PURCHASE_NOT_PENDING'; end if;
end $$;
revoke all on function public.finish_infinitepay_checkout(uuid,text) from public,anon,authenticated;
grant execute on function public.finish_infinitepay_checkout(uuid,text) to service_role;
