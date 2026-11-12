set local lock_timeout='5s';
set local statement_timeout='30s';

-- Institutional inventory has explicit routes. Existing legacy scopes are copied once;
-- no commercial resource, reservation, order or balance is changed.
create table private.institutional_ad_state (
 ad_id uuid primary key references public.sponsored_ads(id) on delete cascade,
 active boolean not null default false,
 activated_at timestamptz,
 revision bigint not null default 1,
 creation_payload jsonb not null default '{}'
);
create table private.institutional_ad_scopes (
 ad_id uuid not null references private.institutional_ad_state(ad_id) on delete cascade,
 placement_code text not null references public.advertising_placements(code),
 context_id uuid not null,
 primary key(ad_id,placement_code,context_id)
);
create index institutional_ad_scopes_lookup on private.institutional_ad_scopes(placement_code,context_id,ad_id);
alter table private.institutional_ad_state enable row level security;
alter table private.institutional_ad_scopes enable row level security;
revoke all on private.institutional_ad_state,private.institutional_ad_scopes from public,anon,authenticated,service_role;

insert into private.institutional_ad_state(ad_id,active,activated_at)
 select id,true,created_at from public.sponsored_ads where commercial_resource_id is null;
insert into private.institutional_ad_scopes(ad_id,placement_code,context_id)
 select id,'home_banner','00000000-0000-0000-0000-000000000000'::uuid
 from public.sponsored_ads where commercial_resource_id is null and is_global and 'banner'=any(display_mode);
insert into private.institutional_ad_scopes(ad_id,placement_code,context_id)
 select distinct a.id,p.code,c.id from public.sponsored_ads a
 cross join lateral unnest(a.community_ids) c(id)
 join public.advertising_placements p on p.surface='community' and p.content_type=any(a.display_mode)
 where a.commercial_resource_id is null;

-- Keep old direct writes blocked, including edits/deletes that otherwise bypass the
-- new capacity and audit checks. Managed commercial RPCs execute as their owner.
create function private.guard_institutional_ad_write() returns trigger
language plpgsql set search_path='' as $$
begin
 if current_user not in ('postgres','supabase_admin') and
    (case when tg_op='INSERT' then new.commercial_resource_id is null
          when tg_op='DELETE' then old.commercial_resource_id is null
          else old.commercial_resource_id is null or new.commercial_resource_id is null end) then
   raise exception 'INSTITUTIONAL_AD_RPC_REQUIRED' using errcode='42501';
 end if;
 return case when tg_op='DELETE' then old else new end;
end $$;
create trigger guard_institutional_ad_write before insert or update or delete on public.sponsored_ads
 for each row execute function private.guard_institutional_ad_write();
revoke all on function private.guard_institutional_ad_write() from public,anon,authenticated,service_role;

-- Privileged legacy imports and SQL fixtures keep their historical scope.
create function private.capture_privileged_legacy_ad() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.commercial_resource_id is not null then return null; end if;
 insert into private.institutional_ad_state(ad_id,active,activated_at)
 values(new.id,true,new.created_at) on conflict do nothing;
 if new.is_global and 'banner'=any(new.display_mode) then
  insert into private.institutional_ad_scopes values(new.id,'home_banner','00000000-0000-0000-0000-000000000000'::uuid)
  on conflict do nothing;
 end if;
 insert into private.institutional_ad_scopes(ad_id,placement_code,context_id)
 select distinct new.id,p.code,c.id from unnest(new.community_ids)c(id)
 join public.advertising_placements p on p.surface='community' and p.content_type=any(new.display_mode)
 on conflict do nothing;
 return null;
end $$;
create trigger capture_privileged_legacy_ad after insert on public.sponsored_ads
 for each row execute function private.capture_privileged_legacy_ad();
revoke all on function private.capture_privileged_legacy_ad() from public,anon,authenticated,service_role;

create or replace function public.enforce_sponsored_ad_caps() returns trigger
language plpgsql set search_path='' as $$
begin
 if new.commercial_resource_id is not null then return new; end if;
 if current_user in('postgres','supabase_admin') then return new; end if;
 if tg_op='INSERT' then raise exception 'USE_ADVERTISING_CAMPAIGN_FLOW'; end if;
 raise exception 'INSTITUTIONAL_AD_RPC_REQUIRED' using errcode='42501';
end $$;

create function private.institutional_ad_eligible(p_ad uuid,p_code text,p_context uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.institutional_ad_state s
 join private.institutional_ad_scopes sc on sc.ad_id=s.ad_id
 join public.sponsored_ads a on a.id=s.ad_id
 join public.advertising_placements p on p.code=sc.placement_code
 where s.ad_id=p_ad and s.active and a.commercial_resource_id is null
 and (a.expires_at is null or a.expires_at>statement_timestamp())
 and p.delivery_enabled and sc.placement_code=p_code
 and sc.context_id=coalesce(p_context,'00000000-0000-0000-0000-000000000000'::uuid))
$$;
revoke all on function private.institutional_ad_eligible(uuid,text,uuid) from public,anon,authenticated,service_role;

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
 select sc.ad_id from private.institutional_ad_scopes sc
 join private.institutional_ad_state s on s.ad_id=sc.ad_id
 join public.sponsored_ads a on a.id=sc.ad_id
 where sc.placement_code=p.code and sc.context_id=coalesce(p_context,'00000000-0000-0000-0000-000000000000'::uuid)
 and s.active and p.delivery_enabled and a.commercial_resource_id is null
 and (a.expires_at is null or a.expires_at>statement_timestamp())
 ), eligible as (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.media_id,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end expires_at,a.is_global,array[p.content_type] display_mode,statement_timestamp() as server_time
 from candidates c join public.sponsored_ads a on a.id=c.id left join public.visibility_entitlements e on e.resource_id=a.id
 where a.commercial_resource_id is null or private.advertising_eligible(a.id,p.code,p_context)
 ) select jsonb_agg(to_jsonb(x)) from (
 select *,(select count(*) from eligible) as eligible_total from eligible order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;

create or replace function private.advertising_peak(p_code text,p_context uuid,p_start timestamptz,p_end timestamptz) returns integer
language sql stable security definer set search_path='' as $$
 with windows as (
 select greatest(r.starts_at,p_start) s,least(r.expires_at,p_end) e
 from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where r.placement_code=p_code and r.context_id=p_context and o.status='fulfilled' and r.starts_at<p_end and r.expires_at>p_start
 union all
 select greatest(s.activated_at,p_start),least(coalesce(a.expires_at,'infinity'::timestamptz),p_end)
 from private.institutional_ad_scopes sc join private.institutional_ad_state s on s.ad_id=sc.ad_id
 join public.sponsored_ads a on a.id=sc.ad_id
 where sc.placement_code=p_code and sc.context_id=p_context and s.active and s.activated_at<p_end
 and coalesce(a.expires_at,'infinity'::timestamptz)>p_start
 ),changes as(select s t,1 delta from windows union all select e,-1 from windows),
 sums as(select sum(sum(delta)) over(order by t) n from changes group by t)
 select coalesce(max(n),0)::integer from sums
$$;

create function public.admin_list_institutional_ads() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
 select a.*,s.active,s.revision,
 (coalesce(s.active,false) and (a.expires_at is null or a.expires_at>statement_timestamp())
 and exists(select 1 from private.institutional_ad_scopes sc where sc.ad_id=a.id)
 and not exists(select 1 from private.institutional_ad_scopes sc join public.advertising_placements p on p.code=sc.placement_code
 where sc.ad_id=a.id and not p.delivery_enabled)) delivering,
 (a.commercial_resource_id is null and not coalesce(s.active,false)
 and not exists(select 1 from public.sponsored_ad_daily_stats st where st.ad_id=a.id)) deletable,
 coalesce((select jsonb_agg(jsonb_build_object('code',sc.placement_code,'contextId',nullif(sc.context_id,'00000000-0000-0000-0000-000000000000'::uuid)) order by sc.placement_code,sc.context_id)
 from private.institutional_ad_scopes sc where sc.ad_id=a.id),'[]'::jsonb) placements
 from public.sponsored_ads a left join private.institutional_ad_state s on s.ad_id=a.id
 order by a.created_at desc limit 200)x),'[]'::jsonb);
end $$;
revoke all on function public.admin_list_institutional_ads() from public,anon,service_role;
grant execute on function public.admin_list_institutional_ads() to authenticated;

create function private.check_institutional_capacity(p_ad uuid) returns void
language plpgsql security definer set search_path='' as $$
declare v record;
begin
 for v in select sc.placement_code,sc.context_id,p.capacity,p.delivery_enabled
 from private.institutional_ad_scopes sc join public.advertising_placements p on p.code=sc.placement_code
 where sc.ad_id=p_ad loop
  if not v.delivery_enabled then raise exception 'AD_DELIVERY_DISABLED:%',v.placement_code; end if;
  if private.advertising_peak(v.placement_code,v.context_id,statement_timestamp(),'infinity'::timestamptz)>v.capacity then
   raise exception 'AD_CAPACITY_REACHED:%',v.placement_code;
  end if;
 end loop;
end $$;
revoke all on function private.check_institutional_capacity(uuid) from public,anon,authenticated,service_role;

create function public.admin_save_institutional_ad(p_id uuid,p_revision bigint,p_payload jsonb) returns bigint
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare v_id uuid; v_row public.sponsored_ads; v_state private.institutional_ad_state;
 v_item jsonb; v_code text; v_context uuid; v_community_ids uuid[]; v_modes text[];
 v_global boolean; v_expires timestamptz; v_image text; v_cta text; v_target text; v_type text;
begin
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 if p_id is null or p_payload is null or jsonb_typeof(p_payload)<>'object'
 or p_payload - array['partnerName','title','description','imageUrl','ctaLabel','ctaType','ctaTarget','expiresAt','placements'] <> '{}'::jsonb
 or jsonb_typeof(p_payload->'placements')<>'array' or jsonb_array_length(p_payload->'placements') not between 1 and 50 then
  raise exception 'INVALID_AD'; end if;
 if jsonb_typeof(p_payload->'partnerName') is distinct from 'string' or jsonb_typeof(p_payload->'title') is distinct from 'string'
 or jsonb_typeof(p_payload->'description') not in('string','null')
 or jsonb_typeof(p_payload->'imageUrl') not in('string','null')
 or jsonb_typeof(p_payload->'ctaLabel') not in('string','null')
 or jsonb_typeof(p_payload->'ctaType') not in('string','null')
 or jsonb_typeof(p_payload->'ctaTarget') not in('string','null')
 or jsonb_typeof(p_payload->'expiresAt') not in('string','null') then raise exception 'INVALID_AD'; end if;
 if length(btrim(p_payload->>'partnerName')) not between 1 and 60
 or length(btrim(p_payload->>'title')) not between 1 and 100
 or length(coalesce(p_payload->>'description',''))>500 then raise exception 'INVALID_AD_TEXT'; end if;
 v_image:=nullif(btrim(p_payload->>'imageUrl'),'');
 if v_image is not null and (length(v_image)>500 or v_image !~ '^https://[^[:space:]@]+$') then raise exception 'INVALID_AD_IMAGE'; end if;
 v_cta:=nullif(btrim(p_payload->>'ctaLabel'),'');
 v_target:=nullif(btrim(p_payload->>'ctaTarget'),''); v_type:=nullif(btrim(p_payload->>'ctaType'),'');
 if (v_cta is null and v_target is not null) or (v_cta is not null and (length(v_cta)>30 or v_type not in('external','internal') or v_target is null or length(v_target)>300))
 or (v_cta is not null and ((v_type='external' and v_target !~ '^https://[^[:space:]@]+$') or (v_type='internal' and v_target !~ '^/([^/\\].*)?$'))) then
  raise exception 'INVALID_AD_LINK'; end if;
 if nullif(p_payload->>'expiresAt','') is not null then
  if p_payload->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}$' then
   v_expires:=(p_payload->>'expiresAt')::date + interval '1 day';
  elsif p_payload->>'expiresAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then
   v_expires:=(p_payload->>'expiresAt')::timestamptz;
  else raise exception 'INVALID_AD_EXPIRY'; end if;
  if v_expires<=statement_timestamp() then raise exception 'INVALID_AD_EXPIRY'; end if;
 end if;
 -- The placement rows are the same serialization point as paid reservations and
 -- capacity edits. Lock in catalog order before reading or changing inventory.
 perform 1 from public.advertising_placements order by code for update;
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 select * into v_row from public.sponsored_ads where id=p_id for update;
 if found then
  if v_row.commercial_resource_id is not null then raise exception 'COMMERCIAL_AD_IMMUTABLE' using errcode='42501'; end if;
  select * into v_state from private.institutional_ad_state where ad_id=p_id for update;
  if p_revision=0 and v_state.creation_payload=p_payload then return v_state.revision; end if;
  if p_revision is distinct from v_state.revision then raise exception 'AD_REVISION_CONFLICT'; end if;
 else
  if p_revision is distinct from 0 then raise exception 'AD_REVISION_CONFLICT'; end if;
 end if;
 -- Validate each requested scope before modifying the ad. A null context is
 -- allowed only on global placements; communities must still be active.
 for v_item in select value from jsonb_array_elements(p_payload->'placements') loop
  if jsonb_typeof(v_item)<>'object' or v_item-array['code','contextId']<>'{}'::jsonb
  or jsonb_typeof(v_item->'code')<>'string'
  or jsonb_typeof(v_item->'contextId') not in('string','null') then raise exception 'INVALID_AD_PLACEMENT'; end if;
  v_code:=v_item->>'code';
  if v_code not in('home_banner','progress_banner','community_banner','community_feed')
  or not exists(select 1 from public.advertising_placements where code=v_code) then raise exception 'INVALID_AD_PLACEMENT'; end if;
  if v_code in('home_banner','progress_banner') then
   if v_item->>'contextId' is not null then raise exception 'INVALID_AD_CONTEXT'; end if;
  else
   if (v_item->>'contextId') is null or (v_item->>'contextId') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_AD_CONTEXT'; end if;
   v_context:=(v_item->>'contextId')::uuid;
   if not exists(select 1 from public.communities where id=v_context and is_active) then raise exception 'INVALID_AD_CONTEXT'; end if;
  end if;
 end loop;
 if (select count(*) from (select distinct x->>'code',x->>'contextId' from jsonb_array_elements(p_payload->'placements') x)y)
 <>jsonb_array_length(p_payload->'placements') then raise exception 'DUPLICATE_AD_PLACEMENT'; end if;
 select coalesce(array_agg(distinct (x->>'contextId')::uuid) filter(where x->>'contextId' is not null),'{}'::uuid[]),
 coalesce(array_agg(distinct p.content_type),'{}'::text[]),
 bool_or(p.surface='home') into v_community_ids,v_modes,v_global
 from jsonb_array_elements(p_payload->'placements') x
 join public.advertising_placements p on p.code=x->>'code';
 if not v_global and cardinality(v_community_ids)=0 then raise exception 'INVALID_AD_PLACEMENT'; end if;
 if not ('feed'=any(v_modes)) and (nullif(p_payload->>'description','') is not null or v_image is not null) then raise exception 'AD_FEED_FIELDS_UNAVAILABLE'; end if;
 if v_row.id is null then
  insert into public.sponsored_ads(id,partner_name,title,description,image_url,cta_label,cta_type,cta_target,expires_at,community_ids,is_global,display_mode,created_by)
  values(p_id,btrim(p_payload->>'partnerName'),btrim(p_payload->>'title'),coalesce(btrim(p_payload->>'description'),''),v_image,v_cta,
   case when v_cta is null then null else v_type end,case when v_cta is null then null else v_target end,
   v_expires,v_community_ids,v_global,v_modes,auth.uid());
  insert into private.institutional_ad_state(ad_id,active,activated_at,creation_payload)
  values(p_id,false,null,p_payload)
  on conflict(ad_id) do update set active=false,activated_at=null,creation_payload=excluded.creation_payload;
 else
  update public.sponsored_ads set partner_name=btrim(p_payload->>'partnerName'),title=btrim(p_payload->>'title'),
  description=coalesce(btrim(p_payload->>'description'),''),image_url=v_image,cta_label=v_cta,
  cta_type=case when v_cta is null then null else v_type end,cta_target=case when v_cta is null then null else v_target end,
  expires_at=v_expires,community_ids=v_community_ids,is_global=v_global,display_mode=v_modes where id=p_id;
  update private.institutional_ad_state set revision=revision+1 where ad_id=p_id;
 end if;
 delete from private.institutional_ad_scopes where ad_id=p_id;
 insert into private.institutional_ad_scopes(ad_id,placement_code,context_id)
 select p_id,x->>'code',coalesce((x->>'contextId')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
 from jsonb_array_elements(p_payload->'placements') x;
 if coalesce(v_state.active,false) then perform private.check_institutional_capacity(p_id); end if;
 insert into public.admin_audit_log(admin_user_id,action,metadata)
 values(auth.uid(),case when v_row.id is null then 'institutional_ad_create' else 'institutional_ad_update' end,
 jsonb_build_object('adId',p_id,'placements',p_payload->'placements'));
 return coalesce(v_state.revision+1,1);
end $$;
revoke all on function public.admin_save_institutional_ad(uuid,bigint,jsonb) from public,anon,service_role;
grant execute on function public.admin_save_institutional_ad(uuid,bigint,jsonb) to authenticated;

create function public.admin_set_institutional_ad_active(p_id uuid,p_revision bigint,p_active boolean) returns bigint
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s private.institutional_ad_state;
begin
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 perform 1 from public.advertising_placements order by code for update;
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 if exists(select 1 from public.sponsored_ads where id=p_id and commercial_resource_id is not null) then raise exception 'COMMERCIAL_AD_IMMUTABLE' using errcode='42501'; end if;
 select * into s from private.institutional_ad_state where ad_id=p_id for update;
 if not found or p_active is null or p_revision is distinct from s.revision then raise exception 'AD_REVISION_CONFLICT'; end if;
 if s.active=p_active then return s.revision; end if;
 if p_active and exists(select 1 from public.sponsored_ads where id=p_id and expires_at<=statement_timestamp()) then raise exception 'AD_EXPIRED'; end if;
 update private.institutional_ad_state set active=p_active,activated_at=case when p_active then statement_timestamp() else null end,
 revision=revision+1 where ad_id=p_id;
 if p_active then perform private.check_institutional_capacity(p_id); end if;
 -- State changes also invalidate cached rotations.
 update public.advertising_delivery_epoch set revision=revision+1 where id;
 insert into public.admin_audit_log(admin_user_id,action,metadata)
 values(auth.uid(),case when p_active then 'institutional_ad_activate' else 'institutional_ad_suspend' end,jsonb_build_object('adId',p_id));
 return s.revision+1;
end $$;
revoke all on function public.admin_set_institutional_ad_active(uuid,bigint,boolean) from public,anon,service_role;
grant execute on function public.admin_set_institutional_ad_active(uuid,bigint,boolean) to authenticated;

create function public.admin_delete_institutional_ad(p_id uuid,p_revision bigint) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare s private.institutional_ad_state;
begin
 if not coalesce(public.is_superadmin(),false) then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED' using errcode='42501'; end if;
 perform 1 from public.advertising_placements order by code for update;
 if exists(select 1 from public.sponsored_ads where id=p_id and commercial_resource_id is not null) then raise exception 'COMMERCIAL_AD_IMMUTABLE' using errcode='42501'; end if;
 select * into s from private.institutional_ad_state where ad_id=p_id for update;
 if not found or p_revision is distinct from s.revision then raise exception 'AD_REVISION_CONFLICT'; end if;
 if s.active or exists(select 1 from public.sponsored_ad_daily_stats where ad_id=p_id) then raise exception 'AD_HAS_HISTORY'; end if;
 delete from private.institutional_ad_state where ad_id=p_id;
 delete from public.sponsored_ads where id=p_id;
 insert into public.admin_audit_log(admin_user_id,action,metadata) values(auth.uid(),'institutional_ad_delete',jsonb_build_object('adId',p_id));
end $$;
revoke all on function public.admin_delete_institutional_ad(uuid,bigint) from public,anon,service_role;
grant execute on function public.admin_delete_institutional_ad(uuid,bigint) to authenticated;

create function private.institutional_ad_readable(p_ad uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.institutional_ad_scopes sc
 join private.institutional_ad_state s on s.ad_id=sc.ad_id
 join public.advertising_placements p on p.code=sc.placement_code
 where sc.ad_id=p_ad and s.active and p.delivery_enabled
 and (p.surface='home' and auth.uid() is not null
 or p.surface='community' and public.is_community_member(sc.context_id)))
$$;
revoke all on function private.institutional_ad_readable(uuid) from public,anon,service_role;
grant execute on function private.institutional_ad_readable(uuid) to authenticated;

drop policy sponsored_ads_select on public.sponsored_ads;
create policy sponsored_ads_select on public.sponsored_ads for select using(coalesce(public.has_app_access(),false) and (
 public.is_superadmin() or
 (commercial_resource_id is null and (expires_at is null or expires_at>statement_timestamp()) and
 private.institutional_ad_readable(id))
 or (commercial_resource_id is not null and
 (private.advertising_eligible(id,'home_banner',null) or private.advertising_eligible(id,'progress_banner',null)
 or exists(select 1 from unnest(community_ids) c where public.is_community_member(c)
 and (private.advertising_eligible(id,'community_banner',c) or private.advertising_eligible(id,'community_feed',c)))))));

-- Preserve privacy, deduplication and rate limits; only route authorization changes.
create or replace function public.record_ad_events(events jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_max_events constant integer := 20;
  c_max_bytes constant integer := 8192;
  c_max_impressions constant integer := 10;
  c_max_clicks constant integer := 5;
  c_max_daily constant integer := 300;
  c_max_hourly constant integer := 100;
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_exclude_minors boolean;
  v_birth date;
  v_opted_out boolean;
  v_day date := private.ad_metrics_day(now());
  v_el jsonb;
  v_ids uuid[] := '{}';
  v_types text[] := '{}';
  v_ads uuid[] := '{}';
  v_places text[] := '{}';
  v_ctxs uuid[] := '{}';
  v_text text;
  v_place text;
  v_seen uuid[];
  v_rec record;
  v_ad record;
  v_last_ad uuid;
  v_ad_found boolean := false;
  v_member boolean;
  v_ok_ctx uuid[] := '{}';
  v_bad_ctx uuid[] := '{}';
  v_e_ids uuid[] := '{}';
  v_e_types text[] := '{}';
  v_e_ads uuid[] := '{}';
  v_e_places text[] := '{}';
  v_e_ctxs uuid[] := '{}';
  v_e_partners text[] := '{}';
  v_i integer;
  v_cnt record;
  v_daily integer;
  v_hourly integer;
  v_inserted integer;
  v_accepted integer := 0;
  v_cur_ad uuid;
  v_cur_place text;
  v_cur_ctx uuid;
  v_cur_partner text;
  v_d_imp bigint := 0;
  v_d_uniq bigint := 0;
  v_d_clk bigint := 0;
  v_d_unq bigint := 0;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select s.collection_enabled, s.exclude_minors into v_enabled, v_exclude_minors
    from public.sponsored_ad_metrics_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false, 'accepted', 0);
  end if;

  if events is null or jsonb_typeof(events) <> 'array'
     or jsonb_array_length(events) > c_max_events
     or octet_length(events::text) > c_max_bytes then
    raise exception 'INVALID_EVENTS';
  end if;
  if jsonb_array_length(events) = 0 then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  for v_el in select value from jsonb_array_elements(events) loop
    if (case when jsonb_typeof(v_el) = 'object'
         then (v_el - array['id', 'type', 'ad', 'placement', 'community']) <> '{}'::jsonb else true end)
       or jsonb_typeof(v_el -> 'id') is distinct from 'string'
       or jsonb_typeof(v_el -> 'type') is distinct from 'string'
       or jsonb_typeof(v_el -> 'ad') is distinct from 'string'
       or jsonb_typeof(v_el -> 'placement') is distinct from 'string'
       or (v_el ->> 'id') !~* c_uuid_re
       or (v_el ->> 'ad') !~* c_uuid_re
       or (v_el ->> 'type') not in ('impression', 'click')
       or (v_el ->> 'placement') not in ('home_banner', 'community_banner', 'community_feed', 'progress_banner') then
      raise exception 'INVALID_EVENTS';
    end if;
    v_place := v_el ->> 'placement';
    if v_place in ('home_banner', 'progress_banner') then
      -- Nem Home nem Progresso têm comunidade: ausente ou null; qualquer outro valor é
      -- tentativa de falsificar contexto.
      if v_el ? 'community' and jsonb_typeof(v_el -> 'community') <> 'null' then
        raise exception 'INVALID_EVENTS';
      end if;
      v_ctxs := v_ctxs || c_nil;
    else
      v_text := v_el ->> 'community';
      if jsonb_typeof(v_el -> 'community') is distinct from 'string' or v_text !~* c_uuid_re
         or v_text::uuid = c_nil then
        raise exception 'INVALID_EVENTS';
      end if;
      v_ctxs := v_ctxs || v_text::uuid;
    end if;
    v_ids := v_ids || (v_el ->> 'id')::uuid;
    v_types := v_types || (v_el ->> 'type');
    v_ads := v_ads || (v_el ->> 'ad')::uuid;
    v_places := v_places || v_place;
  end loop;

  select coalesce(array_agg(m.event_id), '{}') into v_seen
    from public.sponsored_ad_event_marks m where m.user_id = v_uid and m.event_id = any (v_ids);
  if not exists (select 1 from unnest(v_ids) i where i <> all (v_seen)) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;
  if v_daily >= c_max_daily or v_hourly >= c_max_hourly then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  if not coalesce(public.has_app_access(), false) or coalesce(public.is_superadmin(), false) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  select u.data_nascimento, exists (select 1 from public.sponsored_ad_metrics_opt_outs o where o.user_id = u.id)
    into v_birth, v_opted_out
    from public.users u where u.id = v_uid;
  if coalesce(v_opted_out, false)
     or (coalesce(v_exclude_minors, true) and (v_birth is null or extract(year from age(now(), v_birth)) < 18)) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  for v_rec in
    select t.id, t.type, t.ad, t.placement, t.ctx
      from unnest(v_ids, v_types, v_ads, v_places, v_ctxs) as t(id, type, ad, placement, ctx)
     order by t.ad, t.placement, t.ctx, (t.type = 'click'), t.id
  loop
    continue when v_rec.id = any (v_seen);

    if v_last_ad is distinct from v_rec.ad then
      select a.partner_name, a.display_mode, a.is_global, a.community_ids, a.expires_at, a.commercial_resource_id into v_ad
        from public.sponsored_ads a where a.id = v_rec.ad;
      v_ad_found := found;
      v_last_ad := v_rec.ad;
    end if;
    continue when exists(select 1 from public.sponsored_ads ma where ma.id=v_rec.ad and ma.commercial_resource_id is not null)
      and (not private.advertising_eligible(v_rec.ad,v_rec.placement,v_rec.ctx)
        or exists(select 1 from public.advertiser_campaigns ac join public.advertiser_members m on m.account_id=ac.account_id
          where ac.ad_id=v_rec.ad and m.user_id=v_uid and m.revoked_at is null));
    continue when not v_ad_found
      or (v_ad.expires_at is not null and v_ad.expires_at <= now());
    -- A coleta também respeita o bloqueio administrativo para anúncios legados.
    continue when not exists (
      select 1 from public.advertising_placements ap
       where ap.code = v_rec.placement and ap.delivery_enabled
    );

    if v_ad.commercial_resource_id is null then
      continue when not private.institutional_ad_eligible(v_rec.ad,v_rec.placement,nullif(v_rec.ctx,c_nil));
    end if;
    if v_rec.placement in ('community_banner','community_feed') then
      if v_rec.ctx = any (v_bad_ctx) then continue; end if;
      if not (v_rec.ctx = any (v_ok_ctx)) then
        v_member := coalesce(public.is_community_member(v_rec.ctx), false);
        if v_member then v_ok_ctx := v_ok_ctx || v_rec.ctx; else v_bad_ctx := v_bad_ctx || v_rec.ctx; continue; end if;
      end if;
    end if;

    v_e_ids := v_e_ids || v_rec.id;
    v_e_types := v_e_types || v_rec.type;
    v_e_ads := v_e_ads || v_rec.ad;
    v_e_places := v_e_places || v_rec.placement;
    v_e_ctxs := v_e_ctxs || v_rec.ctx;
    v_e_partners := v_e_partners || v_ad.partner_name;
  end loop;

  if cardinality(v_e_ids) = 0 then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended('record_ad_events:' || v_uid::text, 0));

  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;

  for v_i in 1 .. cardinality(v_e_ids) loop
    if v_cur_ad is not null
       and (v_cur_ad, v_cur_place, v_cur_ctx) is distinct from (v_e_ads[v_i], v_e_places[v_i], v_e_ctxs[v_i]) then
      insert into public.sponsored_ad_daily_stats as s
        (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
      values (v_day, v_cur_ad, v_cur_place, v_cur_ctx, v_cur_partner, v_d_imp, v_d_uniq, v_d_clk, v_d_unq)
      on conflict (day, ad_id, placement, context_id) do update
        set visible_impressions = s.visible_impressions + excluded.visible_impressions,
            unique_viewers = s.unique_viewers + excluded.unique_viewers,
            clicks = s.clicks + excluded.clicks,
            unqualified_clicks = s.unqualified_clicks + excluded.unqualified_clicks,
            updated_at = now();
      v_cur_ad := null; v_d_imp := 0; v_d_uniq := 0; v_d_clk := 0; v_d_unq := 0;
    end if;

    exit when v_daily >= c_max_daily or v_hourly >= c_max_hourly;

    select count(*) filter (where m.kind = 'impression' and m.day = v_day) as imp_today,
           count(*) filter (where m.kind = 'impression') as imp_any,
           count(*) filter (where m.kind = 'click' and m.day = v_day) as clk_today
      into v_cnt
      from public.sponsored_ad_event_marks m
     where m.user_id = v_uid and m.ad_id = v_e_ads[v_i] and m.placement = v_e_places[v_i]
       and m.context_id = v_e_ctxs[v_i];

    if v_e_types[v_i] = 'impression' then
      continue when v_cnt.imp_today >= c_max_impressions;
    else
      continue when v_cnt.clk_today >= c_max_clicks;
    end if;

    insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
    values (v_uid, v_e_ids[v_i], v_e_types[v_i], v_day, v_e_ads[v_i], v_e_places[v_i], v_e_ctxs[v_i])
    on conflict (user_id, event_id) do nothing;
    get diagnostics v_inserted = row_count;
    continue when v_inserted = 0;

    v_daily := v_daily + 1;
    v_hourly := v_hourly + 1;
    v_accepted := v_accepted + 1;
    v_cur_ad := v_e_ads[v_i]; v_cur_place := v_e_places[v_i]; v_cur_ctx := v_e_ctxs[v_i]; v_cur_partner := v_e_partners[v_i];
    if v_e_types[v_i] = 'impression' then
      v_d_imp := v_d_imp + 1;
      if v_cnt.imp_today = 0 then v_d_uniq := v_d_uniq + 1; end if;
    else
      v_d_clk := v_d_clk + 1;
      if v_cnt.imp_any = 0 then v_d_unq := v_d_unq + 1; end if;
    end if;
  end loop;

  if v_cur_ad is not null then
    insert into public.sponsored_ad_daily_stats as s
      (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
    values (v_day, v_cur_ad, v_cur_place, v_cur_ctx, v_cur_partner, v_d_imp, v_d_uniq, v_d_clk, v_d_unq)
    on conflict (day, ad_id, placement, context_id) do update
      set visible_impressions = s.visible_impressions + excluded.visible_impressions,
          unique_viewers = s.unique_viewers + excluded.unique_viewers,
          clicks = s.clicks + excluded.clicks,
          unqualified_clicks = s.unqualified_clicks + excluded.unqualified_clicks,
          updated_at = now();
  end if;

  return jsonb_build_object('enabled', true, 'accepted', v_accepted);
end;
$$;
