-- Phase 3. No commercial prices or live content adapters are activated.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.commercial_offerings (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{2,63}$'),
 name text not null check(length(name) between 3 and 120),
 description text not null check(length(description) between 3 and 1000),
 billing_type text not null default 'visibility_lease' check(billing_type='visibility_lease'),
 billing_unit text not null default 'day' check(billing_unit='day'),
 sales_enabled boolean not null default false,
 -- Only trusted module migrations may enable an adapter after its editorial integration.
 integration_ready boolean not null default false,
 revision bigint not null default 0 check(revision>=0),
 latest_price_id uuid,
 updated_at timestamptz not null default clock_timestamp()
);
insert into public.commercial_offerings(code,name,description) values
 ('ad_community','Publicidade em comunidades','Elegibilidade de publicidade em comunidades autorizadas.'),
 ('ad_home','Publicidade na Home','Elegibilidade de publicidade na Home.'),
 ('ad_network','Publicidade em posicionamentos elegíveis','Conjunto explícito e versionado de posições; integração futura.'),
 ('post_boost','Impulsionamento de publicação','Destaque adicional de uma publicação elegível.'),
 ('community_boost','Impulsionamento de comunidade','Destaque adicional de uma comunidade elegível.'),
 ('product_storefront','Vitrine de produtos','Publicação temporária de uma vitrine aprovada.'),
 ('professional_profile','Perfil profissional','Publicação temporária de perfil profissional aprovado.'),
 ('establishment_profile','Estabelecimento','Publicação temporária de estabelecimento aprovado.');
-- No workout-sheet offering: its future one-time entitlement needs its own reviewed adapter.
create table public.commercial_price_versions (
 id uuid primary key default gen_random_uuid(),
 offering_code text not null references public.commercial_offerings(code),
 revision bigint not null check(revision>0),
 unit_price_cash bigint not null check(unit_price_cash between 1 and 2147483647),
 min_days integer not null check(min_days between 1 and 3650),
 max_days integer not null check(max_days between min_days and 3650),
 check(unit_price_cash::numeric*max_days<=2147483647),
 active_from timestamptz not null check(isfinite(active_from)),
 created_at timestamptz not null default clock_timestamp(),
 created_by uuid not null,
 reason text not null check(length(btrim(reason)) between 5 and 500),
 unique(offering_code,revision), unique(offering_code,active_from), unique(id,offering_code)
);
alter table public.commercial_offerings add foreign key(latest_price_id,code) references public.commercial_price_versions(id,offering_code);
-- An integration anchor, not a polymorphic pointer to a possibly nonexistent object.
-- Future editorial modules reference this row by FK, and synchronize approval/revision
-- in their own locked transaction. No public registration/approval API exists.
create table private.commercial_resources (
 id uuid primary key default gen_random_uuid(),
 offering_code text not null references public.commercial_offerings(code),
 owner_user_id uuid references public.users(id) on delete set null,
 content_revision bigint not null check(content_revision>0),
 approved_revision bigint,
 moderation_state text not null default 'draft' check(moderation_state in('draft','submitted','approved','rejected','suspended','archived')),
 check(approved_revision is null or approved_revision<=content_revision),
 unique(id,offering_code)
);
create table public.commercial_orders (
 id uuid primary key default gen_random_uuid(),
 payer_user_id uuid not null,
 request_id uuid not null,
 resource_id uuid not null,
 offering_code text not null,
 foreign key(resource_id,offering_code) references private.commercial_resources(id,offering_code),
 price_version_id uuid not null,
 foreign key(price_version_id,offering_code) references public.commercial_price_versions(id,offering_code),
 content_revision bigint not null check(content_revision>0),
 duration_days integer not null check(duration_days between 1 and 3650),
 unit_price_cash bigint not null check(unit_price_cash between 1 and 2147483647),
 total_cash bigint not null check(total_cash between 1 and 2147483647),
 check(total_cash=unit_price_cash::numeric*duration_days),
 status text not null default 'quoted' check(status in('quoted','fulfilled','reversed')),
 created_at timestamptz not null default clock_timestamp(),
 quote_expires_at timestamptz not null,
 fulfilled_at timestamptz,
 period_start timestamptz,
 period_end timestamptz,
 check(quote_expires_at>created_at),
 check((status='quoted' and fulfilled_at is null and period_start is null and period_end is null)
   or(status in('fulfilled','reversed') and fulfilled_at is not null and period_start is not null and period_end=period_start+duration_days*interval '24 hours')),
 unique(payer_user_id,request_id),unique(id,resource_id)
);
create index commercial_orders_payer_time_idx on public.commercial_orders(payer_user_id,created_at desc,id);
create index commercial_orders_resource_idx on public.commercial_orders(resource_id,created_at desc);
create index commercial_orders_fulfilled_idx on public.commercial_orders(resource_id,fulfilled_at desc) where status='fulfilled';
create table public.visibility_entitlements (
 id uuid primary key default gen_random_uuid(),
 resource_id uuid not null unique references private.commercial_resources(id),
 origin_order_id uuid not null,
 foreign key(origin_order_id,resource_id) references public.commercial_orders(id,resource_id),
 starts_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>starts_at),
 administrative_state text not null default 'enabled' check(administrative_state in('enabled','suspended','revoked')),
 revision bigint not null default 1 check(revision>0)
);
create index visibility_entitlements_origin_idx on public.visibility_entitlements(origin_order_id);
create table public.commercial_order_events (
 id bigint generated always as identity primary key,
 offering_code text not null references public.commercial_offerings(code),
 order_id uuid references public.commercial_orders(id),
 entitlement_id uuid references public.visibility_entitlements(id),
 actor_user_id uuid not null,
 action text not null check(action in('publish_price','sales','quoted','fulfilled','renewed','suspended','resumed','revoked','reversed')),
 request_id uuid,
 reason text not null check(length(btrim(reason)) between 5 and 500),
 payload jsonb not null default '{}',
 occurred_at timestamptz not null default clock_timestamp()
);
create unique index commercial_events_request_idx on public.commercial_order_events(actor_user_id,request_id) where request_id is not null;
create index commercial_events_order_idx on public.commercial_order_events(order_id,id desc);
create index commercial_events_offering_idx on public.commercial_order_events(offering_code,id desc);
create index commercial_events_quotes_idx on public.commercial_order_events(id desc) where action='quoted';
create index commercial_events_actor_time_idx on public.commercial_order_events(actor_user_id,occurred_at desc);

create function private.commercial_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'COMMERCIAL_HISTORY_IMMUTABLE' using errcode='42501'; end $$;
create trigger commercial_price_immutable before update or delete on public.commercial_price_versions for each row execute function private.commercial_immutable();
create trigger commercial_event_immutable before update or delete on public.commercial_order_events for each row execute function private.commercial_immutable();
create function private.commercial_order_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='DELETE' then raise exception 'COMMERCIAL_HISTORY_IMMUTABLE'; end if;
 if (to_jsonb(new)-array['status','fulfilled_at','period_start','period_end']) is distinct from
    (to_jsonb(old)-array['status','fulfilled_at','period_start','period_end'])
    or not ((old.status='quoted' and new.status='fulfilled') or (old.status='fulfilled' and new.status='reversed'))
    or (old.status='fulfilled' and (new.fulfilled_at,new.period_start,new.period_end) is distinct from (old.fulfilled_at,old.period_start,old.period_end)) then
   raise exception 'COMMERCIAL_HISTORY_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger commercial_order_immutable before update or delete on public.commercial_orders for each row execute function private.commercial_order_snapshot();

create function private.require_commercial_user() returns void language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not coalesce(public.has_app_access(),false)
 or not exists(select 1 from public.users where id=auth.uid() and account_status='active') then
 raise exception 'APP_ACCESS_DENIED' using errcode='42501'; end if;
end $$;
create function private.commercial_order_json(o public.commercial_orders) returns jsonb language sql immutable set search_path='' as $$
select jsonb_build_object('id',o.id,'resourceId',o.resource_id,'offeringCode',o.offering_code,'priceVersionId',o.price_version_id,
 'contentRevision',o.content_revision::text,'durationDays',o.duration_days::text,'unitPriceCash',o.unit_price_cash::text,'totalCash',o.total_cash::text,
 'status',o.status,'createdAt',o.created_at,'quoteExpiresAt',o.quote_expires_at,'fulfilledAt',o.fulfilled_at,'periodStart',o.period_start,'periodEnd',o.period_end)
$$;
-- One predicate for all future public/Storage/API adapters. It is private: no UUID oracle.
-- Sales availability deliberately does not revoke already purchased rights.
create function private.commercial_resource_visible(p_resource_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from private.commercial_resources r
 join public.commercial_offerings f on f.code=r.offering_code
 join public.users u on u.id=r.owner_user_id
 join public.visibility_entitlements e on e.resource_id=r.id
 where r.id=p_resource_id and f.integration_ready and u.account_status='active'
 and not exists(select 1 from public.account_restrictions ar where ar.user_id=u.id
   and not (ar.action='temporary_suspension' and ar.until<=statement_timestamp()))
 and r.moderation_state='approved' and r.approved_revision=r.content_revision
 and e.administrative_state='enabled' and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp())
$$;

create function public.admin_commercial_catalog() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 perform private.require_evocash_admin();
 select coalesce(jsonb_agg(jsonb_build_object('code',f.code,'name',f.name,'description',f.description,'billingType',f.billing_type,'billingUnit',f.billing_unit,
 'salesEnabled',f.sales_enabled,'integrationReady',f.integration_ready,'revision',f.revision::text,
 'currentPrice',case when p.id is null then null else jsonb_build_object('id',p.id,'unitPriceCash',p.unit_price_cash::text,'minDays',p.min_days::text,'maxDays',p.max_days::text,'activeFrom',p.active_from) end) order by f.code),'[]') into items
 from public.commercial_offerings f left join lateral(select v.* from public.commercial_price_versions v where v.offering_code=f.code and v.active_from<=statement_timestamp() order by v.active_from desc limit 1)p on true;
 return jsonb_build_object('items',items,'serverTime',statement_timestamp());
end $$;

create function public.admin_publish_commercial_price(p_offering_code text,p_unit_price_cash text,p_min_days integer,p_max_days integer,p_active_from timestamptz,p_expected_revision bigint,p_request_id uuid,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare f public.commercial_offerings; v public.commercial_price_versions; a public.commercial_order_events; payload jsonb; t timestamptz;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_request_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500
 or p_unit_price_cash is null or p_unit_price_cash !~ '^[1-9][0-9]{0,9}$' or p_unit_price_cash::numeric>2147483647
 or p_min_days is null or p_max_days is null or p_min_days<1 or p_max_days not between p_min_days and 3650
 or p_unit_price_cash::numeric*p_max_days>2147483647 then raise exception 'INVALID_COMMERCIAL_PRICE'; end if;
 -- Serialize administrative idempotency across offerings as well as per-offering CAS.
 perform pg_catalog.pg_advisory_xact_lock(83101,pg_catalog.hashtext(auth.uid()::text));
 select * into f from public.commercial_offerings where code=p_offering_code for update;
 if not found then raise exception 'OFFERING_NOT_FOUND'; end if;
 perform private.require_evocash_admin(true);
 payload:=jsonb_build_object('offeringCode',p_offering_code,'unitPriceCash',p_unit_price_cash,'minDays',p_min_days,'maxDays',p_max_days,'activeFrom',p_active_from,'reason',btrim(p_reason));
 select * into a from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request_id;
 if found then
 if a.action<>'publish_price' or a.payload->'request'<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return a.payload->'result'; end if;
 if f.revision is distinct from p_expected_revision then raise exception 'PRICE_REVISION_CONFLICT'; end if;
 if (select count(*) from public.commercial_order_events where actor_user_id=auth.uid() and occurred_at>clock_timestamp()-interval '1 minute' and action in('publish_price','sales'))>=10 then raise exception 'PRICE_RATE_LIMIT'; end if;
 t:=clock_timestamp();
 if p_active_from is not null and (not isfinite(p_active_from) or p_active_from<t) then raise exception 'INVALID_PRICE_START'; end if;
 if exists(select 1 from public.commercial_price_versions where offering_code=f.code and active_from>=coalesce(p_active_from,t)) then raise exception 'PRICE_START_CONFLICT'; end if;
 insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
 values(f.code,f.revision+1,p_unit_price_cash::bigint,p_min_days,p_max_days,coalesce(p_active_from,t),auth.uid(),btrim(p_reason)) returning * into v;
 update public.commercial_offerings set revision=revision+1,latest_price_id=v.id,updated_at=t where code=f.code;
 insert into public.commercial_order_events(offering_code,actor_user_id,action,request_id,reason,payload)
 values(f.code,auth.uid(),'publish_price',p_request_id,btrim(p_reason),jsonb_build_object('request',payload,'result',jsonb_build_object('priceVersionId',v.id,'revision',v.revision::text)));
 return jsonb_build_object('priceVersionId',v.id,'revision',v.revision::text);
end $$;

create function public.admin_set_commercial_sales(p_offering_code text,p_enabled boolean,p_expected_revision bigint,p_request_id uuid,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare f public.commercial_offerings; a public.commercial_order_events; payload jsonb; result jsonb;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_enabled is null or p_request_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_COMMERCIAL_REQUEST'; end if;
 perform pg_catalog.pg_advisory_xact_lock(83101,pg_catalog.hashtext(auth.uid()::text));
 select * into f from public.commercial_offerings where code=p_offering_code for update;
 if not found then raise exception 'OFFERING_NOT_FOUND'; end if;
 perform private.require_evocash_admin(true);
 payload:=jsonb_build_object('offeringCode',p_offering_code,'enabled',p_enabled,'reason',btrim(p_reason));
 select * into a from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request_id;
 if found then
 if a.action<>'sales' or a.payload->'request'<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return a.payload->'result'; end if;
 if f.revision is distinct from p_expected_revision then raise exception 'PRICE_REVISION_CONFLICT'; end if;
 if (select count(*) from public.commercial_order_events where actor_user_id=auth.uid() and occurred_at>clock_timestamp()-interval '1 minute' and action in('publish_price','sales'))>=10 then raise exception 'PRICE_RATE_LIMIT'; end if;
 if p_enabled and (not f.integration_ready or not exists(select 1 from public.commercial_price_versions where offering_code=f.code and active_from<=clock_timestamp())) then raise exception 'COMMERCIAL_INTEGRATION_UNAVAILABLE'; end if;
 update public.commercial_offerings set sales_enabled=p_enabled,revision=revision+1,updated_at=clock_timestamp() where code=f.code returning * into f;
 result:=jsonb_build_object('revision',f.revision::text,'salesEnabled',f.sales_enabled);
 insert into public.commercial_order_events(offering_code,actor_user_id,action,request_id,reason,payload) values(f.code,auth.uid(),'sales',p_request_id,btrim(p_reason),jsonb_build_object('request',payload,'result',result));
 return result;
end $$;

create function public.quote_commercial_order(p_resource_id uuid,p_duration_days text,p_request_id uuid) returns jsonb
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

create function public.confirm_commercial_order(p_order_id uuid,p_confirm boolean) returns jsonb
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

create function public.admin_set_commercial_entitlement(p_entitlement_id uuid,p_state text,p_expected_revision bigint,p_request_id uuid,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare e public.visibility_entitlements; a public.commercial_order_events; r private.commercial_resources; payload jsonb; result jsonb;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_state is null or p_state not in('enabled','suspended','revoked') or p_request_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_COMMERCIAL_REQUEST'; end if;
 perform pg_catalog.pg_advisory_xact_lock(83101,pg_catalog.hashtext(auth.uid()::text));
 select * into e from public.visibility_entitlements where id=p_entitlement_id;
 if not found then raise exception 'ENTITLEMENT_NOT_FOUND'; end if;
 select * into r from private.commercial_resources where id=e.resource_id for update;
 select * into e from public.visibility_entitlements where id=e.id for update;
 perform private.require_evocash_admin(true);
 payload:=jsonb_build_object('entitlementId',p_entitlement_id,'state',p_state,'reason',btrim(p_reason));
 select * into a from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request_id;
 if found then
 if a.action not in('suspended','resumed','revoked') or a.payload->'request'<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return a.payload->'result'; end if;
 if e.revision is distinct from p_expected_revision then raise exception 'ENTITLEMENT_REVISION_CONFLICT'; end if;
 -- Revocation is terminal. Resuming a right does not approve content or extend time.
 if e.administrative_state='revoked' then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 update public.visibility_entitlements set administrative_state=p_state,revision=revision+1 where id=e.id returning * into e;
 result:=jsonb_build_object('id',e.id,'revision',e.revision::text,'administrativeState',e.administrative_state);
 insert into public.commercial_order_events(offering_code,entitlement_id,actor_user_id,action,request_id,reason,payload)
 values(r.offering_code,e.id,auth.uid(),case p_state when 'enabled' then 'resumed' when 'suspended' then 'suspended' else 'revoked' end,p_request_id,btrim(p_reason),jsonb_build_object('request',payload,'result',result));
 return result;
end $$;
-- Full refund only, in reverse renewal order. Never silently refund unrelated periods.
create function public.admin_reverse_commercial_order(p_order_id uuid,p_request_id uuid,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare o public.commercial_orders; e public.visibility_entitlements; a public.commercial_order_events; payload jsonb; result jsonb;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_request_id is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_COMMERCIAL_REQUEST'; end if;
 perform pg_catalog.pg_advisory_xact_lock(83101,pg_catalog.hashtext(auth.uid()::text));
 select * into o from public.commercial_orders where id=p_order_id;
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 -- User lock matches all spending before resource/order/wallet locks.
 perform 1 from public.users where id=o.payer_user_id for no key update;
 perform 1 from private.commercial_resources where id=o.resource_id for update;
 select * into o from public.commercial_orders where id=o.id for update;
 select * into e from public.visibility_entitlements where resource_id=o.resource_id for update;
 perform private.require_evocash_admin(true);
 payload:=jsonb_build_object('orderId',p_order_id,'reason',btrim(p_reason));
 select * into a from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request_id;
 if found then
 if a.action<>'reversed' or a.payload->'request'<>payload then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return a.payload->'result'; end if;
 if o.status='reversed' then return private.commercial_order_json(o); end if;
 if o.status<>'fulfilled' or e.id is null then raise exception 'ORDER_NOT_FULFILLED'; end if;
 if not exists(select 1 from public.users where id=o.payer_user_id and account_status='active') then raise exception 'ACCOUNT_NOT_ELIGIBLE_FOR_REFUND'; end if;
 if exists(select 1 from public.commercial_orders where resource_id=o.resource_id and status='fulfilled' and fulfilled_at>o.fulfilled_at) then raise exception 'REVERSE_LATEST_ORDER_FIRST'; end if;
 if not exists(select 1 from public.economy_transactions where user_id=o.payer_user_id and natural_key='commercial:'||o.id and asset='cash' and direction='debit' and amount=o.total_cash) then raise exception 'COMMERCIAL_LEDGER_MISMATCH'; end if;
 perform public._wallet_credit_cash(o.payer_user_id,o.total_cash);
 perform public._ledger_record(o.payer_user_id,'commercial_refund:'||o.id,'cash','credit',o.total_cash,'commercial_refund','commercial_order',o.id::text);
 update public.commercial_orders set status='reversed' where id=o.id returning * into o;
 if o.period_start>e.starts_at then
 update public.visibility_entitlements set expires_at=o.period_start,revision=revision+1 where id=e.id;
 else
 update public.visibility_entitlements set administrative_state='revoked',revision=revision+1 where id=e.id;
 end if;
 result:=private.commercial_order_json(o);
 insert into public.commercial_order_events(offering_code,order_id,entitlement_id,actor_user_id,action,request_id,reason,payload)
 values(o.offering_code,o.id,e.id,auth.uid(),'reversed',p_request_id,btrim(p_reason),jsonb_build_object('request',payload,'result',result));
 return result;
end $$;

create function public.get_my_commercial_order(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.commercial_orders;
begin
 perform private.require_commercial_user();
 select * into o from public.commercial_orders where id=p_order_id and payer_user_id=auth.uid();
 if not found then raise exception 'ORDER_NOT_FOUND'; end if;
 return private.commercial_order_json(o);
end $$;

-- Unified bounded cursor lists, no per-row requests. Cursor always an integer string.
create function public.admin_list_commercial(p_kind text,p_offering_code text default null,p_before_id bigint default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb;
begin
 perform private.require_evocash_admin();
 if p_limit is null or p_limit not between 1 and 50 or (p_before_id is not null and p_before_id<1) then raise exception 'INVALID_PAGE'; end if;
 if p_kind='events' then
 select coalesce(jsonb_agg(to_jsonb(x) order by x.cursor::bigint desc),'[]') into items from (
 select id::text as cursor,action,actor_user_id,order_id,entitlement_id,reason,payload,occurred_at from public.commercial_order_events
 where (p_offering_code is null or offering_code=p_offering_code) and (p_before_id is null or id<p_before_id) order by id desc limit p_limit)x;
 elsif p_kind='prices' then
 select coalesce(jsonb_agg(to_jsonb(x) order by x.cursor::bigint desc),'[]') into items from (
 select revision::text as cursor,id,offering_code,unit_price_cash::text,min_days,max_days,active_from,created_by,reason from public.commercial_price_versions
 where offering_code=p_offering_code and (p_before_id is null or revision<p_before_id) order by revision desc limit p_limit)x;
 elsif p_kind in('orders','rights') then
 -- Events give durable monotonically increasing cursors without adding redundant sequences.
 select coalesce(jsonb_agg(x.value order by x.cursor desc),'[]') into items from (
 select a.id as cursor,case when p_kind='orders' then private.commercial_order_json(o)||jsonb_build_object('cursor',a.id::text)
 else jsonb_build_object('id',e.id,'cursor',a.id::text,'resourceId',e.resource_id,'offeringCode',o.offering_code,
 'startsAt',e.starts_at,'expiresAt',e.expires_at,'revision',e.revision::text,'administrativeState',e.administrative_state,
 'effectiveState',case when e.administrative_state<>'enabled' then e.administrative_state when e.expires_at<=statement_timestamp() then 'expired' when not private.commercial_resource_visible(e.resource_id) then 'ineligible' else 'active' end) end as value
 from public.commercial_order_events a join public.commercial_orders o on o.id=a.order_id
 left join public.visibility_entitlements e on e.origin_order_id=o.id
 where a.action='quoted' and (p_offering_code is null or a.offering_code=p_offering_code)
 and (p_before_id is null or a.id<p_before_id) and (p_kind='orders' or e.id is not null)
 order by a.id desc limit p_limit)x;
 else raise exception 'INVALID_PAGE'; end if;
 return jsonb_build_object('items',items,'serverTime',statement_timestamp(),'nextCursor',case when jsonb_array_length(items)=p_limit then items->-1->>'cursor' else null end);
end $$;

-- Defense in depth: no direct financial/catalog/editorial writes through PostgREST.
alter table public.commercial_offerings enable row level security;
alter table public.commercial_price_versions enable row level security;
alter table private.commercial_resources enable row level security;
alter table public.commercial_orders enable row level security;
alter table public.commercial_order_events enable row level security;
alter table public.visibility_entitlements enable row level security;
revoke all on public.commercial_offerings,public.commercial_price_versions,private.commercial_resources,public.commercial_orders,public.commercial_order_events,public.visibility_entitlements from public,anon,authenticated,service_role;
revoke all on sequence public.commercial_order_events_id_seq from public,anon,authenticated,service_role;
grant select on public.commercial_orders to authenticated;
create policy commercial_order_owner_read on public.commercial_orders for select to authenticated
using(payer_user_id=(select auth.uid()) and (select coalesce(public.has_app_access(),false)));
-- Revoke default PUBLIC function execution for every new helper/RPC in this migration.
do $$ declare f record; begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='private' and p.proname in('commercial_immutable','commercial_order_snapshot','require_commercial_user','commercial_order_json','commercial_resource_visible'))
 or (n.nspname='public' and p.proname in('admin_commercial_catalog','admin_publish_commercial_price','admin_set_commercial_sales','quote_commercial_order','confirm_commercial_order','admin_set_commercial_entitlement','admin_reverse_commercial_order','get_my_commercial_order','admin_list_commercial')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',f.nspname,f.proname,f.args);
 if f.nspname='public' then execute format('grant execute on function %I.%I(%s) to authenticated',f.nspname,f.proname,f.args); end if;
 end loop;
end $$;
