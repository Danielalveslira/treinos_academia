set local lock_timeout='5s';
-- Resolve candidates from the interval index before checking creative eligibility.
-- Expired historical campaigns do not become the outer input to the selector.
create or replace function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements;
begin
 perform private.require_commercial_user();
 select * into p from public.advertising_placements where code=p_placement;
 if not found or p.content_type not in('banner','feed') then return '[]'; end if;
 if p.surface='home' and p_context is not null then return '[]'; end if;
 if p.surface='community' and not coalesce(public.is_community_member(p_context),false) then return '[]'; end if;
 return coalesce((with candidates as (
 select distinct o.resource_id as id from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where p.delivery_enabled and r.placement_code=p.code and r.context_id=coalesce(p_context,'00000000-0000-0000-0000-000000000000'::uuid)
 and r.starts_at<=statement_timestamp() and r.expires_at>statement_timestamp() and o.status='fulfilled'
 union all
 select a.id from public.sponsored_ads a where a.commercial_resource_id is null and (a.expires_at is null or a.expires_at>statement_timestamp())
 and p.content_type=any(a.display_mode) and ((p.surface='home' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids)))
 ) select jsonb_agg(to_jsonb(x)) from (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.media_id,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end expires_at,a.is_global,array[p.content_type] display_mode,statement_timestamp() as server_time
 from candidates c join public.sponsored_ads a on a.id=c.id left join public.visibility_entitlements e on e.resource_id=a.id
 where a.commercial_resource_id is null or private.advertising_eligible(a.id,p.code,p_context)
 order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;
-- Source/account changes also invalidate authorization. Never publish their data.
create trigger advertising_community_delivery_epoch after update of owner_id,is_active,deletion_status,name,description on public.communities for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_owner_delivery_epoch after update of account_status on public.users for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_owner_restriction_epoch after insert or update or delete on public.account_restrictions for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_community_restriction_epoch after insert or update or delete on public.community_restrictions for each statement execute function private.invalidate_advertising_delivery();
