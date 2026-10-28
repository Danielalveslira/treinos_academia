set local lock_timeout='5s';
create table public.advertising_delivery_epoch (
 id boolean primary key default true check(id),
 revision bigint not null default 0
);
insert into public.advertising_delivery_epoch(id) values(true);
alter table public.advertising_delivery_epoch enable row level security;
revoke all on public.advertising_delivery_epoch from public,anon,authenticated,service_role;
grant select on public.advertising_delivery_epoch to authenticated;
create policy advertising_delivery_epoch_read on public.advertising_delivery_epoch for select to authenticated using(public.has_app_access());
create function private.invalidate_advertising_delivery() returns trigger language plpgsql security definer set search_path='' as $$
begin update public.advertising_delivery_epoch set revision=revision+1 where id;return null;end $$;
-- Statement triggers coalesce writes and reveal no account, creative or finance data.
create trigger advertising_ad_delivery_epoch after insert or update or delete on public.sponsored_ads for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_resource_delivery_epoch after update on private.commercial_resources for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_entitlement_delivery_epoch after insert or update on public.visibility_entitlements for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_account_delivery_epoch after update on public.advertiser_accounts for each statement execute function private.invalidate_advertising_delivery();
create trigger advertising_placement_delivery_epoch after update on public.advertising_placements for each statement execute function private.invalidate_advertising_delivery();
revoke all on function private.invalidate_advertising_delivery() from public,anon,authenticated,service_role;
do $$begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
 alter publication supabase_realtime add table public.advertising_delivery_epoch;
 end if;
end $$;

create or replace function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements;
begin
 perform private.require_commercial_user();
 select * into p from public.advertising_placements where code=p_placement;
 if not found then return '[]'; end if;
 if p.surface='community' and not coalesce(public.is_community_member(p_context),false) then return '[]'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end as expires_at,
 a.is_global,array[p.content_type] as display_mode
 from public.sponsored_ads a left join public.visibility_entitlements e on e.resource_id=a.id
 where (a.commercial_resource_id is not null and p.delivery_enabled and private.advertising_eligible(a.id,p_placement,p_context))
 or (a.commercial_resource_id is null and (a.expires_at is null or a.expires_at>statement_timestamp()) and p.content_type=any(a.display_mode)
 and ((p.surface='home' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids))))
 order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;
-- Account for legacy commitments too; no silent removal or free capacity from an
-- administrative row that remains eligible in the same placement.
create or replace function private.advertising_peak(p_code text,p_context uuid,p_start timestamptz,p_end timestamptz) returns integer
language sql stable security definer set search_path='' as $$
 with windows as (
 select greatest(r.starts_at,p_start) s,least(r.expires_at,p_end) e
 from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where r.placement_code=p_code and r.context_id=p_context and o.status='fulfilled' and r.starts_at<p_end and r.expires_at>p_start
 union all
 select greatest(a.created_at,p_start),least(coalesce(a.expires_at,'infinity'::timestamptz),p_end)
 from public.sponsored_ads a join public.advertising_placements p on p.code=p_code
 where a.commercial_resource_id is null and a.created_at<p_end and coalesce(a.expires_at,'infinity'::timestamptz)>p_start
 and p.content_type=any(a.display_mode) and ((p.surface='home' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids)))
 ),changes as(select s t,1 delta from windows union all select e,-1 from windows),
 sums as(select sum(sum(delta)) over(order by t) n from changes group by t)
 select coalesce(max(n),0)::integer from sums
$$;
