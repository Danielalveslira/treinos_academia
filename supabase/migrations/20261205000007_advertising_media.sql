-- Reuse the protected WebP gateway, bucket, leases and cleanup from Phases 4–5.
set local lock_timeout='5s';
alter table public.sponsored_ads add column media_id uuid;
alter table private.advertising_drafts add column media_id uuid;
alter table public.sponsored_ads add foreign key(media_id,id) references public.storefront_media(id,storefront_id);
alter table private.advertising_drafts add foreign key(media_id,ad_id) references public.storefront_media(id,storefront_id);
create or replace function private.storefront_media_referenced(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.product_storefronts where logo_media_id=p_id)
 or exists(select 1 from public.partner_products where media_id=p_id)
 or exists(select 1 from public.storefront_publications where logo_media_id=p_id)
 or exists(select 1 from public.storefront_published_products where media_id=p_id)
 or exists(select 1 from public.professional_listing_drafts where media_id=p_id)
 or exists(select 1 from public.published_professional_listings where media_id=p_id)
 or exists(select 1 from private.advertising_drafts where media_id=p_id)
 or exists(select 1 from public.sponsored_ads where media_id=p_id)
$$;

-- Legacy admin deletes run as authenticated; lifecycle metadata remains private.
alter function private.note_storefront_media_use() security definer;
create trigger advertising_draft_media_use after insert or update or delete on private.advertising_drafts for each row execute function private.note_storefront_media_use();
create trigger advertising_public_media_use after insert or update or delete on public.sponsored_ads for each row execute function private.note_storefront_media_use();

alter function private.lock_commercial_editorial(uuid,text) rename to lock_commercial_editorial_before_ads;
create function private.lock_commercial_editorial(p_id uuid,p_expected text default null) returns private.commercial_resources
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; account uuid;
begin
 select account_id into account from private.advertising_drafts where ad_id=p_id;
 if not found then return private.lock_commercial_editorial_before_ads(p_id,p_expected); end if;
 perform private.require_advertising_editor(account);
 perform 1 from public.users where id=auth.uid() for no key update;
 select * into r from private.commercial_resources where id=p_id for update;
 perform private.require_advertising_editor(account);
 if p_expected is not null and p_expected<>r.offering_code then raise exception 'AD_NOT_FOUND'; end if;
 return r;
end $$;
revoke all on function private.lock_commercial_editorial(uuid,text),private.lock_commercial_editorial_before_ads(uuid,text) from public,anon,authenticated,service_role;

alter function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean) set schema private;
alter function private.edit_advertising_campaign(uuid,bigint,text,text,text,boolean) rename to edit_advertising_campaign_before_media;
revoke all on function private.edit_advertising_campaign_before_media(uuid,bigint,text,text,text,boolean) from public,anon,authenticated,service_role;
create function public.edit_advertising_campaign(p_id uuid,p_version bigint,p_title text,p_description text,p_destination text,p_submit boolean,p_media_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; result jsonb;
begin
 r:=private.lock_commercial_editorial(p_id);
 if p_media_id is not null then
 perform 1 from public.storefront_media where id=p_media_id and storefront_id=p_id and state='ready' and cleanup_token is null for update;
 if not found then raise exception 'INVALID_AD_MEDIA'; end if;
 end if;
 result:=private.edit_advertising_campaign_before_media(p_id,p_version,p_title,p_description,p_destination,p_submit);
 update private.advertising_drafts set media_id=p_media_id where ad_id=p_id;
 return result||jsonb_build_object('media_id',p_media_id);
end $$;
revoke all on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid) from public,anon,service_role;
grant execute on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid) to authenticated;

create function private.publish_advertising_media() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.state='approved' and new.approved_version=new.version then
 update public.sponsored_ads set media_id=new.media_id where id=new.ad_id;
 end if;
 return null;
end $$;
create trigger publish_advertising_media after update on private.advertising_drafts for each row execute function private.publish_advertising_media();
revoke all on function private.publish_advertising_media() from public,anon,authenticated,service_role;

alter function public.authorize_storefront_media(uuid) set schema private;
alter function private.authorize_storefront_media(uuid) rename to authorize_storefront_media_before_ads;
revoke all on function private.authorize_storefront_media_before_ads(uuid) from public,anon,authenticated,service_role;
create function public.authorize_storefront_media(p_media_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
 path:=private.authorize_storefront_media_before_ads(p_media_id);
 if path is not null then return path; end if;
 if not coalesce(public.has_app_access(),false) then return null; end if;
 select m.storage_path into path from public.storefront_media m
 where m.id=p_media_id and m.state='ready' and (
 exists(select 1 from private.advertising_drafts d join public.advertiser_members am on am.account_id=d.account_id
 join public.advertiser_accounts ac on ac.id=d.account_id
 where d.ad_id=m.storefront_id and ac.active and am.user_id=auth.uid() and am.revoked_at is null and am.permission in('manager','owner'))
 or exists(select 1 from public.sponsored_ads a where a.id=m.storefront_id and a.media_id=m.id and (
 private.advertising_eligible(a.id,'home_banner',null) or exists(select 1 from unnest(a.community_ids)c
 where public.is_community_member(c) and (private.advertising_eligible(a.id,'community_banner',c) or private.advertising_eligible(a.id,'community_feed',c))))));
 return path;
end $$;
revoke all on function public.authorize_storefront_media(uuid) from public,service_role;
grant execute on function public.authorize_storefront_media(uuid) to anon,authenticated;

create or replace function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements;
begin
 perform private.require_commercial_user();
 select * into p from public.advertising_placements where code=p_placement;
 if not found then return '[]'; end if;
 if p.surface='community' and not coalesce(public.is_community_member(p_context),false) then return '[]'; end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.media_id,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end as expires_at,
 a.is_global,array[p.content_type] as display_mode
 from public.sponsored_ads a left join public.visibility_entitlements e on e.resource_id=a.id
 where (a.commercial_resource_id is not null and p.delivery_enabled and private.advertising_eligible(a.id,p_placement,p_context))
 or (a.commercial_resource_id is null and (a.expires_at is null or a.expires_at>statement_timestamp()) and p.content_type=any(a.display_mode)
 and ((p.surface='home' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids))))
 order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;

create index advertising_inventory_surface_idx on private.advertising_resource_inventory(placement_code,context_id,resource_id);
create index advertising_drafts_account_page_idx on private.advertising_drafts(account_id,ad_id desc);
