set local lock_timeout='5s';
-- Home banner today samples exactly ONE eligible candidate (display_limit default=1), so
-- the client never sees more than it was given and "1/1" is shown even when several other
-- campaigns are equally eligible for the same instant. Bumping the sample size lets the
-- EXISTING client-side rotation engine (SponsoredAdBanner.jsx: one timer, no DB query per
-- swap) actually rotate among several eligible candidates instead of pinning to whichever
-- single row `order by random() limit 1` returned until the next full refresh. Community
-- placements are untouched: community_feed renders every returned row as its own card (not
-- client-rotated), so raising its limit would change how many ad cards appear in the feed,
-- a different UX decision this migration does not make.
update public.advertising_placements set display_limit=4 where code='home_banner';

-- Exposes the true count of candidates that passed eligibility BEFORE the random sample is
-- cut down to display_limit, so the UI can tell "1 de 4 retornados" apart from "1 de 11
-- elegíveis" instead of treating the sample size as the total. Computed once, in the same
-- query, over the already-materialized `eligible` set -- no extra round trip and no change
-- to which rows are eligible or how the random sample is drawn.
create or replace function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements; begin
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
 ), eligible as (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.media_id,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end expires_at,a.is_global,array[p.content_type] display_mode,statement_timestamp() as server_time
 from candidates c join public.sponsored_ads a on a.id=c.id left join public.visibility_entitlements e on e.resource_id=a.id
 where a.commercial_resource_id is null or private.advertising_eligible(a.id,p.code,p_context)
 ) select jsonb_agg(to_jsonb(x)) from (
 select *,(select count(*) from eligible) as eligible_total from eligible order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;
