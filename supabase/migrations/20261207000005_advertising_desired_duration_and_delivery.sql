set local lock_timeout='5s';
-- UX intention only: never reserves inventory, never starts a contract period.
-- Cross-device by design (the draft row, not sessionStorage), same sanity bound as
-- commercial price versions (max_days<=3650).
alter table private.advertising_drafts add column desired_duration_days integer check(desired_duration_days is null or desired_duration_days between 1 and 3650);

alter function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid) set schema private;
alter function private.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid) rename to edit_advertising_campaign_before_duration;
revoke all on function private.edit_advertising_campaign_before_duration(uuid,bigint,text,text,text,boolean,uuid) from public,anon,authenticated,service_role;
create function public.edit_advertising_campaign(p_id uuid,p_version bigint,p_title text,p_description text,p_destination text,p_submit boolean,p_media_id uuid default null,p_desired_days integer default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare result jsonb;
begin
 if p_desired_days is not null and p_desired_days not between 1 and 3650 then raise exception 'INVALID_DURATION'; end if;
 result:=private.edit_advertising_campaign_before_duration(p_id,p_version,p_title,p_description,p_destination,p_submit,p_media_id);
 if p_desired_days is not null then
 update private.advertising_drafts set desired_duration_days=p_desired_days where ad_id=p_id;
 result:=result||jsonb_build_object('desired_duration_days',p_desired_days);
 end if;
 return result;
end $$;
revoke all on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) from public,anon,service_role;
grant execute on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) to authenticated;

-- Consolidated, per-row placement delivery signal. Reuses private.advertising_eligible
-- as-is (the same audited predicate RLS relies on: advertiser account active, placement
-- delivery_enabled, commercial_resource_visible, an active fulfilled reservation window,
-- and — for community surfaces — the community still active and still owned by the same
-- advertiser) instead of re-deriving a partial copy of those rules. Still one round trip
-- from the UI: the aggregation runs over this resource's own small inventory set.
create or replace function public.get_advertising_campaigns(p_account uuid default null,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,e.starts_at,e.expires_at,
 case when private.commercial_resource_visible(r.id) then 'active' when e.expires_at<=statement_timestamp() then 'expired' else 'private' end delivery_state,
 greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::bigint remaining_seconds,
 (a.owner_user_id=auth.uid()) as can_pay,
 (select jsonb_agg(jsonb_build_object('code',i.placement_code,'context',i.context_id)) from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placements,
 (select bool_or(private.advertising_eligible(d.ad_id,i.placement_code,i.context_id))
  from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placement_delivery_active,
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 order by d.ad_id desc limit 20)x),'[]'::jsonb);
end $$;
