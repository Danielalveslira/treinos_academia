set local lock_timeout='5s';
-- Editorial evidence is immutable; it never becomes public through campaign reads.
create table private.advertising_revisions (
 ad_id uuid not null references public.sponsored_ads(id),
 version bigint not null,
 title text not null,
 description text not null,
 destination text not null,
 media_id uuid,
 submitted_at timestamptz not null default clock_timestamp(),
 primary key(ad_id,version),
 foreign key(media_id,ad_id) references public.storefront_media(id,storefront_id)
);
alter table private.advertising_revisions enable row level security;
revoke all on private.advertising_revisions from public,anon,authenticated,service_role;
insert into private.advertising_revisions(ad_id,version,title,description,destination,media_id)
 select d.ad_id,r.approved_revision,a.title,a.description,a.cta_target,a.media_id
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.sponsored_ads a on a.id=d.ad_id where r.approved_revision is not null;
create trigger advertising_revision_immutable before update or delete on private.advertising_revisions for each row execute function private.commercial_immutable();
create function private.snapshot_advertising_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare current_draft private.advertising_drafts;
begin
 select * into current_draft from private.advertising_drafts where ad_id=new.ad_id;
 if new.state='submitted' and (old.state is distinct from new.state or old.version<>new.version) then
 insert into private.advertising_revisions(ad_id,version,title,description,destination,media_id)
 values(new.ad_id,new.version,new.title,new.description,new.destination,current_draft.media_id) on conflict do nothing;
 end if;
 return null;
end $$;
-- Media is updated by the wrapper in the same transaction after the editorial call,
-- so snapshot after the full statement through a deferred constraint trigger.
create constraint trigger advertising_revision_snapshot after update on private.advertising_drafts
 deferrable initially deferred for each row execute function private.snapshot_advertising_revision();
revoke all on function private.snapshot_advertising_revision() from public,anon,authenticated,service_role;
create function public.get_advertising_revisions(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid;
begin
 if public.is_superadmin() then perform private.require_evocash_admin(); else
 select account_id into account from private.advertising_drafts where ad_id=p_id;
 perform private.require_advertising_editor(account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by version desc) from(select * from private.advertising_revisions where ad_id=p_id order by version desc limit 20)x),'[]'::jsonb);
end $$;
create function public.archive_advertising_campaign(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare d private.advertising_drafts;
begin
 select * into d from private.advertising_drafts where ad_id=p_id;
 perform private.require_advertising_editor(d.account_id);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 perform 1 from private.commercial_resources where id=p_id for update;
 update private.commercial_resources set moderation_state='archived' where id=p_id;
 update private.advertising_drafts set state='archived' where ad_id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p_id,'archive',btrim(p_reason));
end $$;
create function public.resubmit_commercial_promotion(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.promotions; fp text;
begin
 perform private.require_commercial_user();
 perform 1 from private.commercial_resources where id=p_id and owner_user_id=auth.uid() for update;
 if not found then raise exception 'PROMOTION_NOT_FOUND'; end if;
 select * into p from public.promotions where id=p_id and commercial_resource_id is not null and owner_id=auth.uid() for update;
 if not found or p.status in('cancelled','target_removed') then raise exception 'PROMOTION_NOT_FOUND'; end if;
 if exists(select 1 from private.commercial_resources where id=p_id and moderation_state in('suspended','archived')) then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 perform 1 from public.communities where id=p.community_id for share;
 if p.target_type='post' then perform 1 from public.statuses where id=p.target_id for share; end if;
 fp:=private.promotion_source_fingerprint(p.target_type,p.target_id);
 if fp is null then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 update private.promotion_editorial_snapshots set source_fingerprint=fp,review_reason=null where promotion_id=p_id;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 update private.commercial_resources set content_revision=content_revision+1,moderation_state='submitted' where id=p_id;
 update public.promotions set status=case when duration_days>0 then status else 'submitted' end where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,payload) values(auth.uid(),p_id,'resubmit_promotion','Nova análise solicitada pelo proprietário',jsonb_build_object('sourceFingerprint',fp));
end $$;
revoke all on function public.get_advertising_revisions(uuid),public.archive_advertising_campaign(uuid,text),public.resubmit_commercial_promotion(uuid) from public,anon,service_role;
grant execute on function public.get_advertising_revisions(uuid),public.archive_advertising_campaign(uuid,text),public.resubmit_commercial_promotion(uuid) to authenticated;

create or replace function private.storefront_media_referenced(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.product_storefronts where logo_media_id=p_id)
 or exists(select 1 from public.partner_products where media_id=p_id)
 or exists(select 1 from public.storefront_publications where logo_media_id=p_id)
 or exists(select 1 from public.storefront_published_products where media_id=p_id)
 or exists(select 1 from public.professional_listing_drafts where media_id=p_id)
 or exists(select 1 from public.published_professional_listings where media_id=p_id)
 or exists(select 1 from private.advertising_drafts where media_id=p_id)
 or exists(select 1 from public.sponsored_ads where media_id=p_id)
 or exists(select 1 from private.advertising_revisions where media_id=p_id)
$$;


create or replace function private.commercial_promotion_order_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare p public.promotions; ending timestamptz; source_end timestamptz;
begin
 select * into p from public.promotions where commercial_resource_id=new.resource_id;
 if not found then return new; end if;
 if tg_op='UPDATE' and (old.status<>'quoted' or new.status<>'fulfilled') then return new; end if;
 -- Resource lock precedes source locks, matching moderation/cancellation.
 perform 1 from public.communities where id=p.community_id for share;
 if p.target_type='post' then perform 1 from public.statuses where id=p.target_id for share; end if;
 if not private.commercial_promotion_source_eligible(p) then raise exception 'PROMOTION_SOURCE_CHANGED'; end if;
 if p.target_type='post' then
 select expires_at into source_end from public.statuses where id=p.target_id and retention_mode<>'no_auto_expiration';
 if tg_op='UPDATE' then ending:=new.period_end; else
 select greatest(coalesce(expires_at,clock_timestamp()),clock_timestamp()) into ending from public.visibility_entitlements where resource_id=p.id;
 ending:=coalesce(ending,clock_timestamp())+new.duration_days*interval '24 hours'; end if;
 if source_end is not null and source_end<ending then raise exception 'PROMOTION_SOURCE_EXPIRES'; end if;
 end if;
 if p.status in('cancelled','target_removed') then raise exception 'ENTITLEMENT_BLOCKED'; end if;
 return new;
end $$;
