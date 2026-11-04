-- Rollback de 20261212000007: remove a trava de "informação do fornecedor configurada"
-- e restaura quote_commercial_order/confirm_commercial_order/reserve_infinitepay_cash_purchase
-- ao corpo anterior (idêntico, sem a checagem nova). Não apaga pedidos, cotações, compras
-- ou qualquer evidência financeira/jurídica -- só o botão de trava em si.
-- CUIDADO: depois deste rollback, ativar sales_enabled/integration_ready ou
-- quoting_enabled/checkout_enabled volta a liberar cobrança real sem nenhuma verificação
-- de que a identificação legal do fornecedor foi configurada.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.quote_commercial_order(p_resource_id uuid,p_duration_days text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; f public.commercial_offerings; v public.commercial_price_versions; o public.commercial_orders; t timestamptz;
begin
 perform private.require_commercial_user();
 if p_resource_id is null or p_request_id is null or p_duration_days is null or p_duration_days !~ '^[1-9][0-9]{0,3}$' then raise exception 'INVALID_DURATION'; end if;
 perform 1 from public.users where id=auth.uid() for no key update;
 perform private.require_commercial_user();
 select * into o from public.commercial_orders where payer_user_id=auth.uid() and request_id=p_request_id;
 t:=clock_timestamp();
 if found then
 if o.resource_id<>p_resource_id or o.duration_days<>p_duration_days::integer then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 if o.status='quoted' and o.quote_expires_at<=t then raise exception 'QUOTE_EXPIRED'; end if;
 return private.commercial_order_json(o); end if;
 select * into r from private.commercial_resources where id=p_resource_id and owner_user_id=auth.uid();
 if not found then raise exception 'RESOURCE_NOT_ELIGIBLE'; end if;
 select * into f from public.commercial_offerings where code=r.offering_code for share;
 select * into r from private.commercial_resources where id=p_resource_id for update;
 if not f.integration_ready or not f.sales_enabled then raise exception 'COMMERCIAL_SALES_PAUSED'; end if;
 if r.owner_user_id is distinct from auth.uid() or r.moderation_state<>'approved' or r.approved_revision is distinct from r.content_revision then raise exception 'RESOURCE_NOT_ELIGIBLE'; end if;
 if exists(select 1 from public.visibility_entitlements where resource_id=r.id and administrative_state<>'enabled') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 t:=clock_timestamp();
 select * into v from public.commercial_price_versions where offering_code=f.code and active_from<=t order by active_from desc limit 1;
 if not found then raise exception 'COMMERCIAL_PRICE_UNAVAILABLE'; end if;
 if p_duration_days::integer not between v.min_days and v.max_days then raise exception 'INVALID_DURATION'; end if;
 if (select count(*) from public.commercial_orders where payer_user_id=auth.uid() and created_at>t-interval '1 minute')>=10 then raise exception 'COMMERCIAL_RATE_LIMIT'; end if;
 insert into public.commercial_orders(payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,created_at,quote_expires_at)
 values(auth.uid(),p_request_id,r.id,f.code,v.id,r.content_revision,p_duration_days::integer,v.unit_price_cash,v.unit_price_cash*p_duration_days::integer,t,t+interval '5 minutes') returning * into o;
 insert into public.commercial_order_events(offering_code,order_id,actor_user_id,action,reason) values(f.code,o.id,auth.uid(),'quoted','Cotação solicitada pelo proprietário');
 return private.commercial_order_json(o);
end $$;

create or replace function public.confirm_commercial_order(p_order_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare o public.commercial_orders; r private.commercial_resources; f public.commercial_offerings; e public.visibility_entitlements; t timestamptz; start_at timestamptz;
begin
 perform private.require_commercial_user();
 if p_confirm is distinct from true then raise exception 'CONFIRMATION_REQUIRED'; end if;
 perform 1 from public.users where id=auth.uid() for no key update;
 perform private.require_commercial_user();
 select * into o from public.commercial_orders where id=p_order_id and payer_user_id=auth.uid();
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 select * into f from public.commercial_offerings where code=o.offering_code for share;
 select * into r from private.commercial_resources where id=o.resource_id for update;
 select * into o from public.commercial_orders where id=p_order_id for update;
 if o.status<>'quoted' then return private.commercial_order_json(o); end if;
 t:=clock_timestamp();
 if o.quote_expires_at<=t then raise exception 'QUOTE_EXPIRED'; end if;
 if not f.integration_ready or not f.sales_enabled then raise exception 'COMMERCIAL_SALES_PAUSED'; end if;
 if r.owner_user_id is distinct from auth.uid() or r.moderation_state<>'approved' or r.approved_revision is distinct from r.content_revision
 or r.content_revision<>o.content_revision then raise exception 'RESOURCE_NOT_ELIGIBLE'; end if;
 select * into e from public.visibility_entitlements where resource_id=r.id for update;
 if found and e.administrative_state<>'enabled' then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 start_at:=greatest(coalesce(e.expires_at,t),t);
 perform public._wallet_debit_cash(auth.uid(),o.total_cash);
 perform public._ledger_record(auth.uid(),'commercial:'||o.id,'cash','debit',o.total_cash,'commercial_service','commercial_order',o.id::text);
 update public.commercial_orders set status='fulfilled',fulfilled_at=t,period_start=start_at,period_end=start_at+o.duration_days*interval '24 hours' where id=o.id returning * into o;
 if e.id is null then
 insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at) values(r.id,o.id,t,o.period_end) returning * into e;
 else
 update public.visibility_entitlements set starts_at=case when expires_at<=t then t else starts_at end,expires_at=o.period_end,revision=revision+1 where id=e.id returning * into e;
 end if;
 insert into public.commercial_order_events(offering_code,order_id,entitlement_id,actor_user_id,action,reason,payload)
 values(f.code,o.id,e.id,auth.uid(),case when e.origin_order_id=o.id then 'fulfilled' else 'renewed' end,'Contratação confirmada explicitamente',jsonb_build_object('periodStart',o.period_start,'periodEnd',o.period_end,'totalCash',o.total_cash::text));
 return private.commercial_order_json(o);
end $$;

create or replace function public.reserve_infinitepay_cash_purchase(p_quote_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  s public.evocash_pricing_state; q public.evocash_purchase_quotes; v public.evocash_price_versions;
  p public.cash_purchases; v_now timestamptz; daily numeric; total numeric; days integer;
begin
  if auth.uid() is null or not coalesce(public.has_app_access(),false) then raise exception 'APP_ACCESS_DENIED' using errcode='42501'; end if;
  if p_quote_id is null or p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
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
  select coalesce(sum(cash_amount) filter(where created_at>=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(cash_amount),0)
    into daily,total from public.cash_purchases where user_id=auth.uid()
      and (status in ('credited','held_in_case','needs_review') or checkout_uncertain
        or (status in ('pending','cancelled') and checkout_valid_until>v_now));
  if daily+q.quantity>v.daily_quantity_limit or total+q.quantity>v.total_quantity_limit then raise exception 'PURCHASE_LIMIT_REACHED'; end if;
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

drop function if exists public.admin_set_supplier_info_configured(boolean, text, boolean);
drop function if exists private.supplier_info_configured();

update public.economy_config
  set config = config - 'supplierInfo',
      updated_at = clock_timestamp()
where id;
