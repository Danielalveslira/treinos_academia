set local lock_timeout='5s';
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
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 order by d.ad_id desc limit 20)x),'[]'::jsonb);
end $$;
