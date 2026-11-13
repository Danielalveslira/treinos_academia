-- Direct post boosts use the existing priced order, wallet and entitlement engine.
-- Source eligibility must not depend on the normal publication deadline: doing so
-- makes the paid extension disappear as soon as that deadline passes.
set local lock_timeout='5s';

create or replace function private.commercial_promotion_source_eligible(p public.promotions) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.communities c join public.community_advertising_permissions permissions on permissions.community_id=c.id
 where c.id=p.community_id and c.is_active
 and (case when p.target_type='post' then permissions.post_boosts_enabled else permissions.community_boosts_enabled and c.owner_id=p.owner_id end)
 and not exists(select 1 from public.deletion_jobs j where j.kind='community' and j.target_id=c.id and j.state<>'complete')
 and exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=p.owner_id)
 and not exists(select 1 from public.community_restrictions cr where cr.community_id=c.id and cr.user_id=p.owner_id)
 and (p.target_type='community' or exists(select 1 from public.statuses s where s.id=p.target_id and s.author_id=p.owner_id and s.community_id=c.id))
 and exists(select 1 from private.promotion_editorial_snapshots ps where ps.promotion_id=p.id and ps.source_fingerprint=private.promotion_source_fingerprint(p.target_type,p.target_id)))
$$;

-- Read-only opening: no submission, approval, order, or debit.
create function public.get_direct_post_boost_offer(p_status_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.statuses; p public.promotions; r private.commercial_resources; result jsonb;
begin
 perform private.require_commercial_user();
 select * into s from public.statuses where id=p_status_id and author_id=auth.uid();
 if not found then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 select * into p from public.promotions where owner_id=auth.uid() and target_type='post' and target_id=p_status_id and commercial_resource_id is not null;
 if p.id is not null then
  select * into r from private.commercial_resources where id=p.id;
  if p.status in('cancelled','target_removed') or r.moderation_state in('rejected','suspended','archived') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if exists(select 1 from public.visibility_entitlements e where e.resource_id=p.id and e.administrative_state<>'enabled') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 else
  if not exists(select 1 from public.communities c join public.community_advertising_permissions a on a.community_id=c.id
    where c.id=s.community_id and c.is_active and a.post_boosts_enabled
    and not exists(select 1 from public.deletion_jobs j where j.kind='community' and j.target_id=c.id and j.state<>'complete')
    and exists(select 1 from public.community_members m where m.community_id=c.id and m.user_id=auth.uid())
    and not exists(select 1 from public.community_restrictions cr where cr.community_id=c.id and cr.user_id=auth.uid())) then raise exception 'AD_COMMUNITY_PERMISSION_REQUIRED'; end if;
 end if;
 if s.expires_at<=statement_timestamp() and s.retention_mode<>'no_auto_expiration'
   and not (p.id is not null and private.commercial_resource_visible(p.id)) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if not exists(select 1 from public.advertising_placements ap where ap.code='community_post_boost' and ap.sales_enabled and ap.delivery_enabled and ap.capacity>0) then raise exception 'AD_PLACEMENT_UNAVAILABLE'; end if;
 if exists(select 1 from public.promotions legacy where legacy.target_type='post' and legacy.target_id=p_status_id
  and legacy.commercial_resource_id is null and legacy.status='active' and legacy.expires_at>statement_timestamp()) then raise exception 'LEGACY_PROMOTION_ACTIVE'; end if;
 select jsonb_build_object('resourceId',p.id,'expiresAt',e.expires_at,
  'tariff',jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready and private.supplier_info_configured() and v.id is not null,
   'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)) into result
 from public.commercial_offerings f
 left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true
 left join public.visibility_entitlements e on e.resource_id=p.id
 where f.code='post_boost';
 return result;
end $$;

-- Called only after the user requests a quote. A previously submitted request is
-- converted only by this explicit action and only with its unchanged snapshot.
-- Rejected/suspended content remains blocked. No historical order is changed.
create function public.prepare_direct_post_boost(p_status_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare offer jsonb; prepared jsonb; p public.promotions; r private.commercial_resources;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=auth.uid() for no key update;
 offer:=public.get_direct_post_boost_offer(p_status_id);
 if (offer->'tariff'->>'salesEnabled')::boolean is distinct from true then raise exception 'COMMERCIAL_SALES_PAUSED'; end if;
 prepared:=public.prepare_commercial_promotion('post',p_status_id);
 select * into r from private.commercial_resources where id=(prepared->>'resourceId')::uuid for update;
 select * into p from public.promotions where id=r.id for update;
 if not private.commercial_promotion_source_eligible(p) or p.status in('cancelled','target_removed') then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if r.moderation_state in('rejected','suspended','archived') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 if r.moderation_state='submitted' then
  update private.commercial_resources set moderation_state='approved',approved_revision=content_revision where id=r.id;
  update public.promotions set status='approved' where id=p.id and duration_days=0;
  insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
   values(auth.uid(),r.id,'approve_direct_post_boost','Contratação direta solicitada pelo autor; elegibilidade automática validada');
 end if;
 return jsonb_build_object('resourceId',r.id,'expiresAt',offer->'expiresAt','tariff',offer->'tariff');
end $$;

create or replace function private.commercial_promotion_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.promotions; s public.statuses;
begin
 select * into p from public.promotions where commercial_resource_id=new.resource_id;
 if not found then return new; end if;
 if tg_op='UPDATE' and (old.status<>'quoted' or new.status<>'fulfilled') then return new; end if;
 perform 1 from public.communities where id=p.community_id for share;
 if p.target_type='post' then
  select * into s from public.statuses where id=p.target_id for share;
  if s.id is null then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
  if p.commercial_resource_id is not null and not exists(select 1 from public.advertising_placements ap where ap.code='community_post_boost' and ap.sales_enabled and ap.delivery_enabled and ap.capacity>0) then raise exception 'AD_PLACEMENT_UNAVAILABLE'; end if;
  if s.expires_at<=statement_timestamp() and s.retention_mode<>'no_auto_expiration'
   and not private.commercial_resource_visible(p.id) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if p.status in('cancelled','target_removed') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 return new;
end $$;

revoke all on function public.get_direct_post_boost_offer(uuid),public.prepare_direct_post_boost(uuid) from public,anon,service_role;
grant execute on function public.get_direct_post_boost_offer(uuid),public.prepare_direct_post_boost(uuid) to authenticated;
notify pgrst,'reload schema';
