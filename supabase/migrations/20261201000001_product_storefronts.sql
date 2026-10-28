-- Phase 4: concrete editorial adapter. No prices or sales are enabled here.
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table private.commercial_resources add unique(id,offering_code,owner_user_id);
create table public.product_storefronts (
 id uuid primary key,
 offering_code text not null default 'product_storefront' check(offering_code='product_storefront'),
 owner_user_id uuid references public.users(id) on delete set null,
 foreign key(id,offering_code,owner_user_id) references private.commercial_resources(id,offering_code,owner_user_id),
 name text not null check(length(btrim(name)) between 2 and 120),
 description text not null default '' check(length(description)<=1000),
 contact text not null default '' check(length(contact)<=300),
 logo_media_id uuid,
 created_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index product_storefronts_owner_idx on public.product_storefronts(owner_user_id,created_at desc,id);
create table public.storefront_media (
 id uuid primary key default gen_random_uuid(),
 storefront_id uuid not null references public.product_storefronts(id),
 storage_path text not null unique,
 state text not null default 'allocated' check(state in('allocated','ready','deleting')),
 width integer, height integer, byte_size integer,
 created_at timestamptz not null default clock_timestamp(),
 check(storage_path=storefront_id::text||'/'||id::text||'.webp'),
 check(state in('allocated','deleting') or (width is not null and height is not null and byte_size is not null and width between 1 and 1600 and height between 1 and 1600 and byte_size between 1 and 1048576)),
 unique(id,storefront_id)
);
alter table public.product_storefronts add foreign key(logo_media_id,id) references public.storefront_media(id,storefront_id);
create index storefront_media_storefront_idx on public.storefront_media(storefront_id,created_at);
create table public.storefront_settings (
 id boolean primary key default true check(id),
 max_products integer check(max_products between 1 and 1000),
 max_storefronts integer check(max_storefronts between 1 and 20),
 revision bigint not null default 0
);
insert into public.storefront_settings(id) values(true);
alter table public.partner_products add column storefront_id uuid references public.product_storefronts(id),
 add column media_id uuid, add column archived boolean not null default false,
 add column display_order integer not null default 0 check(display_order between 0 and 10000),
 add column price_centavos bigint check(price_centavos between 0 and 999999999999),
 add foreign key(media_id,storefront_id) references public.storefront_media(id,storefront_id);
-- Keep legacy data/constraints. Managed drafts may be incomplete; submission validates them.
alter table public.partner_products drop constraint partner_products_name_check,
 drop constraint partner_products_brand_check, drop constraint partner_products_description_check,
 drop constraint partner_products_category_check, drop constraint partner_products_store_url_check;
alter table public.partner_products add check(length(name)<=120 and (storefront_id is not null or length(name)>=2)),
 add check(length(brand)<=120 and (storefront_id is not null or length(brand)>=2)),
 add check(length(description)<=500 and (storefront_id is not null or length(description)>=10)),
 add check(length(category)<=80 and (storefront_id is not null or length(category)>=2)),
 add check((storefront_id is not null and store_url='') or store_url ~* '^https://[a-z0-9.-]+\.[a-z]{2,}(:[0-9]+)?([/?#][^[:space:]]*)?$'),
 add check(storefront_id is null or (image_url is null and not sponsored and not approved and starts_at is null and ends_at is null));
create index partner_products_storefront_idx on public.partner_products(storefront_id,display_order,id) where not archived;
create or replace function public.enforce_partner_product_image() returns trigger language plpgsql set search_path='' as $$
begin
 if new.storefront_id is null and tg_op='INSERT' and nullif(btrim(new.image_url),'') is null then raise exception 'image_url is required to create a partner product' using errcode='22023';end if;
 if new.storefront_id is null and new.approved and nullif(btrim(new.image_url),'') is null then raise exception 'image_url is required to publish a partner product' using errcode='22023';end if;
 return new;
end $$;

-- Remove every old public/read and direct-write route for managed products.
drop policy partner_products_public_read on public.partner_products;
create policy partner_products_legacy_admin_read on public.partner_products for select to authenticated using(public.is_superadmin() and public.has_app_access() and storefront_id is null);
alter policy partner_products_admin_insert on public.partner_products with check(public.is_superadmin() and public.has_app_access() and storefront_id is null);
alter policy partner_products_admin_update on public.partner_products using(public.is_superadmin() and public.has_app_access() and storefront_id is null) with check(public.is_superadmin() and public.has_app_access() and storefront_id is null);
alter policy partner_products_admin_delete on public.partner_products using(public.is_superadmin() and public.has_app_access() and storefront_id is null);
revoke select on public.partner_products from anon;
alter table public.product_storefronts enable row level security;
alter table public.storefront_media enable row level security;
alter table public.storefront_settings enable row level security;
revoke all on public.product_storefronts,public.storefront_media,public.storefront_settings from public,anon,authenticated,service_role;

create function private.storefront_audit(p_id uuid,p_action text,p_payload jsonb default '{}',p_reason text default 'Alteração editorial pelo proprietário',p_request uuid default null) returns void
language sql set search_path='' as $$
 insert into public.commercial_order_events(offering_code,actor_user_id,action,request_id,reason,payload)
 values('product_storefront',auth.uid(),p_action,p_request,p_reason,p_payload||jsonb_build_object('storefrontId',p_id))
$$;
alter table public.commercial_order_events drop constraint commercial_order_events_action_check;
alter table public.commercial_order_events add check(action in('publish_price','sales','quoted','fulfilled','renewed','suspended','resumed','revoked','reversed','storefront_created','storefront_edited','product_saved','product_archived','submitted','approved','rejected','editorial_suspended','owner_archived','limits'));
create function private.lock_storefront(p_id uuid) returns private.commercial_resources
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=auth.uid() for no key update;
 perform 1 from public.commercial_offerings where code='product_storefront' for share;
 select cr.* into r from private.commercial_resources cr join public.product_storefronts s on s.id=cr.id where s.id=p_id for update of cr;
 if not found or (r.owner_user_id is distinct from auth.uid() and not public.is_superadmin()) then raise exception 'STOREFRONT_NOT_FOUND'; end if;
 perform private.require_commercial_user();
 if not public.is_superadmin() and (select count(*) from public.commercial_order_events where actor_user_id=auth.uid() and offering_code='product_storefront' and occurred_at>clock_timestamp()-interval '1 minute')>=30 then raise exception 'STOREFRONT_RATE_LIMIT';end if;
 return r;
end $$;
create function private.touch_storefront(p_id uuid) returns void language plpgsql set search_path='' as $$
begin
 update private.commercial_resources set content_revision=content_revision+1,approved_revision=null,
 moderation_state=case when moderation_state='suspended' then 'suspended' else 'draft' end where id=p_id;
 update public.product_storefronts set updated_at=clock_timestamp() where id=p_id;
end $$;
create function public.admin_set_storefront_limits(p_max_products integer,p_max_storefronts integer,p_revision bigint,p_reason text,p_confirm boolean) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare n bigint;
begin
 perform private.require_evocash_admin(true);
 if p_confirm is distinct from true or p_reason is null or length(btrim(p_reason)) not between 5 and 500 or p_max_products is null or p_max_storefronts is null or p_max_products not between 1 and 1000 or p_max_storefronts not between 1 and 20 then raise exception 'INVALID_STOREFRONT_LIMITS';end if;
 select revision into n from public.storefront_settings where id for update;
 if n is distinct from p_revision then raise exception 'PRICE_REVISION_CONFLICT';end if;
 update public.storefront_settings set max_products=p_max_products,max_storefronts=p_max_storefronts,revision=revision+1 where id;
 perform private.storefront_audit(null,'limits',jsonb_build_object('maxProducts',p_max_products,'maxStorefronts',p_max_storefronts,'revision',n+1),btrim(p_reason));
end $$;
create function public.create_product_storefront(p_name text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare n integer; resource uuid; ev public.commercial_order_events;
begin
 perform private.require_commercial_user();
 perform 1 from public.users where id=auth.uid() for no key update;
 perform private.require_commercial_user();
 if p_request_id is null or p_name is null or length(btrim(p_name)) not between 2 and 120 then raise exception 'INVALID_STOREFRONT';end if;
 select * into ev from public.commercial_order_events where actor_user_id=auth.uid() and request_id=p_request_id;
 if found then
 if ev.action<>'storefront_created' or ev.payload->>'name'<>btrim(p_name) then raise exception 'IDEMPOTENCY_CONFLICT';end if;
 return (ev.payload->>'storefrontId')::uuid;end if;
 select max_storefronts into n from public.storefront_settings where id for share;
 if n is null then raise exception 'STOREFRONT_LIMITS_UNCONFIGURED';end if;
 if (select count(*) from public.product_storefronts where owner_user_id=auth.uid())>=n then raise exception 'STOREFRONT_LIMIT';end if;
 insert into private.commercial_resources(offering_code,owner_user_id,content_revision) values('product_storefront',auth.uid(),1) returning id into resource;
 insert into public.product_storefronts(id,owner_user_id,name) values(resource,auth.uid(),btrim(p_name));
 perform private.storefront_audit(resource,'storefront_created',jsonb_build_object('name',btrim(p_name)),'Criação gratuita de rascunho',p_request_id);
 return resource;
end $$;
create function public.save_product_storefront(p_id uuid,p_revision bigint,p_name text,p_description text,p_contact text,p_logo_media_id uuid default null) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 r:=private.lock_storefront(p_id);
 if r.content_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_name is null or p_description is null or p_contact is null then raise exception 'INVALID_STOREFRONT';end if;
 if p_logo_media_id is not null and not exists(select 1 from public.storefront_media where id=p_logo_media_id and storefront_id=p_id and state='ready') then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
 update public.product_storefronts set name=btrim(p_name),description=btrim(p_description),contact=btrim(p_contact),logo_media_id=p_logo_media_id where id=p_id;
 perform private.touch_storefront(p_id);
 perform private.storefront_audit(p_id,'storefront_edited',jsonb_build_object('previousRevision',r.content_revision));
end $$;
create function public.save_storefront_product(p_storefront_id uuid,p_revision bigint,p_product_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; n integer; pid uuid; m uuid;
begin
 r:=private.lock_storefront(p_storefront_id);
 if r.content_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_data is null or jsonb_typeof(p_data)<>'object' or exists(select 1 from jsonb_object_keys(p_data) k where k not in('name','brand','description','category','storeUrl','mediaId','priceCentavos','displayOrder')) then raise exception 'INVALID_PRODUCT';end if;
 if p_product_id is not null and not exists(select 1 from public.partner_products where id=p_product_id and storefront_id=p_storefront_id) then raise exception 'PRODUCT_NOT_FOUND';end if;
 if p_product_id is null then
 select max_products into n from public.storefront_settings where id for share;
 if n is null or (select count(*) from public.partner_products where storefront_id=p_storefront_id and not archived)>=n then raise exception 'PRODUCT_LIMIT';end if;end if;
 m:=nullif(p_data->>'mediaId','')::uuid;
 if m is not null and not exists(select 1 from public.storefront_media where id=m and storefront_id=p_storefront_id and state='ready') then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
 if nullif(p_data->>'priceCentavos','') is not null and (p_data->>'priceCentavos') !~ '^[0-9]{1,12}$' then raise exception 'INVALID_PRODUCT_PRICE';end if;
 pid:=coalesce(p_product_id,gen_random_uuid());
 insert into public.partner_products(id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order)
 values(pid,p_storefront_id,coalesce(p_data->>'name',''),coalesce(p_data->>'brand',''),coalesce(p_data->>'description',''),coalesce(p_data->>'category',''),coalesce(p_data->>'storeUrl',''),m,nullif(p_data->>'priceCentavos','')::bigint,coalesce((p_data->>'displayOrder')::integer,0))
 on conflict(id) do update set name=excluded.name,brand=excluded.brand,description=excluded.description,category=excluded.category,store_url=excluded.store_url,media_id=excluded.media_id,price_centavos=excluded.price_centavos,display_order=excluded.display_order;
 perform private.touch_storefront(p_storefront_id);
 perform private.storefront_audit(p_storefront_id,'product_saved',jsonb_build_object('productId',pid,'previousRevision',r.content_revision));
 return pid;
end $$;
create function public.archive_storefront_product(p_storefront_id uuid,p_revision bigint,p_product_id uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 r:=private.lock_storefront(p_storefront_id);
 if r.content_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 update public.partner_products set archived=true where id=p_product_id and storefront_id=p_storefront_id and not archived;
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 perform private.touch_storefront(p_storefront_id);
 perform private.storefront_audit(p_storefront_id,'product_archived',jsonb_build_object('productId',p_product_id));
end $$;
create function public.set_storefront_editorial(p_id uuid,p_revision bigint,p_state text,p_reason text default '') returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; admin boolean; period jsonb;
begin
 r:=private.lock_storefront(p_id);admin:=public.is_superadmin();
 if r.content_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_state is null or p_state not in('submitted','approved','rejected','suspended','archived','draft') then raise exception 'INVALID_EDITORIAL_STATE';end if;
 if p_state in('approved','rejected','suspended') then
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'MODERATION_REASON_REQUIRED';end if;
 if p_state in('approved','rejected') and r.moderation_state<>'submitted' then raise exception 'CONTENT_NOT_SUBMITTED';end if;
 elsif r.moderation_state='suspended' then
 if not admin or p_state<>'draft' then raise exception 'STOREFRONT_SUSPENDED';end if;
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'MODERATION_REASON_REQUIRED';end if;
 end if;
 if p_state in('submitted','approved') then
 if not exists(select 1 from public.product_storefronts where id=p_id and length(btrim(description))>=10) or
 not exists(select 1 from public.partner_products where storefront_id=p_id and not archived) or
 exists(select 1 from public.partner_products p left join public.storefront_media m on m.id=p.media_id where p.storefront_id=p_id and not p.archived and
 (length(btrim(p.name))<2 or length(btrim(p.brand))<2 or length(btrim(p.description))<10 or length(btrim(p.category))<2 or p.store_url='' or m.state is distinct from 'ready')) then raise exception 'STOREFRONT_INCOMPLETE';end if;end if;
 update private.commercial_resources set moderation_state=p_state,content_revision=content_revision+1,approved_revision=case when p_state='approved' then content_revision+1 else null end where id=p_id;
 select jsonb_build_object('expiresAt',expires_at,'entitlementId',id) into period from public.visibility_entitlements where resource_id=p_id;
 perform private.storefront_audit(p_id,case p_state when 'suspended' then 'editorial_suspended' when 'archived' then 'owner_archived' when 'draft' then 'storefront_edited' else p_state end,
 coalesce(period,'{}')||jsonb_build_object('revision',r.content_revision+1,'previousRevision',r.content_revision,'previousState',r.moderation_state,'state',p_state),coalesce(nullif(btrim(p_reason),''),'Alteração editorial pelo proprietário'));
end $$;

-- Concrete adapter invariant: an orphan storefront anchor can never be approved or charged.
create function private.storefront_anchor_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if new.offering_code='product_storefront' and new.owner_user_id is not null and new.moderation_state='approved' and not exists(select 1 from public.product_storefronts s where s.id=new.id and s.owner_user_id=new.owner_user_id) then raise exception 'STOREFRONT_ANCHOR_MISMATCH';end if;
 return new;
end $$;
create constraint trigger storefront_anchor_guard after insert or update on private.commercial_resources deferrable initially immediate for each row execute function private.storefront_anchor_guard();

create function private.storefront_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'contact',s.contact,'logoMediaId',s.logo_media_id,'ownerUserId',s.owner_user_id,
 'revision',r.content_revision::text,'editorialState',r.moderation_state,'expiresAt',e.expires_at,'entitlementId',e.id,
 'publicationState',case when r.moderation_state='suspended' then 'suspended' when e.administrative_state in('suspended','revoked') then e.administrative_state when e.expires_at<=statement_timestamp() then 'expired' when private.commercial_resource_visible(s.id) then 'active' else 'private' end,
 'remainingSeconds',greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::text,
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'brand',p.brand,'description',p.description,'category',p.category,'storeUrl',p.store_url,'mediaId',p.media_id,'priceCentavos',p.price_centavos::text,'displayOrder',p.display_order,'archived',p.archived) order by p.display_order,p.id) from (select * from public.partner_products where storefront_id=s.id and not archived order by display_order,id limit 20) p),'[]'),
 'productCount',(select count(*) from public.partner_products where storefront_id=s.id and not archived),
 'lastDecision',(select reason from public.commercial_order_events where payload ? 'storefrontId' and payload->>'storefrontId'=s.id::text and action in('approved','rejected','editorial_suspended') order by id desc limit 1))
 from public.product_storefronts s join private.commercial_resources r on r.id=s.id left join public.visibility_entitlements e on e.resource_id=s.id where s.id=p_id
$$;
create index commercial_events_storefront_idx on public.commercial_order_events((payload->>'storefrontId'),id desc) where payload ? 'storefrontId';
create function public.list_managed_storefronts(p_admin boolean default false,p_before uuid default null,p_limit integer default 10) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare items jsonb; tariff jsonb; settings jsonb;
begin
 perform private.require_commercial_user();if p_admin then perform private.require_evocash_admin();end if;
 if p_limit is null or p_limit not between 1 and 20 then raise exception 'INVALID_PAGE';end if;
 select coalesce(jsonb_agg(private.storefront_json(s.id) order by s.id desc),'[]') into items from(select id from public.product_storefronts where (p_admin or owner_user_id=auth.uid()) and (p_before is null or id<p_before) order by id desc limit p_limit)s;
 select jsonb_build_object('price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days,'salesEnabled',f.sales_enabled and f.integration_ready) into tariff from public.commercial_offerings f join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code='product_storefront';
 select jsonb_build_object('maxProducts',max_products,'maxStorefronts',max_storefronts,'revision',revision::text) into settings from public.storefront_settings where id;
 return jsonb_build_object('items',items,'price',tariff,'limits',settings,'serverTime',statement_timestamp(),'nextCursor',case when jsonb_array_length(items)=p_limit then items->-1->>'id' else null end);
end $$;
create function public.list_storefront_products(p_id uuid,p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if not exists(select 1 from public.product_storefronts where id=p_id and (owner_user_id=auth.uid() or public.is_superadmin())) then raise exception 'STOREFRONT_NOT_FOUND';end if;
 if p_offset is null or p_offset not between 0 and 10000 then raise exception 'INVALID_PAGE';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'brand',p.brand,'description',p.description,'category',p.category,'storeUrl',p.store_url,'mediaId',p.media_id,'priceCentavos',p.price_centavos::text,'displayOrder',p.display_order) order by p.display_order,p.id) from (select * from public.partner_products where storefront_id=p_id and not archived order by display_order,id limit 20 offset p_offset)p),'[]');
end $$;
create function public.list_storefront_orders(p_id uuid,p_before timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 if not exists(select 1 from public.product_storefronts where id=p_id and (owner_user_id=auth.uid() or public.is_superadmin())) then raise exception 'STOREFRONT_NOT_FOUND';end if;
 return coalesce((select jsonb_agg(private.commercial_order_json(o) order by o.created_at desc) from(select * from public.commercial_orders where resource_id=p_id and (p_before is null or created_at<p_before) order by created_at desc limit 20)o),'[]');
end $$;

create function public.allocate_storefront_media(p_id uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; mid uuid:=gen_random_uuid(); path text;
begin
 r:=private.lock_storefront(p_id);
 if (select count(*) from public.storefront_media where storefront_id=p_id and created_at>clock_timestamp()-interval '1 hour')>=30 then raise exception 'MEDIA_RATE_LIMIT';end if;
 path:=p_id::text||'/'||mid::text||'.webp';
 insert into public.storefront_media(id,storefront_id,storage_path) values(mid,p_id,path);
 return jsonb_build_object('id',mid,'path',path);
end $$;
create function public.confirm_storefront_media_internal(p_media_id uuid,p_width integer,p_height integer,p_size integer) returns void
language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'PERMISSION_DENIED';end if;
 update public.storefront_media set state='ready',width=p_width,height=p_height,byte_size=p_size where id=p_media_id and state='allocated';
 if not found then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
end $$;
create function public.authorize_storefront_media(p_media_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare m public.storefront_media;
begin
 select * into m from public.storefront_media where id=p_media_id and state='ready';
 if not found then return null;end if;
 if exists(select 1 from public.product_storefronts s where s.id=m.storefront_id and public.has_app_access() and exists(select 1 from public.users where id=auth.uid() and account_status='active') and (s.owner_user_id=auth.uid() or public.is_superadmin())) then return m.storage_path;end if;
 if private.commercial_resource_visible(m.storefront_id) and
 (exists(select 1 from public.product_storefronts where id=m.storefront_id and logo_media_id=m.id) or exists(select 1 from public.partner_products where storefront_id=m.storefront_id and media_id=m.id and not archived)) then return m.storage_path;end if;
 return null;
end $$;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('storefront-media','storefront-media',false,1048576,array['image/webp']);
-- Storage bytes have no client policies/grants: only validated Edge uploads/streams.
-- All public reads go through narrow projections; direct table reads never expose owners.
create or replace function public.public_product_catalog(p_mode text default 'groups',p_search text default '',p_category text default '',p_brand text default '',p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; max_offset integer:=least(greatest(coalesce(p_offset,0),0),10000); lim integer:=least(greatest(coalesce(p_limit,20),1),30);
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if p_mode not in('groups','items','categories','detail','product') or p_mode is null then raise exception 'INVALID_PAGE';end if;
 if p_mode='categories' then return coalesce((select jsonb_agg(category order by category) from(with eligible as materialized(select s.id from public.product_storefronts s where private.commercial_resource_visible(s.id)) select distinct p.category from public.partner_products p join eligible s on s.id=p.storefront_id where not p.archived and p.media_id is not null)c),'[]');end if;
 with eligible as materialized (
 select s.id,s.name,s.description,s.contact,s.logo_media_id,e.expires_at from public.product_storefronts s join public.visibility_entitlements e on e.resource_id=s.id
 where private.commercial_resource_visible(s.id) and (p_mode<>'detail' or s.id::text=p_brand)
 ), products as materialized (
 select p.id,p.storefront_id,p.name,p.brand,p.description,p.category,p.store_url,p.media_id,p.price_centavos::text as price_centavos,p.display_order,e.expires_at,e.name as storefront_name from public.partner_products p join eligible e on e.id=p.storefront_id
 where not p.archived and p.media_id is not null and (coalesce(p_category,'')='' or p.category=p_category)
 and (coalesce(p_search,'')='' or position(lower(left(p_search,80)) in lower(p.name||' '||p.brand||' '||e.name))>0)
 and (p_mode in('groups','detail') or (p_mode='product' and p.id::text=p_brand) or (p_mode<>'product' and (coalesce(p_brand,'')='' or e.id::text=p_brand)))
 ), page as(select * from eligible where exists(select 1 from products where storefront_id=eligible.id) order by id desc limit lim offset max_offset)
 select jsonb_build_object('serverTime',statement_timestamp(),'validUntil',(select min(expires_at) from eligible),
 'totalProducts',(select count(*) from products),'totalBrands',(select count(distinct storefront_id) from products),
 'groups',coalesce((select jsonb_agg(jsonb_build_object('key',s.id,'brand',s.name,'description',s.description,'contact',s.contact,'logoMediaId',s.logo_media_id,'expiresAt',s.expires_at,'count',(select count(*) from products where storefront_id=s.id),'items',(select coalesce(jsonb_agg(to_jsonb(x)),'[]') from(select * from products where storefront_id=s.id order by display_order,id limit 5)x)) order by s.id desc) from page s),'[]'),
 'items',coalesce((select jsonb_agg(to_jsonb(x)) from(select * from products order by display_order,id limit lim offset max_offset)x),'[]')) into result;
 return result;
end $$;
-- Do not let an existing bare anchor masquerade as a storefront when this adapter opens.
do $$begin if exists(select 1 from private.commercial_resources r where offering_code='product_storefront' and not exists(select 1 from public.product_storefronts where id=r.id)) then raise exception 'UNBOUND_STOREFRONT_ANCHORS';end if;end$$;
update public.commercial_offerings set integration_ready=true where code='product_storefront';

-- Default execution is revoked on every new function; only narrow public RPCs are granted.
do $$declare f record;begin
 for f in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where
 (n.nspname='private' and p.proname in('storefront_audit','lock_storefront','touch_storefront','storefront_anchor_guard','storefront_json')) or
 (n.nspname='public' and p.proname in('admin_set_storefront_limits','create_product_storefront','save_product_storefront','save_storefront_product','archive_storefront_product','set_storefront_editorial','list_managed_storefronts','list_storefront_products','list_storefront_orders','allocate_storefront_media','confirm_storefront_media_internal','authorize_storefront_media','public_product_catalog')) loop
 execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',f.nspname,f.proname,f.args);
 if f.nspname='public' then
 if f.proname='confirm_storefront_media_internal' then execute format('grant execute on function public.%I(%s) to service_role',f.proname,f.args);
 else execute format('grant execute on function public.%I(%s) to authenticated',f.proname,f.args);end if;
 if f.proname in('authorize_storefront_media','public_product_catalog') then execute format('grant execute on function public.%I(%s) to anon',f.proname,f.args);end if;
 end if;end loop;
end$$;
-- Cleanup only failed allocations. Published/archived product images are retained.
create function public.discard_storefront_media_internal(p_media_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.role()<>'service_role' then raise exception 'PERMISSION_DENIED';end if;
 delete from public.storefront_media where id=p_media_id and state in('allocated','deleting');
end $$;
revoke all on function public.discard_storefront_media_internal(uuid) from public,anon,authenticated;
grant execute on function public.discard_storefront_media_internal(uuid) to service_role;
create function public.discard_unused_storefront_media(p_media_id uuid) returns text language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare m public.storefront_media;
begin
 select * into m from public.storefront_media where id=p_media_id;
 if not found then return null;end if;
 perform private.lock_storefront(m.storefront_id);
 if exists(select 1 from public.product_storefronts where logo_media_id=m.id) or exists(select 1 from public.partner_products where media_id=m.id) then return null;end if;
 update public.storefront_media set state='deleting' where id=m.id;
 return m.storage_path;
end $$;
revoke all on function public.discard_unused_storefront_media(uuid) from public,anon,service_role;
grant execute on function public.discard_unused_storefront_media(uuid) to authenticated;
