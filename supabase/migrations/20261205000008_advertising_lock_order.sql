-- FK snapshot inserts take KEY SHARE; avoid upgrading them to conflicting UPDATE locks.
-- NO KEY UPDATE still serializes reservations and capacity edits without changing identifiers.
create or replace function private.advertising_order_inventory_guard() returns trigger
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
 order by ap.code for no key update loop
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
create or replace function public.admin_configure_advertising_placement(p_code text,p_capacity integer,p_sales_enabled boolean,p_delivery_enabled boolean,p_expected_revision bigint,p_reason text,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare p public.advertising_placements; c record; t timestamptz:=clock_timestamp();
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_capacity is null or p_capacity not between 0 and 100 or p_sales_enabled is null or p_delivery_enabled is null or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_AD_CONFIGURATION'; end if;
 select * into p from public.advertising_placements where code=p_code for no key update;
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
