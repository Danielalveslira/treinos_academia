-- Fix (parallel investigation, PR144 follow-up): a direct post boost whose underlying
-- publication outlived its normal 24h retention window before payment was completed
-- raised the same generic 'PROMOTION_SOURCE_CHANGED' as an actually-edited publication,
-- leaving the admin with no way to tell "this content changed" apart from "this simply
-- expired before you paid" -- and PromoteDialog.jsx's post branch had no retry affordance
-- for either case. This gives the expiry-specific branch its own error code
-- (PROMOTION_SOURCE_EXPIRED) so the client can show an accurate message; the actual
-- eligibility/content-change check (commercial_promotion_source_eligible) keeps raising
-- PROMOTION_SOURCE_CHANGED exactly as before. No condition, lock order, or gate changes --
-- only which exception name a condition that already existed raises.
set local lock_timeout='5s';

create or replace function public.get_direct_post_boost_offer(p_status_id uuid) returns jsonb
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
   and not (p.id is not null and private.commercial_resource_visible(p.id)) then raise exception 'PROMOTION_SOURCE_EXPIRED'; end if;
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
   and not private.commercial_resource_visible(p.id) then raise exception 'PROMOTION_SOURCE_EXPIRED'; end if;
 end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if p.status in('cancelled','target_removed') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 return new;
end $$;
