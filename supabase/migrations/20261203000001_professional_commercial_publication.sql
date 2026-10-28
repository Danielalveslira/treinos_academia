-- Phase 5: concrete professional/space adapters. No prices, credits or sales activation.
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Keep normalization deterministic under empty search_path in secure adapters.
create or replace function public._normalize_search_value(p_value text) returns text
language sql immutable set search_path='' as $$
 select trim(regexp_replace(lower(public.unaccent(coalesce(p_value,''))), '\s+', ' ', 'g'))
$$;

-- Reuse one relational entitlement predicate across all editorial adapters.
create view private.live_commercial_resources as
 select r.id,r.offering_code,r.owner_user_id,r.approved_revision,e.expires_at
 from private.commercial_resources r
 join public.commercial_offerings f on f.code=r.offering_code
 join public.users u on u.id=r.owner_user_id
 join public.visibility_entitlements e on e.resource_id=r.id
 where f.integration_ready and u.account_status='active'
 and r.moderation_state='approved' and r.content_revision=r.approved_revision
 and e.administrative_state='enabled' and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp()
 and not exists(select 1 from public.account_restrictions a where a.user_id=u.id and not(a.action='temporary_suspension' and a.until<=statement_timestamp()));
revoke all on private.live_commercial_resources from public,anon,authenticated,service_role;
create or replace function private.commercial_resource_visible(p_resource_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.live_commercial_resources where id=p_resource_id)
$$;
create or replace view private.live_storefronts as
 select p.*,r.expires_at from public.storefront_publications p
 join private.live_commercial_resources r on r.id=p.storefront_id
 where r.offering_code='product_storefront' and p.revision=r.approved_revision;

alter table public.professional_listings add column offering_code text generated always as
 (case kind when 'professional' then 'professional_profile' else 'establishment_profile' end) stored;
alter table public.professional_listing_drafts add column media_id uuid,
 add column address text not null default '' check(length(address)<=300),
 add column opening_hours text not null default '' check(length(opening_hours)<=500);
alter table public.published_professional_listings add column media_id uuid,
 add column address text not null default '' check(length(address)<=300),
 add column opening_hours text not null default '' check(length(opening_hours)<=500);
alter table public.professional_listing_drafts drop constraint professional_listing_drafts_review_state_check;

-- Recover interrupted legacy operations without inventing an approval or losing draft data.
update public.professional_listing_drafts set review_state='draft',publishing_operation_id=null,publishing_started_at=null where review_state='publishing';
alter table public.professional_listing_drafts add check(review_state in('draft','submitted','approved','rejected'));
-- Recover a missing legacy draft from its actual owner/snapshot. Preserve personal
-- image references on the historic snapshot, but require a protected upload for approval.
insert into public.professional_listing_drafts(listing_id,owner_id,kind,version,display_name,category_key,modality_keys,specialties,bio,city,city_key,uf,service_mode,contacts,linked_community_id,linked_community_name,based_on_published_version)
 select l.id,l.owner_id,l.kind,coalesce(p.published_version,0),p.display_name,p.category_key,coalesce(p.modality_keys,'{}'),coalesce(p.specialties,'{}'),p.bio,p.city,p.city_key,p.uf,p.service_mode,
 coalesce((select jsonb_object_agg(c->>'type',c->>'url') from jsonb_array_elements(p.public_contacts)c),'{}'),p.linked_community_id,p.linked_community_name,coalesce(p.published_version,0)
 from public.professional_listings l left join public.published_professional_listings p on p.listing_id=l.id
 where not exists(select 1 from public.professional_listing_drafts d where d.listing_id=l.id);
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,moderation_state)
 select l.id,l.offering_code,l.owner_id,greatest(1,coalesce(d.version,0),l.published_version),
 case when l.lifecycle_state='suspended' then 'suspended' else 'draft' end
 from public.professional_listings l left join public.professional_listing_drafts d on d.listing_id=l.id;
alter table public.professional_listings add unique(id,owner_id,kind),add unique(id,kind);
alter table public.professional_listing_drafts add foreign key(listing_id,owner_id,kind) references public.professional_listings(id,owner_id,kind);
alter table public.published_professional_listings add foreign key(listing_id,kind) references public.professional_listings(id,kind);
alter table public.professional_listings
 add foreign key(id,offering_code) references private.commercial_resources(id,offering_code),
 add foreign key(id,offering_code,owner_id) references private.commercial_resources(id,offering_code,owner_user_id);

create function private.professional_anchor_create() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision)
 values(new.id,case new.kind when 'professional' then 'professional_profile' else 'establishment_profile' end,new.owner_id,1);
 return new;
end $$;
create trigger professional_anchor_create before insert on public.professional_listings for each row execute function private.professional_anchor_create();
create function private.professional_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind is distinct from old.kind or new.owner_id is distinct from old.owner_id then raise exception 'LISTING_IDENTITY_IMMUTABLE';end if;
 return new;
end $$;
create trigger professional_identity_guard before update of kind,owner_id on public.professional_listings for each row execute function private.professional_identity_guard();
create function private.professional_anchor_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.offering_code in('professional_profile','establishment_profile') then
 if not exists(select 1 from public.professional_listings l where l.id=new.id and l.offering_code=new.offering_code and l.owner_id is not distinct from new.owner_user_id) and new.owner_user_id is not null then raise exception 'CONCRETE_LISTING_REQUIRED';end if;
 if new.moderation_state='approved' and new.owner_user_id is not null and not exists(select 1 from public.published_professional_listings p where p.listing_id=new.id and p.published_version=new.approved_revision) then raise exception 'APPROVED_LISTING_REQUIRED';end if;
 end if;
 return new;
end $$;
create trigger professional_anchor_guard before update on private.commercial_resources for each row execute function private.professional_anchor_guard();

-- Shared editorial lock ordering matches quote/confirm: user -> offering -> resource.
create function private.lock_commercial_editorial(p_id uuid,p_expected text default null) returns private.commercial_resources
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;v_offering text;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=auth.uid() for no key update;
 select offering_code into v_offering from private.commercial_resources where id=p_id;
 perform 1 from public.commercial_offerings f where f.code=v_offering for share;
 select * into r from private.commercial_resources where id=p_id for update;
 if not found or (p_expected is not null and r.offering_code<>p_expected) or
 (r.owner_user_id is distinct from auth.uid() and not public.is_superadmin()) or
 not ((r.offering_code='product_storefront' and exists(select 1 from public.product_storefronts where id=r.id)) or
 (r.offering_code in('professional_profile','establishment_profile') and exists(select 1 from public.professional_listings where id=r.id))) then
 if p_expected='product_storefront' then raise exception 'STOREFRONT_NOT_FOUND';else raise exception 'LISTING_NOT_FOUND';end if;end if;
 perform private.require_commercial_user();
 if not public.is_superadmin() and(select count(*) from public.commercial_order_events where actor_user_id=auth.uid() and offering_code=r.offering_code and occurred_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'STOREFRONT_RATE_LIMIT';end if;
 return r;
end $$;
create or replace function private.lock_storefront(p_id uuid) returns private.commercial_resources
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
begin return private.lock_commercial_editorial(p_id,'product_storefront');end $$;
create function private.check_editorial_transition(p_current text,p_draft text,p_next text,p_reason text) returns void language plpgsql set search_path='' as $$
begin
 if p_next is null or p_next not in('submitted','approved','rejected','suspended','archived','draft') then raise exception 'INVALID_EDITORIAL_STATE';end if;
 if p_next in('approved','rejected','suspended') or p_current='suspended' then
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'MODERATION_REASON_REQUIRED';end if;
 if p_current='suspended' and p_next<>'draft' then raise exception 'STOREFRONT_SUSPENDED';end if;
 if p_next in('approved','rejected') and p_draft<>'submitted' then raise exception 'CONTENT_NOT_SUBMITTED';end if;
 end if;
end $$;
create function private.apply_editorial_anchor(p_id uuid,p_state text,p_revision bigint,p_has_snapshot boolean) returns void language plpgsql set search_path='' as $$
begin
 if p_state='approved' then
 update private.commercial_resources set content_revision=p_revision,approved_revision=p_revision,moderation_state='approved' where id=p_id;
 elsif p_state in('suspended','archived') then update private.commercial_resources set moderation_state=p_state where id=p_id;
 elsif p_state='draft' or(p_state='submitted' and exists(select 1 from private.commercial_resources where id=p_id and moderation_state='archived')) then
 update private.commercial_resources set moderation_state=case when p_has_snapshot then 'approved' else 'draft' end where id=p_id and moderation_state in('suspended','archived');
 elsif not p_has_snapshot then update private.commercial_resources set moderation_state=p_state where id=p_id;
 end if;
end $$;

-- The historical name stays compatible; this is the single media pipeline for concrete leases.
alter table public.storefront_media drop constraint storefront_media_storefront_id_fkey;
alter table public.storefront_media add foreign key(storefront_id) references private.commercial_resources(id);
comment on column public.storefront_media.storefront_id is 'Legacy API name: concrete commercial resource UUID (product storefront or professional/space listing).';
alter table public.professional_listing_drafts add foreign key(media_id,listing_id) references public.storefront_media(id,storefront_id);
alter table public.published_professional_listings add foreign key(media_id,listing_id) references public.storefront_media(id,storefront_id);
create trigger listing_draft_media_use after insert or update or delete on public.professional_listing_drafts for each row execute function private.note_storefront_media_use();
create trigger listing_public_media_use after insert or update or delete on public.published_professional_listings for each row execute function private.note_storefront_media_use();
create or replace function private.storefront_media_referenced(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.product_storefronts where logo_media_id=p_id)
 or exists(select 1 from public.partner_products where media_id=p_id)
 or exists(select 1 from public.storefront_publications where logo_media_id=p_id)
 or exists(select 1 from public.storefront_published_products where media_id=p_id)
 or exists(select 1 from public.professional_listing_drafts where media_id=p_id)
 or exists(select 1 from public.published_professional_listings where media_id=p_id)
$$;
create or replace function public.allocate_storefront_media(p_id uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;mid uuid:=gen_random_uuid();path text;
begin
 r:=private.lock_commercial_editorial(p_id,case when exists(select 1 from public.product_storefronts where id=p_id) then 'product_storefront' end);
 if(select count(*) from public.storefront_media where storefront_id=p_id and created_at>clock_timestamp()-interval '1 hour')>=30 then raise exception 'MEDIA_RATE_LIMIT';end if;
 path:=p_id::text||'/'||mid::text||'.webp';
 insert into public.storefront_media(id,storefront_id,storage_path)values(mid,p_id,path);
 return jsonb_build_object('id',mid,'path',path);
end $$;
create or replace function private.media_cleanup_event(p_storefront uuid,p_action text,p_token uuid,p_payload jsonb) returns void language sql set search_path='' as $$
 insert into public.commercial_order_events(offering_code,actor_user_id,action,request_id,reason,payload)
 select r.offering_code,coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid),p_action,case when p_action<>'media_cleanup_claimed' then p_token end,'Manutenção controlada de mídia privada',p_payload||jsonb_build_object('resourceId',p_storefront,'cleanupToken',p_token) from private.commercial_resources r where r.id=p_storefront
$$;

create function private.listing_audit(p_id uuid,p_action text,p_payload jsonb default '{}',p_reason text default 'Alteração editorial pelo proprietário') returns void language sql set search_path='' as $$
 insert into public.commercial_order_events(offering_code,actor_user_id,action,reason,payload)
 select offering_code,auth.uid(),p_action,p_reason,p_payload||jsonb_build_object('listingId',p_id,'resourceId',p_id) from private.commercial_resources where id=p_id
$$;
alter table public.commercial_order_events drop constraint commercial_order_events_action_check;
alter table public.commercial_order_events add check(action in('publish_price','sales','quoted','fulfilled','renewed','suspended','resumed','revoked','reversed','storefront_created','storefront_edited','product_saved','product_archived','submitted','approved','rejected','editorial_suspended','owner_archived','limits','media_cleanup_claimed','media_cleanup_done','media_cleanup_error','legacy_associated','cleanup_configuration','listing_created','listing_edited'));

create or replace function public.create_professional_listing(p_kind text) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare l public.professional_listings;uid uuid:=auth.uid();
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=uid for no key update;
 if p_kind is null or p_kind not in('professional','space') then raise exception 'INVALID_ARGUMENT';end if;
 select * into l from public.professional_listings where owner_id=uid;
 if found then
 if l.kind<>p_kind then raise exception 'ALREADY_EXISTS';end if;
 return jsonb_build_object('listingId',l.id,'created',false);end if;
 if not exists(select 1 from public.users where id=uid and usage_profile in('professional','establishment_owner')) then raise exception 'NOT_ELIGIBLE';end if;
 insert into public.professional_listings(owner_id,kind) values(uid,p_kind) returning * into l;
 insert into public.professional_listing_drafts(listing_id,owner_id,kind)values(l.id,uid,p_kind);
 perform private.listing_audit(l.id,'listing_created');
 return jsonb_build_object('listingId',l.id,'created',true);
end $$;

create function public.save_professional_listing_draft(p_listing_id uuid,p_draft jsonb,p_revision bigint) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
<<draft_values>>
declare r private.commercial_resources;l public.professional_listings;d public.professional_listing_drafts;
 name text;bio text;city text;category text;uf text;mode text;mods text[];specialties text[];contacts jsonb;community uuid;community_name text;mid uuid;address text;hours text;url text;
begin
 r:=private.lock_commercial_editorial(p_listing_id);
 if r.offering_code not in('professional_profile','establishment_profile') then raise exception 'LISTING_NOT_FOUND';end if;
 if r.owner_user_id is distinct from auth.uid() then perform private.require_evocash_admin(true);end if;
 select * into l from public.professional_listings where id=p_listing_id;
 select * into d from public.professional_listing_drafts where listing_id=p_listing_id;
 if d.version is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_draft is null or jsonb_typeof(p_draft)<>'object' or exists(select 1 from jsonb_object_keys(p_draft) k where k not in('kind','displayName','categoryKey','modalityKeys','specialties','bio','city','uf','serviceMode','contacts','linkedCommunityId','mediaId','address','openingHours','useProfileAvatar')) then raise exception 'INVALID_ARGUMENT';end if;
 if p_draft->>'kind' is distinct from l.kind then raise exception 'KIND_IMMUTABLE';end if;
 name:=btrim(coalesce(p_draft->>'displayName',''));bio:=btrim(coalesce(p_draft->>'bio',''));city:=btrim(coalesce(p_draft->>'city',''));
 category:=coalesce(p_draft->>'categoryKey','');uf:=coalesce(p_draft->>'uf','');mode:=coalesce(p_draft->>'serviceMode','');
 if length(name)>80 then raise exception 'INVALID_DISPLAY_NAME';end if;
 if length(bio)>1500 then raise exception 'INVALID_BIO';end if;
 if length(city)>80 then raise exception 'INVALID_CITY';end if;
 if category<>'' and category not in('personal_trainer','coach','fisioterapia','nutricao','academia','box','studio','assessoria','outros') then raise exception 'INVALID_CATEGORY';end if;
 if uf<>'' and uf not in('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO') then raise exception 'INVALID_UF';end if;
 if mode<>'' and mode not in('in_person','online','hybrid') then raise exception 'INVALID_SERVICE_MODE';end if;
 if jsonb_typeof(coalesce(p_draft->'modalityKeys','[]'))<>'array' or jsonb_typeof(coalesce(p_draft->'specialties','[]'))<>'array' then raise exception 'INVALID_ARGUMENT';end if;
 select coalesce(array_agg(distinct value),'{}') into mods from jsonb_array_elements_text(coalesce(p_draft->'modalityKeys','[]'))value;
 if cardinality(mods)>5 or not mods<@array['musculacao','corrida','cross_training','funcional','ciclismo','natacao','lutas','yoga','pilates','triatlo','danca','outros'] then raise exception 'INVALID_MODALITIES';end if;
 select coalesce(array_agg(distinct btrim(value)),'{}') into specialties from jsonb_array_elements_text(coalesce(p_draft->'specialties','[]'))value;
 if cardinality(specialties)>10 or exists(select 1 from unnest(specialties)s where length(s) not between 1 and 60) then raise exception 'TOO_MANY_SPECIALTIES';end if;
 contacts:=coalesce(p_draft->'contacts','{}');
 if jsonb_typeof(contacts)<>'object' or exists(select 1 from jsonb_object_keys(contacts)k where k not in('whatsapp','instagram','website')) then raise exception 'INVALID_CONTACTS';end if;
 url:=nullif(btrim(contacts->>'whatsapp'),'');if url is not null and url !~ '^https://wa\.me/[1-9][0-9]{7,14}$' then raise exception 'INVALID_CONTACTS';end if;
 url:=nullif(btrim(contacts->>'instagram'),'');if url is not null and url !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._-]+/?$' then raise exception 'INVALID_CONTACTS';end if;
 url:=nullif(btrim(contacts->>'website'),'');if url is not null and(length(url)>300 or url !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$') then raise exception 'INVALID_CONTACTS';end if;
 community:=nullif(p_draft->>'linkedCommunityId','')::uuid;
 if community is not null then select c.name into community_name from public.communities c where c.id=community and c.owner_id=l.owner_id and c.is_active;
 if not found then raise exception 'INVALID_LINKED_COMMUNITY';end if;end if;
 mid:=nullif(p_draft->>'mediaId','')::uuid;
 if mid is not null and not exists(select 1 from public.storefront_media where id=mid and storefront_id=l.id and state='ready') then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
 address:=case when l.kind='space' then btrim(coalesce(p_draft->>'address','')) else '' end;
 hours:=case when l.kind='space' then btrim(coalesce(p_draft->>'openingHours','')) else '' end;
 if length(address)>300 or length(hours)>500 then raise exception 'INVALID_ARGUMENT';end if;
 update public.professional_listing_drafts set display_name=draft_values.name,bio=draft_values.bio,city=draft_values.city,city_key=public._normalize_search_value(draft_values.city),uf=draft_values.uf,category_key=draft_values.category,service_mode=draft_values.mode,
 modality_keys=draft_values.mods,specialties=draft_values.specialties,contacts=draft_values.contacts,linked_community_id=draft_values.community,linked_community_name=draft_values.community_name,
 media_id=draft_values.mid,address=draft_values.address,opening_hours=draft_values.hours,use_profile_avatar=false,review_state='draft',version=version+1,rejection_summary=null,updated_at=clock_timestamp() where listing_id=l.id;
 update public.professional_listings set updated_at=clock_timestamp() where id=l.id;
 perform private.listing_audit(l.id,'listing_edited',jsonb_build_object('previousRevision',d.version,'revision',d.version+1));
 return jsonb_build_object('listingId',l.id,'version',d.version+1);
end $$;
-- Fail closed for cached clients lacking CAS or still attempting direct publication.
create or replace function public.save_professional_listing_draft(p_listing_id uuid,p_draft jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_commercial_user();raise exception 'EDITORIAL_REVISION_REQUIRED';end $$;
create or replace function public.prepare_professional_listing_publish(p_listing_id uuid,p_operation_id text) returns jsonb language plpgsql security definer set search_path='' as $$
begin perform private.require_commercial_user();raise exception 'EDITORIAL_REVIEW_REQUIRED';end $$;
create or replace function public.finalize_professional_listing_publish(p_listing_id uuid,p_operation_id text,p_avatar_path text,p_avatar_source_media_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'EDITORIAL_REVIEW_REQUIRED';end $$;
create or replace function public.abort_professional_listing_publish(p_listing_id uuid,p_operation_id text) returns void language plpgsql security definer set search_path='' as $$
begin raise exception 'EDITORIAL_REVIEW_REQUIRED';end $$;

create function public.set_professional_listing_editorial(p_id uuid,p_revision bigint,p_state text,p_reason text default '') returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;l public.professional_listings;d public.professional_listing_drafts;period jsonb;has_snapshot boolean;
begin
 r:=private.lock_commercial_editorial(p_id);
 if r.offering_code not in('professional_profile','establishment_profile') then raise exception 'LISTING_NOT_FOUND';end if;
 if r.owner_user_id is distinct from auth.uid() then perform private.require_evocash_admin(true);end if;
 select * into l from public.professional_listings where id=p_id;
 select * into d from public.professional_listing_drafts where listing_id=p_id;
 if d.version is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 perform private.check_editorial_transition(r.moderation_state,d.review_state,p_state,p_reason);
 if p_state in('submitted','approved') then
 if length(btrim(coalesce(d.display_name,'')))<2 or length(btrim(coalesce(d.bio,'')))<10 or nullif(btrim(d.city),'') is null or nullif(d.category_key,'') is null or nullif(d.uf,'') is null or nullif(d.service_mode,'') is null or cardinality(d.modality_keys) not between 1 and 5 or
 not exists(select 1 from public.users where id=l.owner_id and account_status='active') then raise exception 'DRAFT_INCOMPLETE';end if;
 if d.media_id is not null and not exists(select 1 from public.storefront_media where id=d.media_id and storefront_id=l.id and state='ready') then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
 if d.linked_community_id is not null and not exists(select 1 from public.communities where id=d.linked_community_id and owner_id=l.owner_id and is_active) then raise exception 'INVALID_LINKED_COMMUNITY';end if;
 end if;
 select exists(select 1 from public.published_professional_listings where listing_id=p_id) and r.approved_revision is not null into has_snapshot;
 if p_state='approved' then
 insert into public.published_professional_listings(listing_id,kind,display_name,sort_key,category_key,modality_keys,specialties,bio,city,city_key,uf,service_mode,public_contacts,linked_community_id,linked_community_name,media_id,address,opening_hours,published_version)
 values(l.id,l.kind,d.display_name,public._normalize_search_value(d.display_name),d.category_key,d.modality_keys,d.specialties,d.bio,d.city,d.city_key,d.uf,d.service_mode,
 (select coalesce(jsonb_agg(jsonb_build_object('type',key,'url',value)),'[]') from jsonb_each_text(d.contacts) where nullif(btrim(value),'') is not null),
 d.linked_community_id,d.linked_community_name,d.media_id,d.address,d.opening_hours,d.version+1)
 on conflict(listing_id) do update set display_name=excluded.display_name,sort_key=excluded.sort_key,category_key=excluded.category_key,modality_keys=excluded.modality_keys,specialties=excluded.specialties,bio=excluded.bio,city=excluded.city,city_key=excluded.city_key,uf=excluded.uf,service_mode=excluded.service_mode,public_contacts=excluded.public_contacts,linked_community_id=excluded.linked_community_id,linked_community_name=excluded.linked_community_name,media_id=excluded.media_id,address=excluded.address,opening_hours=excluded.opening_hours,published_version=excluded.published_version,avatar_path=null,avatar_source_media_id=null,updated_at=clock_timestamp();
 end if;
 perform private.apply_editorial_anchor(p_id,p_state,d.version+1,has_snapshot);
 update public.professional_listing_drafts set version=version+1,
 review_state=case when p_state in('archived','suspended') then review_state else p_state end,
 rejection_summary=case when p_state='rejected' then btrim(p_reason) else null end,updated_at=clock_timestamp() where listing_id=p_id;
 update public.professional_listings set lifecycle_state=case when p_state='suspended' then 'suspended' when p_state='archived' then 'archived' when p_state='approved' or(has_snapshot and p_state in('draft','submitted')) then 'published' else lifecycle_state end,
 published_version=case when p_state='approved' then d.version+1 else published_version end,
 suspended_reason=case when p_state='suspended' then btrim(p_reason) when p_state='draft' then null else suspended_reason end,
 suspended_by=case when p_state='suspended' then auth.uid() when p_state='draft' then null else suspended_by end,updated_at=clock_timestamp() where id=p_id;
 select jsonb_build_object('entitlementId',id,'expiresAt',expires_at,'startsAt',starts_at) into period from public.visibility_entitlements where resource_id=p_id;
 perform private.listing_audit(p_id,case p_state when 'suspended' then 'editorial_suspended' when 'archived' then 'owner_archived' when 'draft' then 'listing_edited' else p_state end,
 coalesce(period,'{}')||jsonb_build_object('revision',d.version+1,'previousRevision',d.version,'previousState',r.moderation_state,'state',p_state,'previousPublishedRevision',r.approved_revision),coalesce(nullif(btrim(p_reason),''),'Alteração editorial pelo proprietário'));
end $$;

create view private.live_professional_listings as
 select p.*,r.expires_at from public.published_professional_listings p
 join public.professional_listings l on l.id=p.listing_id and l.kind=p.kind
 -- Keep the existing ordered/filterable snapshot scan ahead of the per-resource
 -- authorization join. OFFSET 0 prevents a poor global equality estimate from
 -- scanning every commercial anchor before applying LIMIT (see paired plans).
 join lateral(select x.expires_at,x.approved_revision from private.live_commercial_resources x
 where x.id=p.listing_id and x.offering_code=l.offering_code offset 0) r on true
 where l.lifecycle_state='published' and p.published_version=r.approved_revision;
revoke all on private.live_professional_listings from public,anon,authenticated,service_role;
create function private.public_listing_json(p public.published_professional_listings,p_expires timestamptz) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',p.listing_id,'kind',p.kind,'displayName',p.display_name,'categoryKey',p.category_key,'modalityKeys',p.modality_keys,
 'specialties',p.specialties,'bio',p.bio,'city',p.city,'uf',p.uf,'serviceMode',p.service_mode,'publicContacts',p.public_contacts,
 'mediaId',p.media_id,'avatarPath',null,'address',p.address,'openingHours',p.opening_hours,'expiresAt',p_expires,'serverTime',statement_timestamp(),
 'linkedCommunity',case when p.linked_community_id is not null and exists(select 1 from public.communities where id=p.linked_community_id and owner_id=(select owner_id from public.professional_listings where id=p.listing_id) and is_active) then jsonb_build_object('id',p.linked_community_id,'name',p.linked_community_name) else null end)
$$;
create or replace function public.public_list_professionals(p_kind text default 'professional',p_modality text default null,p_uf text default null,p_city text default null,p_service_mode text default null,p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare result jsonb;
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if p_kind is null or p_kind not in('professional','space') or(p_modality is not null and(length(p_modality)>40 or p_modality !~ '^[a-z_]+$')) or(p_uf is not null and p_uf !~ '^[A-Z]{2}$') or(p_city is not null and length(p_city)>80) or(p_service_mode is not null and p_service_mode not in('in_person','online','hybrid')) or p_offset is null or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_ARGUMENT' using errcode='22023';end if;
 with page as materialized(select p.* from private.live_professional_listings p where p.kind=p_kind
 and(p_modality is null or p.modality_keys @> array[p_modality]) and(p_uf is null or p.uf=p_uf)
 and(nullif(btrim(p_city),'') is null or p.city_key=public._normalize_search_value(p_city)) and(p_service_mode is null or p.service_mode=p_service_mode)
 order by p.sort_key,p.listing_id limit p_limit+1 offset p_offset),
 visible as(select * from page order by sort_key,listing_id limit p_limit)
 select jsonb_build_object('serverTime',statement_timestamp(),'validUntil',(select min(expires_at) from visible),'nextOffset',case when(select count(*) from page)>p_limit and p_offset+p_limit<=10000 then p_offset+p_limit end,
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',p.listing_id,'kind',p.kind,'displayName',p.display_name,'categoryKey',p.category_key,'modalityKeys',p.modality_keys,'city',p.city,'uf',p.uf,'serviceMode',p.service_mode,'mediaId',p.media_id,'avatarPath',null,'expiresAt',p.expires_at) order by p.sort_key,p.listing_id) from visible p),'[]')) into result;
 return result;
end $$;
create or replace function public.public_get_professional(p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 return(select private.public_listing_json(p,s.expires_at) from public.published_professional_listings p join private.live_professional_listings s on s.listing_id=p.listing_id where p.listing_id=p_listing_id);
end $$;
create or replace function public.list_published_professional_listings(p_kind text,p_modality text default null,p_uf text default null,p_city text default null,p_service_mode text default null,p_cursor text default null,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;cursor_key text;cursor_id uuid;
begin
 perform private.require_commercial_user();
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if p_kind is null or p_kind not in('professional','space') or p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_ARGUMENT';end if;
 if p_cursor is not null then cursor_key:=p_cursor::jsonb->>'key';cursor_id:=(p_cursor::jsonb->>'id')::uuid;end if;
 with page as materialized(select * from private.live_professional_listings p where p.kind=p_kind
 and(nullif(p_modality,'') is null or p.modality_keys @> array[p_modality]) and(nullif(p_uf,'') is null or p.uf=p_uf)
 and(nullif(p_city,'') is null or p.city_key=public._normalize_search_value(p_city)) and(nullif(p_service_mode,'') is null or p.service_mode=p_service_mode)
 and(p_cursor is null or(p.sort_key,p.listing_id)>(cursor_key,cursor_id)) order by p.sort_key,p.listing_id limit p_limit+1),
 visible as(select * from page order by sort_key,listing_id limit p_limit)
 select jsonb_build_object('serverTime',statement_timestamp(),'validUntil',(select min(expires_at) from visible),
 'items',coalesce((select jsonb_agg(jsonb_build_object('id',listing_id,'kind',kind,'displayName',display_name,'city',city,'uf',uf,'mediaId',media_id,'expiresAt',expires_at) order by sort_key,listing_id) from visible),'[]'),
 'nextCursor',case when(select count(*) from page)>p_limit then(select jsonb_build_object('key',sort_key,'id',listing_id)::text from visible order by sort_key desc,listing_id desc limit 1) end) into result;
 return result;
end $$;
-- Global personal avatars are not paid listing images. Keep their bytes and owner access.
create or replace function public.public_professional_avatar_visible(p_path text) returns boolean language sql stable security definer set search_path='' as $$select false$$;
revoke all on public.published_professional_listings,public.professional_listing_drafts,public.professional_listings from anon,authenticated;
-- Authenticated clients use the authorized getters; no direct view/table bypass.
create or replace function public.authorize_storefront_media(p_media_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare m public.storefront_media;
begin
 select * into m from public.storefront_media where id=p_media_id and state='ready';if not found then return null;end if;
 if public.has_app_access() and exists(select 1 from public.users where id=auth.uid() and account_status='active') and exists(select 1 from private.commercial_resources where id=m.storefront_id and(owner_user_id=auth.uid() or public.is_superadmin())) then return m.storage_path;end if;
 if exists(select 1 from private.live_storefronts s where s.storefront_id=m.storefront_id and(s.logo_media_id=m.id or exists(select 1 from public.storefront_published_products where storefront_id=s.storefront_id and media_id=m.id))) or
 exists(select 1 from private.live_professional_listings where listing_id=m.storefront_id and media_id=m.id) then return m.storage_path;end if;
 return null;
end $$;
create function public.public_listing_sitemap(p_before uuid default null,p_limit integer default 500) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('serverTime',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object('id',listing_id,'kind',kind,'updatedAt',updated_at,'expiresAt',expires_at) order by listing_id desc),'[]'))
 from(select listing_id,kind,updated_at,expires_at from private.live_professional_listings where(p_before is null or listing_id<p_before) order by listing_id desc limit least(greatest(coalesce(p_limit,500),1),500))p
$$;

create function private.listing_record(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',l.id,'listing',public._to_json_listing(l),'draft',public._to_json_draft(d)||jsonb_build_object('mediaId',d.media_id,'address',d.address,'openingHours',d.opening_hours),
 'published',case when p.listing_id is not null then public._to_json_published(p)||jsonb_build_object('mediaId',p.media_id,'address',p.address,'openingHours',p.opening_hours) end,
 'commercial',jsonb_build_object('offeringCode',l.offering_code,'publishedRevision',r.approved_revision::text,'canContract',r.moderation_state='approved' and r.content_revision=r.approved_revision,
 'state',case when r.moderation_state='suspended' then 'suspended' when e.administrative_state in('suspended','revoked') then e.administrative_state when e.expires_at<=statement_timestamp() then 'expired' when private.commercial_resource_visible(l.id) then 'active' else 'private' end,
 'expiresAt',e.expires_at,'entitlementId',e.id,'serverTime',statement_timestamp(),'remainingSeconds',greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::text,
 'tariff',(select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready and v.id is not null,'price',v.unit_price_cash::text,'minDays',v.min_days::text,'maxDays',v.max_days::text) from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=l.offering_code)))
 from public.professional_listings l join public.professional_listing_drafts d on d.listing_id=l.id join private.commercial_resources r on r.id=l.id
 left join public.published_professional_listings p on p.listing_id=l.id left join public.visibility_entitlements e on e.resource_id=l.id where l.id=p_id
$$;
create or replace function public.get_my_professional_listing() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin perform private.require_commercial_user();return private.listing_record((select id from public.professional_listings where owner_id=auth.uid()));end $$;
create or replace function public.admin_get_professional_listing(p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return private.listing_record(p_listing_id)||jsonb_build_object('ownerUsername',(select u.username from public.users u join public.professional_listings l on l.owner_id=u.id where l.id=p_listing_id),
 'ownerEmail',(select u.email from auth.users u join public.professional_listings l on l.owner_id=u.id where l.id=p_listing_id),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from(select id,action,reason,payload,occurred_at from public.commercial_order_events where payload->>'listingId'=p_listing_id::text order by id desc limit 30)e));
end $$;
create function public.list_listing_commercial_orders(p_id uuid,p_before timestamptz default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if not exists(select 1 from public.professional_listings where id=p_id and(owner_id=auth.uid() or public.is_superadmin())) then raise exception 'LISTING_NOT_FOUND';end if;
 return coalesce((select jsonb_agg(private.commercial_order_json(o) order by o.created_at desc) from(select * from public.commercial_orders where resource_id=p_id and(p_before is null or created_at<p_before) order by created_at desc limit 20)o),'[]');
end $$;
-- Retired mutation signatures cannot bypass CAS, moderation or retention of paid history.
create or replace function public.unpublish_professional_listing(p_listing_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED';end if;perform private.require_commercial_user();raise exception 'EDITORIAL_REVISION_REQUIRED';end$$;
create or replace function public.delete_professional_listing(p_listing_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED';end if;perform private.require_commercial_user();raise exception 'EDITORIAL_REVISION_REQUIRED';end$$;
-- Existing support moderation calls this targeted suspension operation. It never publishes,
-- overwrites content or removes a block; the shared lock serializes it with approvals/payments.
create or replace function public.suspend_professional_listing(p_listing_id uuid,p_reason text) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;revision bigint;
begin
 if not private.current_session_active() then raise exception 'SESSION_REVOKED';end if;
 perform private.require_evocash_admin(true);
 r:=private.lock_commercial_editorial(p_listing_id);
 select version into revision from public.professional_listing_drafts where listing_id=p_listing_id;
 if revision is null then raise exception 'LISTING_NOT_FOUND';end if;
 if r.moderation_state<>'suspended' then perform public.set_professional_listing_editorial(p_listing_id,revision,'suspended',p_reason);end if;
 return jsonb_build_object('listingId',p_listing_id,'state','suspended','revokedAvatarPath',null);
end$$;
create or replace function public.admin_reactivate_professional_listing(p_listing_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$begin if not private.current_session_active() then raise exception 'SESSION_REVOKED';end if;perform private.require_evocash_admin(true);raise exception 'EDITORIAL_REVISION_REQUIRED';end$$;

create or replace function public.admin_list_professional_listings(
  p_search text default '', p_lifecycle_state text default '', p_cursor uuid default null, p_page_size int default 50
) returns table (
  id uuid, owner_id uuid, owner_username text, owner_email text, kind text,
  lifecycle_state text, display_name text, published_version integer,
  suspended_reason text, suspended_by uuid, created_at timestamptz, updated_at timestamptz
)
  language plpgsql stable security definer set search_path = '' as $$
declare
  v_term text := trim(coalesce(p_search, ''));
begin
  perform private.require_evocash_admin();
  if p_page_size < 1 or p_page_size > 50 then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if p_lifecycle_state <> '' and p_lifecycle_state not in ('draft', 'published', 'archived', 'suspended', 'deleting') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  return query
    select pl.id, pl.owner_id, u.username, au.email::text, pl.kind, pl.lifecycle_state,
           d.display_name, pl.published_version, pl.suspended_reason, pl.suspended_by,
           pl.created_at, pl.updated_at
    from public.professional_listings pl
    join public.professional_listing_drafts d on d.listing_id = pl.id
    join public.users u on u.id = pl.owner_id
    join auth.users au on au.id = pl.owner_id
    where (p_lifecycle_state = '' or pl.lifecycle_state = p_lifecycle_state)
      and (
        v_term = ''
        or d.display_name ilike '%' || v_term || '%'
        or u.username ilike '%' || v_term || '%'
        or au.email ilike '%' || v_term || '%'
      )
      and (p_cursor is null or pl.id > p_cursor)
    order by pl.id
    limit p_page_size;
end;
$$;

-- Both concrete adapters are now installed, but sales and prices remain untouched.
update public.commercial_offerings set integration_ready=true where code in('professional_profile','establishment_profile');

create or replace function public.discard_unused_storefront_media(p_media_id uuid) returns text language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.storefront_media; grace integer;
begin
 select * into m from public.storefront_media where id=p_media_id;if not found then return null;end if;
 perform private.lock_commercial_editorial(m.storefront_id);
 select * into m from public.storefront_media where id=p_media_id for update;
 select cleanup_grace_seconds into grace from public.storefront_settings where id;
 if grace is null or private.storefront_media_referenced(m.id) or (m.unreferenced_since is null or m.unreferenced_since>clock_timestamp()-make_interval(secs=>grace)) or m.upload_lease_until>clock_timestamp() or m.cleanup_token is not null then return null;end if;
 update public.storefront_media set state='deleting' where id=m.id;
 return m.storage_path;
end $$;

create or replace function public.set_storefront_editorial(p_id uuid,p_revision bigint,p_state text,p_reason text default '') returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; s public.product_storefronts; period jsonb;
begin
 r:=private.lock_storefront(p_id);
 select * into s from public.product_storefronts where id=p_id;
 if s.draft_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 perform private.check_editorial_transition(r.moderation_state,s.draft_state,p_state,p_reason);
 if p_state in('submitted','approved') then
 if length(btrim(s.description))<10 or not exists(select 1 from public.users where id=s.owner_user_id and account_status='active') or
 not exists(select 1 from public.partner_products where storefront_id=p_id and not archived) or
 exists(select 1 from public.partner_products p left join public.storefront_media m on m.id=p.media_id where p.storefront_id=p_id and not p.archived and
 (length(btrim(p.name))<2 or length(btrim(p.brand))<2 or length(btrim(p.description))<10 or length(btrim(p.category))<2 or p.store_url='' or m.state is distinct from 'ready')) then raise exception 'STOREFRONT_INCOMPLETE';end if;end if;
 update public.product_storefronts set draft_revision=draft_revision+1,
 draft_state=case when p_state in('suspended','archived') then draft_state else p_state end,updated_at=clock_timestamp() where id=p_id;
 if p_state='approved' then
 insert into public.storefront_publications(storefront_id,revision,name,description,contact,logo_media_id,approved_at)
 values(s.id,s.draft_revision+1,s.name,s.description,s.contact,s.logo_media_id,clock_timestamp())
 on conflict(storefront_id) do update set revision=excluded.revision,name=excluded.name,description=excluded.description,contact=excluded.contact,logo_media_id=excluded.logo_media_id,approved_at=excluded.approved_at;
 delete from public.storefront_published_products where storefront_id=p_id;
 insert into public.storefront_published_products(product_id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order)
 select id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order from public.partner_products where storefront_id=p_id and not archived;
 update private.commercial_resources set content_revision=s.draft_revision+1,approved_revision=s.draft_revision+1,moderation_state='approved' where id=p_id;
 elsif p_state in('suspended','archived') then
 update private.commercial_resources set moderation_state=p_state where id=p_id;
 elsif p_state='draft' and r.moderation_state in('suspended','archived') then
 update private.commercial_resources set moderation_state=case when exists(select 1 from public.storefront_publications where storefront_id=p_id) then 'approved' else 'draft' end where id=p_id;
 elsif r.approved_revision is null then
 update private.commercial_resources set moderation_state=p_state where id=p_id;
 end if;
 select jsonb_build_object('expiresAt',expires_at,'entitlementId',id) into period from public.visibility_entitlements where resource_id=p_id;
 perform private.storefront_audit(p_id,case p_state when 'suspended' then 'editorial_suspended' when 'archived' then 'owner_archived' when 'draft' then 'storefront_edited' else p_state end,
 coalesce(period,'{}')||jsonb_build_object('revision',s.draft_revision+1,'previousRevision',s.draft_revision,'previousState',s.draft_state,'state',p_state,'publishedRevision',r.approved_revision),coalesce(nullif(btrim(p_reason),''),'Alteração editorial pelo proprietário'));
end $$;

do $$declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where(n.nspname='private' and p.proname in('professional_anchor_create','professional_identity_guard','professional_anchor_guard','lock_commercial_editorial','check_editorial_transition','apply_editorial_anchor','listing_audit','public_listing_json','listing_record'))
 or(n.nspname='public' and p.proname in('create_professional_listing','save_professional_listing_draft','set_professional_listing_editorial','public_list_professionals','public_get_professional','list_published_professional_listings','public_listing_sitemap','get_my_professional_listing','admin_get_professional_listing','admin_list_professional_listings','list_listing_commercial_orders','unpublish_professional_listing','delete_professional_listing','suspend_professional_listing','admin_reactivate_professional_listing','prepare_professional_listing_publish','finalize_professional_listing_publish','abort_professional_listing_publish')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',f.nspname,f.proname,f.args);
 if f.nspname='public' and f.proname not in('finalize_professional_listing_publish','abort_professional_listing_publish') then execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.args);end if;
 if f.proname in('public_list_professionals','public_get_professional','public_listing_sitemap') then execute format('grant execute on function public.%I(%s) to anon',f.proname,f.args);end if;
 end loop;
end$$;
