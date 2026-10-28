-- Phase 1: price/quote foundation only. No checkout, balance or purchase mutation.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create table public.evocash_price_versions (
  id uuid primary key default gen_random_uuid(),
  revision bigint not null unique check (revision > 0),
  previous_version_id uuid references public.evocash_price_versions(id),
  unit_price_centavos bigint not null,
  minimum_unit_price_centavos bigint not null check (minimum_unit_price_centavos > 0),
  min_quantity bigint not null check (min_quantity > 0),
  max_quantity bigint not null check (max_quantity between 1 and 1000000),
  daily_quantity_limit bigint not null,
  total_quantity_limit bigint not null check (total_quantity_limit <= 2147483647),
  quote_ttl_seconds integer not null check (quote_ttl_seconds between 30 and 3600),
  large_change_threshold_bps integer not null check (large_change_threshold_bps between 0 and 100000),
  active_from timestamptz not null unique,
  created_at timestamptz not null default clock_timestamp(),
  created_by uuid not null, -- immutable actor snapshot; account deletion must not rewrite history
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  check (unit_price_centavos between minimum_unit_price_centavos and 10000000),
  check (min_quantity <= max_quantity),
  check (daily_quantity_limit >= max_quantity and total_quantity_limit >= daily_quantity_limit),
  -- Current provider/ledger technical ceilings, not approved commercial prices.
  check (max_quantity::numeric * unit_price_centavos <= 10000000)
);
create index evocash_price_versions_effective_idx on public.evocash_price_versions(active_from desc);

create table public.evocash_pricing_state (
  id boolean primary key default true check (id),
  revision bigint not null default 0 check (revision >= 0),
  latest_version_id uuid references public.evocash_price_versions(id),
  quoting_enabled boolean not null default false,
  updated_at timestamptz not null default clock_timestamp()
);
insert into public.evocash_pricing_state default values;
-- Deliberately no RPC to enable quoting or charges in Phase 1.

create table public.evocash_price_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid not null,
  action text not null check (action in ('publish','pause')),
  previous_version_id uuid references public.evocash_price_versions(id),
  price_version_id uuid references public.evocash_price_versions(id),
  applied_revision bigint not null unique check (applied_revision > 0),
  request_id uuid not null,
  request_payload jsonb not null,
  reason text not null check (char_length(btrim(reason)) between 5 and 500),
  occurred_at timestamptz not null default clock_timestamp(),
  unique(actor_user_id, request_id),
  check (action <> 'publish' or price_version_id is not null)
);

create index evocash_price_audit_actor_time_idx on public.evocash_price_audit(actor_user_id,occurred_at desc);

create table public.evocash_purchase_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  request_id uuid not null,
  quantity bigint not null check (quantity between 1 and 1000000),
  unit_price_centavos bigint not null check (unit_price_centavos > 0),
  total_centavos bigint not null check (total_centavos between 1 and 10000000),
  price_version_id uuid not null references public.evocash_price_versions(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  check (expires_at > created_at),
  check (quantity::numeric * unit_price_centavos = total_centavos),
  unique(user_id, request_id)
);
create index evocash_purchase_quotes_user_created_idx on public.evocash_purchase_quotes(user_id,created_at desc);

alter table public.evocash_price_versions enable row level security;
alter table public.evocash_pricing_state enable row level security;
alter table public.evocash_price_audit enable row level security;
alter table public.evocash_purchase_quotes enable row level security;
revoke all on public.evocash_price_versions,public.evocash_pricing_state,public.evocash_price_audit,public.evocash_purchase_quotes from public,anon,authenticated,service_role;
revoke all on sequence public.evocash_price_audit_id_seq from public,anon,authenticated,service_role;
grant select on public.evocash_purchase_quotes to authenticated;
create policy evocash_quote_owner_read on public.evocash_purchase_quotes for select to authenticated
  using (user_id = (select auth.uid()) and (select coalesce(public.has_app_access(),false)));

create function private.evocash_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'EVOCASH_HISTORY_IMMUTABLE' using errcode='42501';
end $$;
create trigger evocash_price_immutable before update or delete on public.evocash_price_versions
for each row execute function private.evocash_immutable();
create trigger evocash_audit_immutable before update or delete on public.evocash_price_audit
for each row execute function private.evocash_immutable();
create trigger evocash_quote_immutable before update or delete on public.evocash_purchase_quotes
for each row execute function private.evocash_immutable();
revoke all on function private.evocash_immutable() from public,anon,authenticated,service_role;

create function private.require_evocash_admin(p_recent boolean default false) returns void
language plpgsql stable security definer set search_path='' as $$
declare v_now numeric := extract(epoch from clock_timestamp());
begin
  if not coalesce(public.has_app_access(),false) or not coalesce(public.is_superadmin(),false)
    or not exists(select 1 from public.users where id=auth.uid() and account_status='active') then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  -- Signed AMR authentication time, never JWT iat (refresh is not reauthentication).
  if p_recent and not exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(auth.jwt()->'amr')='array' then auth.jwt()->'amr' else '[]'::jsonb end) a
    where a->>'method' in ('password','otp','totp','webauthn')
      and case when a->>'timestamp' ~ '^[0-9]{1,12}$' then
        (a->>'timestamp')::numeric between v_now-300 and v_now+30 else false end
  ) then raise exception 'RECENT_AUTH_REQUIRED' using errcode='42501'; end if;
end $$;
revoke all on function private.require_evocash_admin(boolean) from public,anon,authenticated,service_role;

create function private.evocash_validate_price(p_config jsonb) returns public.evocash_price_versions
language plpgsql immutable set search_path='' as $$
declare
  v public.evocash_price_versions;
  k text;
  keys constant text[] := array['unitPriceCentavos','minimumUnitPriceCentavos','minQuantity','maxQuantity','dailyQuantityLimit','totalQuantityLimit','quoteTtlSeconds','largeChangeThresholdBps'];
begin
  if jsonb_typeof(p_config) is distinct from 'object' then raise exception 'INVALID_PRICE_CONFIG'; end if;
  if (select count(*) from jsonb_object_keys(p_config)) <> cardinality(keys)
    or not p_config ?& keys then raise exception 'INVALID_PRICE_CONFIG'; end if;
  foreach k in array keys loop
    if jsonb_typeof(p_config->k) is distinct from 'string'
      or p_config->>k !~ '^(0|[1-9][0-9]{0,9})$' then raise exception 'INVALID_PRICE_CONFIG'; end if;
  end loop;
  v.unit_price_centavos := (p_config->>'unitPriceCentavos')::bigint;
  v.minimum_unit_price_centavos := (p_config->>'minimumUnitPriceCentavos')::bigint;
  v.min_quantity := (p_config->>'minQuantity')::bigint;
  v.max_quantity := (p_config->>'maxQuantity')::bigint;
  v.daily_quantity_limit := (p_config->>'dailyQuantityLimit')::bigint;
  v.total_quantity_limit := (p_config->>'totalQuantityLimit')::bigint;
  -- Validate before casts to integer: oversized inputs always fail with the same domain error.
  if (p_config->>'quoteTtlSeconds')::bigint not between 30 and 3600
    or (p_config->>'largeChangeThresholdBps')::bigint not between 0 and 100000 then raise exception 'INVALID_PRICE_CONFIG'; end if;
  v.quote_ttl_seconds := (p_config->>'quoteTtlSeconds')::integer;
  v.large_change_threshold_bps := (p_config->>'largeChangeThresholdBps')::integer;
  if v.minimum_unit_price_centavos < 1 or v.unit_price_centavos < v.minimum_unit_price_centavos
    or v.min_quantity < 1 or v.max_quantity not between v.min_quantity and 1000000
    or v.daily_quantity_limit < v.max_quantity or v.total_quantity_limit < v.daily_quantity_limit
    or v.total_quantity_limit > 2147483647
    or v.max_quantity::numeric*v.unit_price_centavos > 10000000 then raise exception 'INVALID_PRICE_CONFIG'; end if;
  return v;
end $$;
revoke all on function private.evocash_validate_price(jsonb) from public,anon,authenticated,service_role;

create function private.evocash_price_json(v public.evocash_price_versions) returns jsonb
language sql immutable set search_path='' as $$
select case when v.id is null then null else jsonb_build_object(
  'id',v.id,'revision',v.revision::text,'previousVersionId',v.previous_version_id,
  'unitPriceCentavos',v.unit_price_centavos::text,'minimumUnitPriceCentavos',v.minimum_unit_price_centavos::text,
  'minQuantity',v.min_quantity::text,'maxQuantity',v.max_quantity::text,
  'dailyQuantityLimit',v.daily_quantity_limit::text,'totalQuantityLimit',v.total_quantity_limit::text,
  'quoteTtlSeconds',v.quote_ttl_seconds::text,'largeChangeThresholdBps',v.large_change_threshold_bps::text,
  'activeFrom',v.active_from,'createdAt',v.created_at,'createdBy',v.created_by,'reason',v.reason) end
$$;
revoke all on function private.evocash_price_json(public.evocash_price_versions) from public,anon,authenticated,service_role;

create function public.admin_get_evocash_pricing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions; latest public.evocash_price_versions;
begin
  perform private.require_evocash_admin();
  select * into s from public.evocash_pricing_state where id;
  select * into v from public.evocash_price_versions where active_from<=statement_timestamp() order by active_from desc limit 1;
  select * into latest from public.evocash_price_versions where id=s.latest_version_id;
  return jsonb_build_object('revision',s.revision::text,'quotingEnabled',s.quoting_enabled,
    'serverTime',statement_timestamp(),'current',private.evocash_price_json(v),'latest',private.evocash_price_json(latest));
end $$;

create function public.admin_preview_evocash_price(p_config jsonb,p_quantities text[],p_expected_revision bigint) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.evocash_price_versions; old public.evocash_price_versions; q text; samples jsonb := '[]'; change_bps numeric; rev bigint;
begin
  perform private.require_evocash_admin();
  v := private.evocash_validate_price(p_config);
  select revision into rev from public.evocash_pricing_state where id;
  if p_expected_revision is distinct from rev then raise exception 'PRICE_REVISION_CONFLICT'; end if;
  select * into old from public.evocash_price_versions order by active_from desc limit 1;
  if p_quantities is null or cardinality(p_quantities) not between 1 and 10 then raise exception 'INVALID_QUANTITY'; end if;
  foreach q in array p_quantities loop
    if q is null or q !~ '^[1-9][0-9]{0,9}$' then raise exception 'INVALID_QUANTITY'; end if;
    if q::bigint not between v.min_quantity and v.max_quantity then raise exception 'INVALID_QUANTITY'; end if;
    samples := samples || jsonb_build_object('quantity',q,'totalCentavos',(q::bigint*v.unit_price_centavos)::text);
  end loop;
  if old.id is not null then change_bps := trunc((v.unit_price_centavos-old.unit_price_centavos)::numeric*10000/old.unit_price_centavos); end if;
  return jsonb_build_object('samples',samples,'changeBps',change_bps::text,
    'previousUnitPriceCentavos',old.unit_price_centavos::text,
    -- The previous policy defines the threshold: a new price cannot weaken its own confirmation.
    'requiresAdditionalConfirmation',coalesce(abs((v.unit_price_centavos-old.unit_price_centavos)::numeric)*10000 >= old.unit_price_centavos::numeric*old.large_change_threshold_bps,false));
end $$;

create function public.admin_publish_evocash_price(p_config jsonb,p_active_from timestamptz,p_expected_revision bigint,p_request_id uuid,p_reason text,p_confirm_large_change boolean default false) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare
  s public.evocash_pricing_state; v public.evocash_price_versions; old public.evocash_price_versions;
  a public.evocash_price_audit; v_now timestamptz; payload jsonb;
begin
  perform private.require_evocash_admin(true);
  if p_request_id is null or p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 or p_confirm_large_change is null then raise exception 'INVALID_PRICE_REQUEST'; end if;
  v := private.evocash_validate_price(p_config);
  payload := jsonb_build_object('config',p_config,'activeFrom',p_active_from,'reason',btrim(p_reason),'confirmLargeChange',p_confirm_large_change);
  select * into s from public.evocash_pricing_state where id for update;
  perform private.require_evocash_admin(true);
  select * into a from public.evocash_price_audit where actor_user_id=auth.uid() and request_id=p_request_id;
  if found then
    if a.action<>'publish' or a.request_payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    select * into v from public.evocash_price_versions where id=a.price_version_id;
    return jsonb_build_object('revision',a.applied_revision::text,'version',private.evocash_price_json(v));
  end if;
  if p_expected_revision is distinct from s.revision then raise exception 'PRICE_REVISION_CONFLICT'; end if;
  if (select count(*) from public.evocash_price_audit where actor_user_id=auth.uid() and action='publish' and occurred_at>clock_timestamp()-interval '1 minute')>=10 then raise exception 'PRICE_RATE_LIMIT'; end if;
  select * into old from public.evocash_price_versions where id=s.latest_version_id;
  if old.id is not null and abs((v.unit_price_centavos-old.unit_price_centavos)::numeric)*10000 >= old.unit_price_centavos::numeric*old.large_change_threshold_bps
    and not p_confirm_large_change then raise exception 'ADDITIONAL_CONFIRMATION_REQUIRED'; end if;
  v_now := clock_timestamp();
  if p_active_from is not null and (not isfinite(p_active_from) or p_active_from<v_now) then raise exception 'INVALID_PRICE_START'; end if;
  v.active_from := coalesce(p_active_from,v_now);
  if old.id is not null and v.active_from<=old.active_from then raise exception 'PRICE_START_CONFLICT'; end if;
  v.id := gen_random_uuid(); v.revision := s.revision+1; v.previous_version_id := old.id;
  v.created_at := v_now; v.created_by := auth.uid(); v.reason := btrim(p_reason);
  insert into public.evocash_price_versions select v.*;
  update public.evocash_pricing_state set revision=v.revision,latest_version_id=v.id,updated_at=v_now where id;
  insert into public.evocash_price_audit(actor_user_id,action,previous_version_id,price_version_id,applied_revision,request_id,request_payload,reason)
    values(auth.uid(),'publish',old.id,v.id,v.revision,p_request_id,payload,v.reason);
  return jsonb_build_object('revision',v.revision::text,'version',private.evocash_price_json(v));
end $$;

create function public.admin_pause_evocash_quotes(p_expected_revision bigint,p_request_id uuid,p_reason text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s public.evocash_pricing_state; a public.evocash_price_audit; payload jsonb;
begin
  perform private.require_evocash_admin(true);
  if p_request_id is null or p_reason is null or char_length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_PRICE_REQUEST'; end if;
  payload := jsonb_build_object('reason',btrim(p_reason));
  select * into s from public.evocash_pricing_state where id for update;
  perform private.require_evocash_admin(true);
  select * into a from public.evocash_price_audit where actor_user_id=auth.uid() and request_id=p_request_id;
  if found then
    if a.action<>'pause' or a.request_payload<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
    return jsonb_build_object('revision',a.applied_revision::text,'quotingEnabled',false);
  end if;
  if p_expected_revision is distinct from s.revision then raise exception 'PRICE_REVISION_CONFLICT'; end if;
  update public.evocash_pricing_state set quoting_enabled=false,revision=revision+1,updated_at=clock_timestamp() where id returning * into s;
  insert into public.evocash_price_audit(actor_user_id,action,price_version_id,applied_revision,request_id,request_payload,reason)
    values(auth.uid(),'pause',s.latest_version_id,s.revision,p_request_id,payload,btrim(p_reason));
  return jsonb_build_object('revision',s.revision::text,'quotingEnabled',false);
end $$;

create function public.admin_list_evocash_prices(p_before_revision bigint default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
  perform private.require_evocash_admin();
  if p_limit is null or p_limit not between 1 and 50 or (p_before_revision is not null and p_before_revision<1) then raise exception 'INVALID_PAGE'; end if;
  select coalesce(jsonb_agg(private.evocash_price_json(x) order by x.revision desc),'[]'::jsonb) into items
  from (select v.* from public.evocash_price_versions v where p_before_revision is null or v.revision<p_before_revision order by v.revision desc limit p_limit) x;
  return jsonb_build_object('items',items,'nextCursor',case when jsonb_array_length(items)=p_limit then items->-1->>'revision' else null end);
end $$;

create function private.evocash_quote_json(q public.evocash_purchase_quotes) returns jsonb
language sql immutable set search_path='' as $$
select jsonb_build_object('quoteId',q.id,'priceVersionId',q.price_version_id,'quantity',q.quantity::text,
  'unitPriceCentavos',q.unit_price_centavos::text,'totalCentavos',q.total_centavos::text,
  'currency','BRL','createdAt',q.created_at,'expiresAt',q.expires_at)
$$;
revoke all on function private.evocash_quote_json(public.evocash_purchase_quotes) from public,anon,authenticated,service_role;

create function public.create_evocash_purchase_quote(p_quantity text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions; q public.evocash_purchase_quotes; v_now timestamptz; daily numeric; total numeric;
begin
  if auth.uid() is null or not coalesce(public.has_app_access(),false)
    or not exists(select 1 from public.users where id=auth.uid() and account_status='active') then raise exception 'PERMISSION_DENIED' using errcode='42501'; end if;
  if p_request_id is null or p_quantity is null or p_quantity !~ '^[1-9][0-9]{0,9}$' then raise exception 'INVALID_QUANTITY'; end if;
  -- Same lock order as price publication; user mutex serializes rate checks/retries.
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
  select * into v from public.evocash_price_versions where active_from<=v_now order by active_from desc limit 1;
  if not found then raise exception 'EVOCASH_PRICE_UNAVAILABLE'; end if;
  if p_quantity::bigint not between v.min_quantity and v.max_quantity then raise exception 'INVALID_QUANTITY'; end if;
  if (select count(*) from public.evocash_purchase_quotes where user_id=auth.uid() and created_at>v_now-interval '1 minute')>=10 then raise exception 'QUOTE_RATE_LIMIT'; end if;
  -- Advisory only until Phase 2 reserves under a wallet/user lock. Quotes reserve no money/limit.
  select coalesce(sum(cash_amount) filter(where created_at >= date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC'),0),coalesce(sum(cash_amount),0)
    into daily,total from public.cash_purchases where user_id=auth.uid() and status in ('pending','credited','held_in_case','needs_review');
  if daily+p_quantity::bigint>v.daily_quantity_limit or total+p_quantity::bigint>v.total_quantity_limit then raise exception 'PURCHASE_LIMIT_REACHED'; end if;
  insert into public.evocash_purchase_quotes(user_id,request_id,quantity,unit_price_centavos,total_centavos,price_version_id,created_at,expires_at)
    values(auth.uid(),p_request_id,p_quantity::bigint,v.unit_price_centavos,p_quantity::bigint*v.unit_price_centavos,v.id,v_now,v_now+make_interval(secs=>v.quote_ttl_seconds)) returning * into q;
  return private.evocash_quote_json(q);
end $$;

revoke all on function public.admin_get_evocash_pricing(),public.admin_preview_evocash_price(jsonb,text[],bigint),public.admin_publish_evocash_price(jsonb,timestamptz,bigint,uuid,text,boolean),public.admin_pause_evocash_quotes(bigint,uuid,text),public.admin_list_evocash_prices(bigint,integer),public.create_evocash_purchase_quote(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.admin_get_evocash_pricing(),public.admin_preview_evocash_price(jsonb,text[],bigint),public.admin_publish_evocash_price(jsonb,timestamptz,bigint,uuid,text,boolean),public.admin_pause_evocash_quotes(bigint,uuid,text),public.admin_list_evocash_prices(bigint,integer),public.create_evocash_purchase_quote(text,uuid) to authenticated;
