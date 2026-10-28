-- Phase 6: inventory adapter for the existing commercial transaction.
-- No prices, capacities, sales or delivery are enabled by this migration.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.advertising_placements (
 code text primary key check(code ~ '^[a-z][a-z0-9_]{2,63}$'),
 name text not null check(length(btrim(name)) between 3 and 120),
 description text not null check(length(btrim(description)) between 3 and 1000),
 surface text not null check(surface in('home','community')),
 content_type text not null check(content_type in('banner','feed')),
 offering_code text not null references public.commercial_offerings(code),
 sales_enabled boolean not null default false,
 delivery_enabled boolean not null default false,
 capacity integer not null default 0 check(capacity between 0 and 100),
 rotation_policy text not null default 'equal_random' check(rotation_policy='equal_random'),
 display_limit integer not null default 1 check(display_limit between 1 and 6),
 revision bigint not null default 0,
 unique(code,surface)
);
insert into public.advertising_placements(code,name,description,surface,content_type,offering_code) values
 ('home_banner','Banner da Home','Área patrocinada existente, sem substituir recomendações de treino.','home','banner','ad_home'),
 ('community_banner','Banner de comunidade','Área identificada no cabeçalho da comunidade autorizada.','community','banner','ad_community'),
 ('community_feed','Publicidade no feed','Card identificado entre publicações da comunidade autorizada.','community','feed','ad_community');
-- Scopes are explicit, immutable per resource and copied into each quote.
-- New placements never enter an existing resource/package automatically.
create table private.advertising_resource_inventory (
 resource_id uuid not null references private.commercial_resources(id),
 placement_code text not null references public.advertising_placements(code),
 context_id uuid not null, -- zero UUID is the single Home context; communities use their actual UUID
 primary key(resource_id,placement_code,context_id)
);
create table private.advertising_order_inventory (
 order_id uuid not null references public.commercial_orders(id),
 placement_code text not null references public.advertising_placements(code),
 context_id uuid not null,
 primary key(order_id,placement_code,context_id)
);
create table private.advertising_reservations (
 order_id uuid not null,
 placement_code text not null,
 context_id uuid not null,
 foreign key(order_id,placement_code,context_id) references private.advertising_order_inventory(order_id,placement_code,context_id),
 starts_at timestamptz not null,
 expires_at timestamptz not null check(expires_at>starts_at),
 primary key(order_id,placement_code,context_id)
);
create index advertising_reservation_window_idx on private.advertising_reservations(placement_code,context_id,expires_at,starts_at);
create table public.advertising_operations (
 id bigint generated always as identity primary key,
 actor_user_id uuid not null,
 placement_code text references public.advertising_placements(code),
 resource_id uuid references private.commercial_resources(id),
 action text not null,
 reason text not null check(length(btrim(reason)) between 5 and 500),
 payload jsonb not null default '{}',
 occurred_at timestamptz not null default clock_timestamp()
);
create trigger advertising_operation_immutable before update or delete on public.advertising_operations for each row execute function private.commercial_immutable();
create trigger advertising_scope_immutable before update or delete on private.advertising_resource_inventory for each row execute function private.commercial_immutable();
create trigger advertising_quote_scope_immutable before update or delete on private.advertising_order_inventory for each row execute function private.commercial_immutable();
create trigger advertising_reservation_immutable before update or delete on private.advertising_reservations for each row execute function private.commercial_immutable();
alter table public.advertising_placements enable row level security;
alter table public.advertising_operations enable row level security;
alter table private.advertising_resource_inventory enable row level security;
alter table private.advertising_order_inventory enable row level security;
alter table private.advertising_reservations enable row level security;
revoke all on public.advertising_placements,public.advertising_operations,private.advertising_resource_inventory,private.advertising_order_inventory,private.advertising_reservations from public,anon,authenticated,service_role;

-- Peak concurrency, not the number of all rows touching the requested interval.
-- Reversed orders release their reservation; suspensions preserve paid commitments.
create function private.advertising_peak(p_code text,p_context uuid,p_start timestamptz,p_end timestamptz) returns integer
language sql stable security definer set search_path='' as $$
 with windows as (
 select greatest(r.starts_at,p_start) s,least(r.expires_at,p_end) e
 from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where r.placement_code=p_code and r.context_id=p_context and o.status='fulfilled'
 and r.starts_at<p_end and r.expires_at>p_start
 ), changes as (
 select s t,1 delta from windows union all select e,-1 from windows
 ), sums as(select sum(sum(delta)) over(order by t) n from changes group by t)
 select coalesce(max(n),0)::integer from sums
$$;

-- Trigger runs inside the existing quote/fulfil transaction. A failure rolls back
-- debit, ledger, order and entitlement. Lock all placement rows in stable order;
-- shared context locks are intentionally conservative and avoid global deadlocks.
create function private.advertising_order_inventory_guard() returns trigger
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.advertising_placements; s record; start_at timestamptz; end_at timestamptz; t timestamptz;
begin
 -- Existing Phase 3 anchors for unavailable integrations are not delivery authorizations.
 if not exists(select 1 from private.advertising_resource_inventory where resource_id=new.resource_id) then
  return new;
 end if;
 if tg_op='INSERT' then
 insert into private.advertising_order_inventory(order_id,placement_code,context_id)
 select new.id,placement_code,context_id from private.advertising_resource_inventory where resource_id=new.resource_id;
 elsif old.status<>'quoted' or new.status<>'fulfilled' then return new;
 end if;
 -- Quote uses the same renewal boundary as fulfilment. Quotes do not hold capacity.
 t:=clock_timestamp();
 if tg_op='UPDATE' then start_at:=new.period_start; end_at:=new.period_end;
 else
 select greatest(coalesce(expires_at,t),t) into start_at from public.visibility_entitlements where resource_id=new.resource_id;
 start_at:=coalesce(start_at,t); end_at:=start_at+new.duration_days*interval '24 hours';
 end if;
 for p in select ap.* from public.advertising_placements ap
 where ap.code in(select placement_code from private.advertising_order_inventory where order_id=new.id)
 order by ap.code for update loop
 if not p.sales_enabled or not p.delivery_enabled or p.capacity=0 then raise exception 'AD_PLACEMENT_UNAVAILABLE'; end if;
 for s in select * from private.advertising_order_inventory where order_id=new.id and placement_code=p.code order by context_id loop
 if private.advertising_peak(p.code,s.context_id,start_at,end_at)>=p.capacity then raise exception 'AD_CAPACITY_UNAVAILABLE'; end if;
 end loop;
 end loop;
 if tg_op='UPDATE' then
 insert into private.advertising_reservations(order_id,placement_code,context_id,starts_at,expires_at)
 select new.id,placement_code,context_id,start_at,end_at from private.advertising_order_inventory where order_id=new.id;
 end if;
 return new;
end $$;
-- AFTER INSERT is necessary because snapshot/reservation FKs reference the order.
create trigger advertising_order_inventory after insert or update on public.commercial_orders
 for each row execute function private.advertising_order_inventory_guard();

create function public.admin_advertising_inventory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return jsonb_build_object('placements',(select jsonb_agg(to_jsonb(p) order by code) from public.advertising_placements p),'serverTime',statement_timestamp());
end $$;
create function public.admin_configure_advertising_placement(p_code text,p_capacity integer,p_sales_enabled boolean,p_delivery_enabled boolean,p_expected_revision bigint,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.advertising_placements; c record; t timestamptz:=clock_timestamp();
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_capacity is null or p_capacity not between 0 and 100 or p_sales_enabled is null or p_delivery_enabled is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_AD_CONFIGURATION'; end if;
 select * into p from public.advertising_placements where code=p_code for update;
 if not found then raise exception 'AD_PLACEMENT_NOT_FOUND'; end if;
 perform private.require_evocash_admin(true);
 if p.revision is distinct from p_expected_revision then raise exception 'AD_CONFIGURATION_CONFLICT'; end if;
 if p_capacity<p.capacity then
 for c in select distinct context_id from (select context_id from private.advertising_reservations where placement_code=p_code and expires_at>t union select unnest(community_ids) from public.sponsored_ads union select '00000000-0000-0000-0000-000000000000'::uuid) contexts loop
 if private.advertising_peak(p_code,c.context_id,t,'infinity')>p_capacity then raise exception 'AD_CAPACITY_COMMITTED'; end if;
 end loop;
 end if;
 update public.advertising_placements set capacity=p_capacity,sales_enabled=p_sales_enabled,delivery_enabled=p_delivery_enabled,revision=revision+1 where code=p_code returning * into p;
 insert into public.advertising_operations(actor_user_id,placement_code,action,reason,payload)
 values(auth.uid(),p_code,'configure_placement',btrim(p_reason),to_jsonb(p));
 return to_jsonb(p);
end $$;
revoke all on function private.advertising_peak(text,uuid,timestamptz,timestamptz),private.advertising_order_inventory_guard() from public,anon,authenticated,service_role;
revoke all on function public.admin_advertising_inventory(),public.admin_configure_advertising_placement(text,integer,boolean,boolean,bigint,text,boolean) from public,anon,service_role;
grant execute on function public.admin_advertising_inventory(),public.admin_configure_advertising_placement(text,integer,boolean,boolean,bigint,text,boolean) to authenticated;
