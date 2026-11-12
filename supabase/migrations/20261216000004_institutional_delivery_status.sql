set local lock_timeout='5s';
set local statement_timeout='30s';

-- The status describes eligibility for delivery, not recorded impressions.
-- A community scope is available only while its community remains active.
create or replace function public.admin_list_institutional_ads() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
 select a.*,s.active,s.revision,
 case
  when a.commercial_resource_id is not null then null
  when a.expires_at is not null and a.expires_at<=statement_timestamp() then 'expired'
  when not coalesce(s.active,false) then 'suspended'
  when coalesce(availability.available,0)=0 then 'paused'
  when availability.available=availability.total then 'delivering'
  else 'partial'
 end delivery_status,
 (a.commercial_resource_id is null and not coalesce(s.active,false)
 and not exists(select 1 from public.sponsored_ad_daily_stats st where st.ad_id=a.id)) deletable,
 coalesce((select jsonb_agg(jsonb_build_object('code',sc.placement_code,'contextId',nullif(sc.context_id,'00000000-0000-0000-0000-000000000000'::uuid)) order by sc.placement_code,sc.context_id)
 from private.institutional_ad_scopes sc where sc.ad_id=a.id),'[]'::jsonb) placements
 from public.sponsored_ads a
 left join private.institutional_ad_state s on s.ad_id=a.id
 left join lateral (
  select count(*)::integer total,
   count(*) filter(where p.delivery_enabled and
    (p.surface='home' or (p.surface='community' and c.is_active)))::integer available
  from private.institutional_ad_scopes sc
  join public.advertising_placements p on p.code=sc.placement_code
  left join public.communities c on c.id=sc.context_id and p.surface='community'
  where sc.ad_id=a.id
 ) availability on true
 order by a.created_at desc limit 200)x),'[]'::jsonb);
end $$;
