-- Decisão do titular do produto (04/11/2026): a ativação comercial (sales_enabled/
-- integration_ready em commercial_offerings, quoting_enabled/checkout_enabled em
-- evocash_pricing_state) não basta por si só -- a identificação legal do fornecedor
-- (nome civil, CPF, endereço -- nunca gravados aqui) precisa estar configurada no
-- ambiente antes de qualquer cobrança real. Este é um segundo trava, independente das
-- já existentes, não uma substituição: ambas precisam estar "ligadas" para cobrar.
--
-- O estado "configurado" fica em economy_config.config->'supplierInfo'->>'configured'
-- (reaproveita o mecanismo de configuração já usado por cashPurchases/financialControls,
-- em vez de criar uma tabela nova para um único booleano). Padrão: false. Só um
-- superadmin autenticado recentemente pode mudar, via admin_set_supplier_info_configured,
-- depois de configurar SUPPLIER_LEGAL_NAME/SUPPLIER_CPF/SUPPLIER_ADDRESS na hospedagem.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

update public.economy_config
  set config = config || jsonb_build_object('supplierInfo',
    coalesce(config -> 'supplierInfo', '{}'::jsonb) || jsonb_build_object('configured', false)),
      updated_at = clock_timestamp()
where id;

create function private.supplier_info_configured() returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_configured boolean;
begin
  select (config -> 'supplierInfo' ->> 'configured')::boolean into v_configured
  from public.economy_config where id for share;
  return coalesce(v_configured, false);
end
$$;
revoke all on function private.supplier_info_configured() from public, anon, authenticated, service_role;

create function public.admin_set_supplier_info_configured(p_configured boolean, p_reason text, p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_configured boolean;
begin
  perform private.require_evocash_admin(true);
  if p_confirm is distinct from true or p_configured is null or p_reason is null
     or length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'INVALID_SUPPLIER_INFO_REQUEST';
  end if;
  update public.economy_config
    set config = config || jsonb_build_object('supplierInfo',
      coalesce(config -> 'supplierInfo', '{}'::jsonb) || jsonb_build_object('configured', p_configured)),
        updated_at = clock_timestamp()
  where id
  returning (config -> 'supplierInfo' ->> 'configured')::boolean into v_configured;
  if v_configured is null then raise exception 'SUPPLIER_INFO_CONFIG_MISSING'; end if;
  insert into public.admin_audit_log(admin_user_id, action, reason, metadata)
  values(auth.uid(), 'supplier_info_gate_changed', btrim(p_reason),
    jsonb_build_object('configured', v_configured));
  return jsonb_build_object('configured', v_configured);
end $$;

-- A disponibilidade exibida ao usuário e a criação de cotação de EvoCash também
-- obedecem à trava. A reserva do checkout continua sendo a checagem autoritativa.
create or replace function public.get_evocash_purchase_settings() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions; supplier_ready boolean;
begin
  if not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into s from public.evocash_pricing_state where id;
  select * into v from public.evocash_price_versions where active_from<=statement_timestamp() order by active_from desc limit 1;
  select coalesce((config -> 'supplierInfo' ->> 'configured')::boolean,false) into supplier_ready
    from public.economy_config where id;
  return jsonb_build_object('enabled',s.quoting_enabled and s.checkout_enabled and v.id is not null and coalesce(supplier_ready,false),
    'serverTime',statement_timestamp(),'priceVersionId',v.id,'unitPriceCentavos',v.unit_price_centavos::text,
    'minQuantity',v.min_quantity::text,'maxQuantity',v.max_quantity::text,
    'dailyQuantityLimit',v.daily_quantity_limit::text,'totalQuantityLimit',v.total_quantity_limit::text,
    'quoteTtlSeconds',v.quote_ttl_seconds::text);
end $$;

create or replace function public.create_evocash_purchase_quote(p_quantity text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions; q public.evocash_purchase_quotes; v_now timestamptz; daily numeric; total numeric;
begin
  if auth.uid() is null or not coalesce(public.has_app_access(),false)
    or not exists(select 1 from public.users where id=auth.uid() and account_status='active') then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if p_request_id is null or p_quantity is null or p_quantity !~ '^[1-9][0-9]{0,9}$' then raise exception 'INVALID_QUANTITY'; end if;
  select * into s from public.evocash_pricing_state where id for share;
  perform pg_catalog.pg_advisory_xact_lock(82101,pg_catalog.hashtext(auth.uid()::text));
  v_now := clock_timestamp();
  if not coalesce(public.has_app_access(),false) or not exists(select 1 from public.users where id=auth.uid() and account_status='active') then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  select * into q from public.evocash_purchase_quotes where user_id=auth.uid() and request_id=p_request_id;
  if found then
    if q.quantity<>p_quantity::bigint then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    if q.expires_at<=v_now then raise exception 'QUOTE_EXPIRED'; end if;
    return private.evocash_quote_json(q);
  end if;
  if not s.quoting_enabled then raise exception 'EVOCASH_QUOTES_PAUSED'; end if;
  if not private.supplier_info_configured() then raise exception 'SUPPLIER_INFO_NOT_CONFIGURED'; end if;
  select * into v from public.evocash_price_versions where active_from<=v_now order by active_from desc limit 1;
  if not found then raise exception 'EVOCASH_PRICE_UNAVAILABLE'; end if;
  if p_quantity::bigint not between v.min_quantity and v.max_quantity then raise exception 'INVALID_QUANTITY'; end if;
  if (select count(*) from public.evocash_purchase_quotes where user_id=auth.uid() and created_at>v_now-interval '1 minute')>=10 then raise exception 'QUOTE_RATE_LIMIT'; end if;
  select coalesce(sum(cash_amount) filter(where created_at >= date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(cash_amount),0)
    into daily,total from public.cash_purchases where user_id=auth.uid() and status in ('pending','credited','held_in_case','needs_review');
  if daily+p_quantity::bigint>v.daily_quantity_limit or total+p_quantity::bigint>v.total_quantity_limit then raise exception 'PURCHASE_LIMIT_REACHED'; end if;
  insert into public.evocash_purchase_quotes(user_id,request_id,quantity,unit_price_centavos,total_centavos,price_version_id,created_at,expires_at)
    values(auth.uid(),p_request_id,p_quantity::bigint,v.unit_price_centavos,p_quantity::bigint*v.unit_price_centavos,v.id,v_now,v_now+make_interval(secs=>v.quote_ttl_seconds)) returning * into q;
  return private.evocash_quote_json(q);
end $$;
revoke all on function public.admin_set_supplier_info_configured(boolean, text, boolean) from public, anon, service_role;
grant execute on function public.admin_set_supplier_info_configured(boolean, text, boolean) to authenticated;

-- A partir daqui: mesma assinatura e corpo originais de cada função, só com a nova
-- checagem inserida logo junto da checagem de pausa já existente (mesmo ponto, mesmo
-- escopo -- nenhum caminho gratuito/não comercial é tocado).

create or replace function public.quote_commercial_order(p_resource_id uuid,p_duration_days text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; f public.commercial_offerings; v public.commercial_price_versions; o public.commercial_orders; t timestamptz;
begin
 perform private.require_commercial_user();
 if p_resource_id is null or p_request_id is null or p_duration_days is null or p_duration_days !~ '^[1-9][0-9]{0,3}$' then raise exception 'INVALID_DURATION'; end if;
 -- Lock order for all user operations: user -> offering -> resource -> order -> wallet.
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
 if not private.supplier_info_configured() then raise exception 'SUPPLIER_INFO_NOT_CONFIGURED'; end if;
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
 -- Replay never changes financial/editorial state, including after expiry or suspension.
 if o.status<>'quoted' then return private.commercial_order_json(o); end if;
 t:=clock_timestamp();
 if o.quote_expires_at<=t then raise exception 'QUOTE_EXPIRED'; end if;
 if not f.integration_ready or not f.sales_enabled then raise exception 'COMMERCIAL_SALES_PAUSED'; end if;
 if not private.supplier_info_configured() then raise exception 'SUPPLIER_INFO_NOT_CONFIGURED'; end if;
 if r.owner_user_id is distinct from auth.uid() or r.moderation_state<>'approved' or r.approved_revision is distinct from r.content_revision
 or r.content_revision<>o.content_revision then raise exception 'RESOURCE_NOT_ELIGIBLE'; end if;
 select * into e from public.visibility_entitlements where resource_id=r.id for update;
 if found and e.administrative_state<>'enabled' then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 start_at:=greatest(coalesce(e.expires_at,t),t);
 -- Existing primitive recovers reversal debt and locks the one existing wallet.
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
  -- Serialize pause, quote publication and per-user limit reservation in this order.
  select * into s from public.evocash_pricing_state where id for share;
  perform pg_catalog.pg_advisory_xact_lock(82101,pg_catalog.hashtext(auth.uid()::text));
  perform 1 from public.users where id=auth.uid() and account_status='active' for no key update;
  if not found or not coalesce(public.has_app_access(),false) then raise exception 'APP_ACCESS_DENIED' using errcode='42501'; end if;
  v_now := clock_timestamp();
  if not private.supplier_info_configured() then raise exception 'SUPPLIER_INFO_NOT_CONFIGURED'; end if;
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
