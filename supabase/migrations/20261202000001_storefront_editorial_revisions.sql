-- Phase 4.1: drafts separated from the approved publication. No financial mutation.
set local lock_timeout='5s';
set local statement_timeout='60s';
alter table public.product_storefronts add column draft_revision bigint not null default 1 check(draft_revision>0),
 add column draft_state text not null default 'draft' check(draft_state in('draft','submitted','approved','rejected'));
update public.product_storefronts s set draft_revision=r.content_revision,
 draft_state=case when r.moderation_state in('submitted','approved','rejected') then r.moderation_state else 'draft' end
 from private.commercial_resources r where r.id=s.id;
alter table public.partner_products add unique(id,storefront_id), add column legacy_image_url text;
create table public.storefront_publications (
 storefront_id uuid primary key references public.product_storefronts(id),
 revision bigint not null check(revision>0),
 name text not null, description text not null, contact text not null,
 logo_media_id uuid,
 approved_at timestamptz not null default clock_timestamp(),
 foreign key(logo_media_id,storefront_id) references public.storefront_media(id,storefront_id)
);
create table public.storefront_published_products (
 product_id uuid primary key,
 storefront_id uuid not null references public.storefront_publications(storefront_id),
 foreign key(product_id,storefront_id) references public.partner_products(id,storefront_id),
 name text not null,brand text not null,description text not null,category text not null,store_url text not null,
 media_id uuid not null,price_centavos bigint,display_order integer not null,
 foreign key(media_id,storefront_id) references public.storefront_media(id,storefront_id)
);
create index storefront_published_products_page_idx on public.storefront_published_products(storefront_id,display_order,product_id);
alter table public.storefront_publications enable row level security;
alter table public.storefront_published_products enable row level security;
revoke all on public.storefront_publications,public.storefront_published_products from public,anon,authenticated,service_role;
-- Backfill only revisions that are already approved; never reconstruct overwritten drafts.
insert into public.storefront_publications(storefront_id,revision,name,description,contact,logo_media_id)
 select s.id,r.approved_revision,s.name,s.description,s.contact,s.logo_media_id from public.product_storefronts s
 join private.commercial_resources r on r.id=s.id where r.moderation_state='approved' and r.approved_revision=r.content_revision;
insert into public.storefront_published_products(product_id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order)
 select p.id,p.storefront_id,p.name,p.brand,p.description,p.category,p.store_url,p.media_id,p.price_centavos,p.display_order
 from public.partner_products p join public.storefront_publications s on s.storefront_id=p.storefront_id where not p.archived and p.media_id is not null;

create or replace function private.touch_storefront(p_id uuid) returns void language plpgsql set search_path='' as $$
begin
 update public.product_storefronts set draft_revision=draft_revision+1,draft_state='draft',updated_at=clock_timestamp() where id=p_id;
 -- Only unpublished anchors follow the draft state. Approved anchors remain stable for renewals.
 update private.commercial_resources set moderation_state='draft' where id=p_id and approved_revision is null and moderation_state not in('suspended','archived');
end $$;

create or replace function public.save_product_storefront(p_id uuid,p_revision bigint,p_name text,p_description text,p_contact text,p_logo_media_id uuid default null) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 r:=private.lock_storefront(p_id);
 if (select draft_revision from public.product_storefronts where id=p_id) is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_name is null or p_description is null or p_contact is null then raise exception 'INVALID_STOREFRONT';end if;
 if p_logo_media_id is not null and not exists(select 1 from public.storefront_media where id=p_logo_media_id and storefront_id=p_id and state='ready') then raise exception 'INVALID_STOREFRONT_MEDIA';end if;
 update public.product_storefronts set name=btrim(p_name),description=btrim(p_description),contact=btrim(p_contact),logo_media_id=p_logo_media_id where id=p_id;
 perform private.touch_storefront(p_id);
 perform private.storefront_audit(p_id,'storefront_edited',jsonb_build_object('previousRevision',p_revision));
end $$;

create or replace function public.save_storefront_product(p_storefront_id uuid,p_revision bigint,p_product_id uuid,p_data jsonb) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; n integer; pid uuid; m uuid;
begin
 r:=private.lock_storefront(p_storefront_id);
 if (select draft_revision from public.product_storefronts where id=p_storefront_id) is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
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
 perform private.storefront_audit(p_storefront_id,'product_saved',jsonb_build_object('productId',pid,'previousRevision',p_revision));
 return pid;
end $$;

create or replace function public.archive_storefront_product(p_storefront_id uuid,p_revision bigint,p_product_id uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 r:=private.lock_storefront(p_storefront_id);
 if (select draft_revision from public.product_storefronts where id=p_storefront_id) is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 update public.partner_products set archived=true where id=p_product_id and storefront_id=p_storefront_id and not archived;
 if not found then raise exception 'PRODUCT_NOT_FOUND';end if;
 perform private.touch_storefront(p_storefront_id);
 perform private.storefront_audit(p_storefront_id,'product_archived',jsonb_build_object('productId',p_product_id));
end $$;

create or replace function private.storefront_json(p_id uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'contact',s.contact,'logoMediaId',s.logo_media_id,'ownerUserId',s.owner_user_id,
 'revision',s.draft_revision::text,'draftState',s.draft_state,'editorialState',case when r.moderation_state in('suspended','archived') then r.moderation_state else s.draft_state end,'hasPublishedVersion',exists(select 1 from public.storefront_publications where storefront_id=s.id),'publishedRevision',r.approved_revision::text,'canContract',r.moderation_state='approved' and r.approved_revision=r.content_revision,'expiresAt',e.expires_at,'entitlementId',e.id,
 'publicationState',case when r.moderation_state='suspended' then 'suspended' when e.administrative_state in('suspended','revoked') then e.administrative_state when e.expires_at<=statement_timestamp() then 'expired' when private.commercial_resource_visible(s.id) then 'active' else 'private' end,
 'remainingSeconds',greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::text,
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'brand',p.brand,'description',p.description,'category',p.category,'storeUrl',p.store_url,'mediaId',p.media_id,'priceCentavos',p.price_centavos::text,'displayOrder',p.display_order,'archived',p.archived) order by p.display_order,p.id) from (select * from public.partner_products where storefront_id=s.id and not archived order by display_order,id limit 20) p),'[]'),
 'productCount',(select count(*) from public.partner_products where storefront_id=s.id and not archived),
 'lastDecision',(select reason from public.commercial_order_events where payload ? 'storefrontId' and payload->>'storefrontId'=s.id::text and action in('approved','rejected','editorial_suspended') order by id desc limit 1))
 from public.product_storefronts s join private.commercial_resources r on r.id=s.id left join public.visibility_entitlements e on e.resource_id=s.id where s.id=p_id
$$;
create or replace function public.set_storefront_editorial(p_id uuid,p_revision bigint,p_state text,p_reason text default '') returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources; s public.product_storefronts; period jsonb;
begin
 r:=private.lock_storefront(p_id);
 select * into s from public.product_storefronts where id=p_id;
 if s.draft_revision is distinct from p_revision then raise exception 'EDITORIAL_REVISION_CONFLICT';end if;
 if p_state is null or p_state not in('submitted','approved','rejected','suspended','archived','draft') then raise exception 'INVALID_EDITORIAL_STATE';end if;
 if p_state in('approved','rejected','suspended') or r.moderation_state='suspended' then
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'MODERATION_REASON_REQUIRED';end if;
 if r.moderation_state='suspended' and p_state<>'draft' then raise exception 'STOREFRONT_SUSPENDED';end if;
 if p_state in('approved','rejected') and s.draft_state<>'submitted' then raise exception 'CONTENT_NOT_SUBMITTED';end if;
 end if;
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
-- Relational, current-time eligibility: no per-row SECURITY DEFINER function scans.
create view private.live_storefronts as
 select p.*,e.expires_at from public.storefront_publications p
 join public.product_storefronts s on s.id=p.storefront_id
 join private.commercial_resources r on r.id=s.id
 join public.users u on u.id=s.owner_user_id
 join public.commercial_offerings f on f.code=r.offering_code
 join public.visibility_entitlements e on e.resource_id=s.id
 where f.integration_ready and u.account_status='active' and r.moderation_state='approved'
 and r.content_revision=r.approved_revision and p.revision=r.approved_revision
 and e.administrative_state='enabled' and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp()
 and not exists(select 1 from public.account_restrictions a where a.user_id=u.id and not(a.action='temporary_suspension' and a.until<=statement_timestamp()));
revoke all on private.live_storefronts from public,anon,authenticated,service_role;

create or replace function public.authorize_storefront_media(p_media_id uuid) returns text language plpgsql stable security definer set search_path='' as $$
declare m public.storefront_media;
begin
 select * into m from public.storefront_media where id=p_media_id and state='ready';
 if not found then return null;end if;
 if exists(select 1 from public.product_storefronts s where s.id=m.storefront_id and public.has_app_access() and exists(select 1 from public.users where id=auth.uid() and account_status='active') and(s.owner_user_id=auth.uid() or public.is_superadmin())) then return m.storage_path;end if;
 if exists(select 1 from private.live_storefronts s where s.storefront_id=m.storefront_id and
 (s.logo_media_id=m.id or exists(select 1 from public.storefront_published_products where storefront_id=s.storefront_id and media_id=m.id))) then return m.storage_path;end if;
 return null;
end $$;
create or replace function public.public_product_catalog(p_mode text default 'groups',p_search text default '',p_category text default '',p_brand text default '',p_offset integer default 0,p_limit integer default 20) returns jsonb
language plpgsql stable security definer set search_path='' set plan_cache_mode='force_custom_plan' as $$
declare result jsonb; off integer:=least(greatest(coalesce(p_offset,0),0),10000); lim integer:=least(greatest(coalesce(p_limit,20),1),30); target uuid; scope_id uuid; term text:=lower(left(coalesce(p_search,''),80));
begin
 perform set_config('response.headers','[{"Cache-Control":"no-store"},{"CDN-Cache-Control":"no-store"}]',true);
 if p_mode not in('groups','items','categories','detail','product') or p_mode is null then raise exception 'INVALID_PAGE';end if;
 if coalesce(p_brand,'')<>'' then
 if p_brand !~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then return jsonb_build_object('groups','[]'::jsonb,'items','[]'::jsonb,'totalProducts',0,'totalBrands',0,'serverTime',statement_timestamp());end if;
 target:=p_brand::uuid;end if;
 scope_id:=target;
 if p_mode='product' then
 select storefront_id into scope_id from public.storefront_published_products where product_id=target;
 if not found then return jsonb_build_object('groups','[]'::jsonb,'items','[]'::jsonb,'totalProducts',0,'totalBrands',0,'serverTime',statement_timestamp());end if;
 end if;
 if p_mode='categories' then
 return coalesce((with live as materialized(select storefront_id from private.live_storefronts)
 select jsonb_agg(category order by category) from(select distinct p.category from public.storefront_published_products p join live s on s.storefront_id=p.storefront_id)c),'[]');end if;
 if p_mode='groups' then
 with live as materialized(select * from private.live_storefronts),
 counts as(select p.storefront_id,count(*) n from public.storefront_published_products p join live s on s.storefront_id=p.storefront_id group by p.storefront_id),
 page as(select s.*,c.n from live s join counts c on c.storefront_id=s.storefront_id order by s.storefront_id desc limit lim offset off)
 select jsonb_build_object('serverTime',statement_timestamp(),'validUntil',(select min(expires_at) from page),
 'totalProducts',coalesce((select sum(n) from counts),0),'totalBrands',(select count(*) from counts),'items','[]'::jsonb,
 'groups',coalesce(jsonb_agg(jsonb_build_object('key',s.storefront_id,'brand',s.name,'description',s.description,'contact',s.contact,'logoMediaId',s.logo_media_id,'expiresAt',s.expires_at,'count',s.n,
 'items',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from(select product_id as id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos::text as price_centavos,display_order,s.expires_at,s.name as storefront_name from public.storefront_published_products where storefront_id=s.storefront_id order by display_order,product_id limit 5)p)) order by s.storefront_id desc),'[]')) into result from page s;
 else
 with live as materialized(select * from private.live_storefronts s where scope_id is null or s.storefront_id=scope_id),
 filtered as materialized(select p.product_id as id,p.storefront_id,p.name,p.brand,p.description,p.category,p.store_url,p.media_id,p.price_centavos::text as price_centavos,p.display_order,s.expires_at,s.name as storefront_name
 from public.storefront_published_products p join live s on s.storefront_id=p.storefront_id
 where (p_mode<>'product' or p.product_id=target) and (coalesce(p_category,'')='' or p.category=p_category)
 and(term='' or position(term in lower(p.name||' '||p.brand||' '||s.name))>0)),
 page as(select * from filtered order by display_order,id limit lim offset off)
 select jsonb_build_object('serverTime',statement_timestamp(),'validUntil',(select min(expires_at) from page),'totalProducts',(select count(*) from filtered),'totalBrands',(select count(distinct storefront_id) from filtered),
 'items',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'),
 'groups',case when p_mode='detail' then coalesce((select jsonb_agg(jsonb_build_object('key',s.storefront_id,'brand',s.name,'description',s.description,'contact',s.contact,'logoMediaId',s.logo_media_id,'expiresAt',s.expires_at)) from live s where exists(select 1 from filtered where storefront_id=s.storefront_id)),'[]') else '[]'::jsonb end) into result;
 end if;
 return result;
end $$;
create function public.public_storefront_sitemap(p_before uuid default null,p_limit integer default 500) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('serverTime',statement_timestamp(),'items',coalesce(jsonb_agg(jsonb_build_object('id',storefront_id,'updatedAt',approved_at,'expiresAt',expires_at) order by storefront_id desc),'[]'))
 from(select s.storefront_id,s.approved_at,s.expires_at from private.live_storefronts s where(p_before is null or s.storefront_id<p_before) and exists(select 1 from public.storefront_published_products p where p.storefront_id=s.storefront_id) order by s.storefront_id desc limit least(greatest(coalesce(p_limit,500),1),500))s
$$;
revoke all on function public.public_storefront_sitemap(uuid,integer) from public,service_role;
grant execute on function public.public_storefront_sitemap(uuid,integer) to anon,authenticated;
