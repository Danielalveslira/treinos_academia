-- Phase 5.1: multiple concrete editorial resources, no financial changes or policy seeds.
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.professional_listings drop constraint professional_listings_owner_id_key;
alter table public.professional_listings add column creation_request_id uuid;
create unique index professional_listing_creation_request on public.professional_listings(owner_id,creation_request_id) where creation_request_id is not null;
-- Replaces the removed owner uniqueness index; serves ownership, limit count and seek pagination.
create index professional_listing_owner_kind_id on public.professional_listings(owner_id,kind,id desc);
create table public.professional_listing_limits(
 kind text primary key check(kind in('professional','space')),
 max_per_owner integer check(max_per_owner>=0),
 revision bigint not null default 1 check(revision>0),
 updated_at timestamptz not null default clock_timestamp()
);
comment on column public.professional_listing_limits.max_per_owner is 'NULL explicitly configured means unlimited; missing row means creation is unavailable. Existing resources stay editable/renewable.';
alter table public.professional_listing_limits enable row level security;
revoke all on public.professional_listing_limits from public,anon,authenticated,service_role;
create function public.get_professional_listing_limits() returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_commercial_user();
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 return coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'maxPerOwner',max_per_owner,'revision',revision::text) order by kind) from public.professional_listing_limits),'[]');
end$$;
create function public.admin_set_professional_listing_limit(p_kind text,p_max integer,p_revision bigint,p_reason text) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare old_revision bigint;
begin
 perform private.require_evocash_admin(true);
 if p_kind is null or p_kind not in('professional','space') or p_max<0 or p_revision is null or p_revision<0 or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_LISTING_LIMIT';end if;
 -- Serializes missing-row creation too, without locking or changing wallets/offering prices.
 perform pg_advisory_xact_lock(hashtextextended('professional-listing-limit:'||p_kind,0));
 select revision into old_revision from public.professional_listing_limits where kind=p_kind for update;
 if coalesce(old_revision,0)<>p_revision then raise exception 'LISTING_LIMIT_REVISION_CONFLICT';end if;
 insert into public.professional_listing_limits(kind,max_per_owner)values(p_kind,p_max)
 on conflict(kind)do update set max_per_owner=excluded.max_per_owner,revision=professional_listing_limits.revision+1,updated_at=clock_timestamp();
 insert into public.commercial_order_events(offering_code,actor_user_id,action,reason,payload)
 values(case p_kind when 'space' then 'establishment_profile' else 'professional_profile' end,auth.uid(),'limits',btrim(p_reason),jsonb_build_object('listingKind',p_kind,'maxPerOwner',p_max,'previousRevision',coalesce(old_revision,0),'revision',coalesce(old_revision,0)+1));
end$$;
create function public.create_professional_listing(p_kind text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare l public.professional_listings;uid uuid:=auth.uid();lim public.professional_listing_limits;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=uid for no key update;
 if p_kind is null or p_kind not in('professional','space') or p_request_id is null then raise exception 'INVALID_ARGUMENT';end if;
 select * into l from public.professional_listings where owner_id=uid and creation_request_id=p_request_id;
 if found then
 if l.kind<>p_kind then raise exception 'LISTING_CREATION_KEY_CONFLICT';end if;
 return jsonb_build_object('listingId',l.id,'created',false);end if;
 if not exists(select 1 from public.users where id=uid and usage_profile in('professional','establishment_owner')) then raise exception 'NOT_ELIGIBLE';end if;
 select * into lim from public.professional_listing_limits where kind=p_kind for share;
 if not found then raise exception 'LISTING_LIMIT_UNCONFIGURED';end if;
 if lim.max_per_owner is not null and(select count(*) from public.professional_listings where owner_id=uid and kind=p_kind)>=lim.max_per_owner then raise exception 'LISTING_LIMIT_REACHED';end if;
 if(select count(*) from public.commercial_order_events where actor_user_id=uid and action='listing_created' and occurred_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'STOREFRONT_RATE_LIMIT';end if;
 insert into public.professional_listings(owner_id,kind,creation_request_id) values(uid,p_kind,p_request_id) returning * into l;
 insert into public.professional_listing_drafts(listing_id,owner_id,kind)values(l.id,uid,p_kind);
 perform private.listing_audit(l.id,'listing_created',jsonb_build_object('creationRequestId',p_request_id));
 return jsonb_build_object('listingId',l.id,'created',true);
end$$;
create or replace function public.create_professional_listing(p_kind text) returns jsonb language plpgsql security definer set search_path='' as $$begin perform private.require_commercial_user();raise exception 'LISTING_CREATION_KEY_REQUIRED';end$$;
create function public.get_my_professional_listing(p_listing_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform private.require_commercial_user();
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if not exists(select 1 from public.professional_listings where id=p_listing_id and owner_id=auth.uid()) then raise exception 'LISTING_NOT_FOUND';end if;
 return private.listing_record(p_listing_id);
end$$;
-- Fail closed for stale clients instead of choosing an arbitrary resource.
create or replace function public.get_my_professional_listing() returns jsonb language plpgsql stable security definer set search_path='' as $$begin perform private.require_commercial_user();raise exception 'LISTING_ID_REQUIRED';end$$;
create function public.list_my_professional_listings(p_kind text default null,p_before uuid default null,p_limit integer default 12) returns jsonb
language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare result jsonb;
begin
 perform private.require_commercial_user();
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if(p_kind is not null and p_kind not in('professional','space')) or p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_ARGUMENT';end if;
 with page as materialized(select l.*,d.display_name,d.review_state,r.moderation_state,r.approved_revision,e.expires_at,e.starts_at,e.administrative_state,r.content_revision
 from public.professional_listings l join public.professional_listing_drafts d on d.listing_id=l.id join private.commercial_resources r on r.id=l.id
 left join public.visibility_entitlements e on e.resource_id=l.id
 where l.owner_id=auth.uid() and(p_kind is null or l.kind=p_kind) and(p_before is null or l.id<p_before) order by l.id desc limit p_limit+1),
 visible as(select * from page order by id desc limit p_limit)
 select jsonb_build_object('serverTime',statement_timestamp(),'items',coalesce((select jsonb_agg(jsonb_build_object('id',id,'kind',kind,'displayName',coalesce(nullif(display_name,''),'Cadastro em preparação'),'reviewState',review_state,'expiresAt',expires_at,
 'state',case when moderation_state='suspended' or administrative_state in('suspended','revoked') then 'suspended' when moderation_state='archived' then 'private' when expires_at<=statement_timestamp() then 'expired' when moderation_state='approved' and approved_revision=content_revision and lifecycle_state='published' and starts_at<=statement_timestamp() and expires_at>statement_timestamp() then 'active' else 'private' end) order by id desc) from visible),'[]'),
 'nextCursor',case when(select count(*) from page)>p_limit then(select id from visible order by id limit 1) end) into result;
 return result;
end$$;
do $$declare f record;begin for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_professional_listing_limits','admin_set_professional_listing_limit','create_professional_listing','get_my_professional_listing','list_my_professional_listings') loop
 execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
 execute format('grant execute on function %s to authenticated',f.signature);
end loop;end$$;
