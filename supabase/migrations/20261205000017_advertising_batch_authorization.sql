set local lock_timeout='5s';
-- Same access rule, evaluated once within the statement snapshot. The inherited
-- row-by-row session gate dominated list latency even after batching promotion.
alter policy communities_select on public.communities
 using ((select public.has_app_access()));
-- Evaluate paid community eligibility once per query, not once per organic row.
create function private.community_advertising_windows()
returns table(community_id uuid, expires_at timestamptz)
language sql stable security definer set search_path='' as $$
 select p.target_id,max(p.expires_at) from public.promotions p
 where coalesce(public.has_app_access(),false) and p.target_type='community'
 and p.status='active' and p.cancelled_at is null
 and p.started_at<=statement_timestamp() and p.expires_at>statement_timestamp()
 and (p.commercial_resource_id is null or (private.commercial_resource_visible(p.id)
 and private.commercial_promotion_source_eligible(p)
 and exists(select 1 from public.advertising_placements ap
 where ap.code='community_discovery_boost' and ap.delivery_enabled)))
 group by p.target_id
$$;
revoke all on function private.community_advertising_windows() from public,anon,service_role;
grant execute on function private.community_advertising_windows() to authenticated;
create or replace view public.communities_with_promotions with(security_invoker=true) as
 with paid as materialized(select * from private.community_advertising_windows())
 select c.*,paid.expires_at as verified_promoted_until from public.communities c
 left join paid on paid.community_id=c.id;
drop function private.community_advertising_until(uuid);

-- Bounded batch through the original RLS views. Only requested, readable sources
-- are authorized; no client clock, top-six assumption or private-content bypass.
create function public.get_advertising_promotion_authorizations(
 p_community_ids uuid[] default '{}',p_status_ids uuid[] default '{}') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if cardinality(p_community_ids)>200 or cardinality(p_status_ids)>1000 then
  raise exception 'AD_AUTHORIZATION_BATCH_TOO_LARGE';
 end if;
 with communities as materialized(
  select id,verified_promoted_until until_at from public.communities_with_promotions
  where id=any(p_community_ids) and verified_promoted_until>statement_timestamp()
  and coalesce(public.has_app_access(),false)
 ), posts as materialized(
  select id,verified_promoted_until until_at from public.status_publications
  where id=any(p_status_ids) and verified_promoted_until>statement_timestamp()
  and coalesce(public.has_app_access(),false)
 )
 select jsonb_build_object('community_ids',coalesce((select jsonb_agg(id) from communities),'[]'),
 'status_ids',coalesce((select jsonb_agg(id) from posts),'[]'),
 'expires_at',(select min(until_at) from (select until_at from communities union all select until_at from posts) windows),
 'server_time',statement_timestamp()) into result;
 return result;
end $$;
revoke all on function public.get_advertising_promotion_authorizations(uuid[],uuid[]) from public,anon,service_role;
grant execute on function public.get_advertising_promotion_authorizations(uuid[],uuid[]) to authenticated;

-- Equivalent paid posts share opportunities rather than permanently preferring
-- the six earliest expirations. The original publication RLS remains in force.
create function public.list_commercial_featured_statuses(p_community uuid)
returns setof public.status_publications
language sql stable security invoker set search_path='' as $$
 select s.* from public.status_publications s
 where s.community_id=p_community and s.verified_promoted_until>statement_timestamp()
 and coalesce(public.has_app_access(),false)
 order by random() limit 6
$$;
revoke all on function public.list_commercial_featured_statuses(uuid) from public,anon,service_role;
grant execute on function public.list_commercial_featured_statuses(uuid) to authenticated;
