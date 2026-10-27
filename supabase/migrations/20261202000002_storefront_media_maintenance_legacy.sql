set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.storefront_media add column last_used_at timestamptz not null default clock_timestamp(),
 add column upload_lease_until timestamptz not null default(clock_timestamp()+interval '5 minutes'),
 add column unreferenced_since timestamptz default clock_timestamp(),
 add column cleanup_token uuid,add column cleanup_lease_until timestamptz;
create index storefront_media_cleanup_age_idx on public.storefront_media(unreferenced_since,id) where unreferenced_since is not null;
alter table public.storefront_settings add column cleanup_enabled boolean not null default false,
 add column cleanup_grace_seconds integer check(cleanup_grace_seconds between 3600 and 2592000);
alter table public.commercial_order_events drop constraint commercial_order_events_action_check;
alter table public.commercial_order_events add check(action in('publish_price','sales','quoted','fulfilled','renewed','suspended','resumed','revoked','reversed','storefront_created','storefront_edited','product_saved','product_archived','submitted','approved','rejected','editorial_suspended','owner_archived','limits','media_cleanup_claimed','media_cleanup_done','media_cleanup_error','legacy_associated','cleanup_configuration'));
create function private.storefront_media_referenced(p_id uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.product_storefronts where logo_media_id=p_id)
 or exists(select 1 from public.partner_products where media_id=p_id)
 or exists(select 1 from public.storefront_publications where logo_media_id=p_id)
 or exists(select 1 from public.storefront_published_products where media_id=p_id)
$$;
-- All association/approval operations already hold the storefront anchor lock.
create function private.note_storefront_media_use() returns trigger language plpgsql set search_path='' as $$
declare old_id uuid;new_id uuid;
begin
 if tg_table_name in('product_storefronts','storefront_publications') then
 if tg_op<>'INSERT' then old_id:=old.logo_media_id;end if;if tg_op<>'DELETE' then new_id:=new.logo_media_id;end if;
 else if tg_op<>'INSERT' then old_id:=old.media_id;end if;if tg_op<>'DELETE' then new_id:=new.media_id;end if;end if;
 if tg_op<>'UPDATE' or old_id is distinct from new_id then
 update public.storefront_media m set last_used_at=clock_timestamp(),unreferenced_since=case when private.storefront_media_referenced(m.id) then null else clock_timestamp() end where id in(old_id,new_id);
 end if;
 return null;
end $$;
update public.storefront_media m set unreferenced_since=case when private.storefront_media_referenced(m.id) then null else last_used_at end;
create trigger sf_media_use after insert or update or delete on public.product_storefronts for each row execute function private.note_storefront_media_use();
create trigger sf_product_media_use after insert or update or delete on public.partner_products for each row execute function private.note_storefront_media_use();
create trigger sf_published_media_use after insert or update or delete on public.storefront_publications for each row execute function private.note_storefront_media_use();
create trigger sf_published_product_media_use after insert or update or delete on public.storefront_published_products for each row execute function private.note_storefront_media_use();
create function private.media_cleanup_event(p_storefront uuid,p_action text,p_token uuid,p_payload jsonb) returns void language sql set search_path='' as $$
 insert into public.commercial_order_events(offering_code,actor_user_id,action,request_id,reason,payload)
 values('product_storefront',coalesce(auth.uid(),'00000000-0000-0000-0000-000000000000'::uuid),p_action,case when p_action<>'media_cleanup_claimed' then p_token end,'Manutenção controlada de mídia privada',p_payload||jsonb_build_object('storefrontId',p_storefront,'cleanupToken',p_token))
$$;
create or replace function public.confirm_storefront_media_internal(p_media_id uuid,p_width integer,p_height integer,p_size integer) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare sid uuid;
begin
 if auth.role()<>'service_role' then raise exception 'PERMISSION_DENIED';end if;
 select storefront_id into sid from public.storefront_media where id=p_media_id;
 perform 1 from private.commercial_resources where id=sid for update;
 update public.storefront_media set state='ready',width=p_width,height=p_height,byte_size=p_size,last_used_at=clock_timestamp(),unreferenced_since=clock_timestamp()
 where id=p_media_id and state='allocated' and upload_lease_until>clock_timestamp() and cleanup_token is null;
 if not found then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
end $$;
create or replace function public.discard_unused_storefront_media(p_media_id uuid) returns text language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.storefront_media; grace integer;
begin
 select * into m from public.storefront_media where id=p_media_id;if not found then return null;end if;
 perform private.lock_storefront(m.storefront_id);
 select * into m from public.storefront_media where id=p_media_id for update;
 select cleanup_grace_seconds into grace from public.storefront_settings where id;
 if grace is null or private.storefront_media_referenced(m.id) or (m.unreferenced_since is null or m.unreferenced_since>clock_timestamp()-make_interval(secs=>grace)) or m.upload_lease_until>clock_timestamp() or m.cleanup_token is not null then return null;end if;
 update public.storefront_media set state='deleting' where id=m.id;
 return m.storage_path;
end $$;
create or replace function public.discard_storefront_media_internal(p_media_id uuid) returns void language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.storefront_media;
begin
 if auth.role()<>'service_role' then raise exception 'PERMISSION_DENIED';end if;
 select * into m from public.storefront_media where id=p_media_id;if not found then return;end if;
 perform 1 from private.commercial_resources where id=m.storefront_id for update;
 select * into m from public.storefront_media where id=p_media_id for update;
 if m.cleanup_token is not null or private.storefront_media_referenced(m.id) then return;end if;
 if m.state in('allocated','deleting') then
 delete from public.storefront_media where id=m.id;
 perform private.media_cleanup_event(m.storefront_id,'media_cleanup_done',gen_random_uuid(),jsonb_build_object('mediaId',m.id,'path',m.storage_path,'source','explicit_upload_failure_or_discard'));
 end if;
end $$;
create function public.admin_configure_storefront_cleanup(p_enabled boolean,p_grace_seconds integer,p_revision bigint,p_reason text,p_confirm boolean) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare n bigint;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_enabled is null or p_grace_seconds is null or p_grace_seconds not between 3600 and 2592000 or p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'INVALID_CLEANUP_CONFIGURATION';end if;
 select revision into n from public.storefront_settings where id for update;
 if n is distinct from p_revision then raise exception 'PRICE_REVISION_CONFLICT';end if;
 update public.storefront_settings set cleanup_enabled=p_enabled,cleanup_grace_seconds=p_grace_seconds,revision=revision+1 where id;
 perform private.storefront_audit(null,'cleanup_configuration',jsonb_build_object('enabled',p_enabled,'graceSeconds',p_grace_seconds,'revision',n+1),btrim(p_reason));
end $$;
create function public.claim_storefront_media_cleanup(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare c record;m public.storefront_media;cfg public.storefront_settings;token uuid;items jsonb:='[]';sid uuid;
begin
 if auth.role()<>'service_role' then perform private.require_evocash_admin(true);end if;
 if p_limit is null or p_limit not between 1 and 50 then raise exception 'INVALID_PAGE';end if;
 select * into cfg from public.storefront_settings where id;
 if not cfg.cleanup_enabled or cfg.cleanup_grace_seconds is null then return items;end if;
 for c in select id,storefront_id from public.storefront_media where unreferenced_since<=clock_timestamp()-make_interval(secs=>cfg.cleanup_grace_seconds)
 and upload_lease_until<=clock_timestamp() and(cleanup_lease_until is null or cleanup_lease_until<=clock_timestamp()) order by unreferenced_since,id limit p_limit*4 loop
 sid:=null;select id into sid from private.commercial_resources where id=c.storefront_id for update skip locked;if sid is null then continue;end if;
 select * into m from public.storefront_media where id=c.id for update skip locked;
 if not found or private.storefront_media_referenced(m.id) or (m.unreferenced_since is null or m.unreferenced_since>clock_timestamp()-make_interval(secs=>cfg.cleanup_grace_seconds)) or m.upload_lease_until>clock_timestamp() or m.cleanup_lease_until>clock_timestamp() then continue;end if;
 token:=gen_random_uuid();
 update public.storefront_media set state='deleting',cleanup_token=token,cleanup_lease_until=clock_timestamp()+interval '5 minutes' where id=m.id;
 perform private.media_cleanup_event(m.storefront_id,'media_cleanup_claimed',token,jsonb_build_object('mediaId',m.id,'path',m.storage_path,'previousState',m.state));
 items:=items||jsonb_build_array(jsonb_build_object('id',m.id,'path',m.storage_path,'token',token));
 exit when jsonb_array_length(items)>=p_limit;
 end loop;
 return items;
end $$;
create function public.finish_storefront_media_cleanup(p_id uuid,p_token uuid,p_success boolean) returns boolean
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.storefront_media;
begin
 if auth.role()<>'service_role' then raise exception 'PERMISSION_DENIED';end if;
 if exists(select 1 from public.commercial_order_events where request_id=p_token and action in('media_cleanup_done','media_cleanup_error')) then return true;end if;
 select * into m from public.storefront_media where id=p_id;if not found then return false;end if;
 perform 1 from private.commercial_resources where id=m.storefront_id for update;
 select * into m from public.storefront_media where id=p_id for update;
 if m.cleanup_token is distinct from p_token or m.state<>'deleting' or private.storefront_media_referenced(m.id) or p_success is null then raise exception 'INVALID_CLEANUP_LEASE';end if;
 if p_success then delete from public.storefront_media where id=m.id;
 else update public.storefront_media set cleanup_token=null,cleanup_lease_until=clock_timestamp()+interval '1 minute' where id=m.id;end if;
 perform private.media_cleanup_event(m.storefront_id,case when p_success then 'media_cleanup_done' else 'media_cleanup_error' end,p_token,jsonb_build_object('mediaId',m.id,'path',m.storage_path));
 return true;
end $$;
create function public.admin_storefront_maintenance() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return jsonb_build_object('settings',(select jsonb_build_object('enabled',cleanup_enabled,'graceSeconds',cleanup_grace_seconds,'revision',revision::text) from public.storefront_settings where id),
 'pending',(select count(*) from public.storefront_media where state='deleting'),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from(select id,action,reason,payload,occurred_at from public.commercial_order_events where action in('media_cleanup_claimed','media_cleanup_done','media_cleanup_error','legacy_associated','cleanup_configuration') order by id desc limit 30)e));
end $$;
-- Narrow, explicit transition for legacy content with human-verifiable evidence.
create function public.admin_associate_legacy_product(p_product uuid,p_storefront uuid,p_revision bigint,p_fingerprint text,p_verified_owner uuid,p_evidence text,p_request uuid,p_confirm boolean) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;s public.product_storefronts;p public.partner_products;ev public.commercial_order_events;payload jsonb;lim integer;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_request is null or p_evidence is null or length(btrim(p_evidence)) not between 10 and 500 then raise exception 'OWNERSHIP_EVIDENCE_REQUIRED';end if;
 r:=private.lock_storefront(p_storefront);select * into s from public.product_storefronts where id=p_storefront;
 payload:=jsonb_build_object('productId',p_product,'targetStorefront',p_storefront,'verifiedOwner',p_verified_owner,'evidence',btrim(p_evidence),'fingerprint',p_fingerprint);
 select * into ev from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request;
 if found then if ev.action<>'legacy_associated' or ev.payload->'request'<>payload then raise exception 'IDEMPOTENCY_CONFLICT';end if;return p_product;end if;
 if s.draft_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_verified_owner is null or p_verified_owner is distinct from s.owner_user_id or not exists(select 1 from public.users where id=p_verified_owner and account_status='active') then raise exception 'OWNER_NOT_VERIFIED';end if;
 select * into p from public.partner_products where id=p_product and storefront_id is null for update;
 if not found then raise exception 'LEGACY_PRODUCT_NOT_FOUND';end if;
 if md5(to_jsonb(p)::text) is distinct from p_fingerprint then raise exception 'LEGACY_PRODUCT_CHANGED';end if;
 select max_products into lim from public.storefront_settings where id for share;
 if lim is null or(select count(*) from public.partner_products where storefront_id=s.id and not archived)>=lim then raise exception 'PRODUCT_LIMIT';end if;
 update public.partner_products set storefront_id=s.id,legacy_image_url=image_url,image_url=null,approved=false,sponsored=false,starts_at=null,ends_at=null,media_id=null where id=p.id;
 perform private.touch_storefront(s.id);
 perform private.storefront_audit(s.id,'legacy_associated',jsonb_build_object('request',payload,'original',to_jsonb(p),'nextStep','upload_private_image_and_submit_for_review'),'Associação administrativa com evidência de titularidade',p_request);
 return p.id;
end $$;
create function public.admin_list_legacy_products(p_before uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return coalesce((select jsonb_agg(to_jsonb(p)||jsonb_build_object('fingerprint',md5(to_jsonb(p)::text)) order by id desc) from(select * from public.partner_products where storefront_id is null and(p_before is null or id<p_before) order by id desc limit 20)p),'[]');
end $$;
create function public.admin_get_legacy_target(p_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return(select jsonb_build_object('id',s.id,'name',s.name,'ownerId',s.owner_user_id,'revision',s.draft_revision::text) from public.product_storefronts s join public.users u on u.id=s.owner_user_id where s.id=p_id and u.account_status='active');
end $$;
create function private.enqueue_storefront_media_cleanup() returns bigint language plpgsql security definer set search_path='' as $$
declare endpoint text;credential text;request_id bigint;
begin
 if not exists(select 1 from public.storefront_settings where id and cleanup_enabled and cleanup_grace_seconds is not null) then return null;end if;
 select decrypted_secret into endpoint from vault.decrypted_secrets where name='storefront_cleanup_url';
 select decrypted_secret into credential from vault.decrypted_secrets where name='storefront_cleanup_service_key';
 if endpoint is null or credential is null then return null;end if;
 if endpoint !~ '^https://[a-z0-9.-]+/functions/v1/storefront-media-cleanup$' then return null;end if;
 select net.http_post(url:=endpoint,headers:=jsonb_build_object('Authorization','Bearer '||credential,'Content-Type','application/json'),body:='{"limit":20}'::jsonb,timeout_milliseconds:=10000) into request_id;
 return request_id;
end $$;
select cron.schedule('storefront-media-cleanup','*/15 * * * *',$$select private.enqueue_storefront_media_cleanup()$$);
-- Every new privileged operation is opt-in; PUBLIC/default function ACLs are closed.
do $$declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('storefront_media_referenced','note_storefront_media_use','media_cleanup_event','enqueue_storefront_media_cleanup')) or
 (n.nspname='public' and p.proname in('admin_configure_storefront_cleanup','claim_storefront_media_cleanup','finish_storefront_media_cleanup','admin_storefront_maintenance','admin_associate_legacy_product','admin_list_legacy_products','admin_get_legacy_target')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',f.nspname,f.proname,f.args);
 if f.nspname='public' then
 if f.proname<>'finish_storefront_media_cleanup' then execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.args);end if;
 if f.proname in('claim_storefront_media_cleanup','finish_storefront_media_cleanup') then execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.args);end if;end if;
 end loop;
end$$;
