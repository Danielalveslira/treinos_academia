set local lock_timeout='5s';
-- Community badges use the same eligibility as paid discovery, not denormalized flags.
create function private.community_advertising_until(p_community uuid) returns timestamptz
language sql stable security definer set search_path='' as $$
 select max(p.expires_at) from public.promotions p where coalesce(public.has_app_access(),false)
 and p.target_type='community' and p.target_id=p_community and p.status='active' and p.cancelled_at is null
 and p.started_at<=statement_timestamp() and p.expires_at>statement_timestamp()
 and (p.commercial_resource_id is null or (private.commercial_resource_visible(p.id) and private.commercial_promotion_source_eligible(p)
 and exists(select 1 from public.advertising_placements ap where ap.code='community_discovery_boost' and ap.delivery_enabled)))
$$;
revoke all on function private.community_advertising_until(uuid) from public,anon,service_role;
grant execute on function private.community_advertising_until(uuid) to authenticated;
create view public.communities_with_promotions with(security_invoker=true) as
 select c.*,private.community_advertising_until(c.id) as verified_promoted_until from public.communities c;
revoke all on public.communities_with_promotions from public,anon,authenticated,service_role;
grant select on public.communities_with_promotions to authenticated;
