-- Synthetic mass, always rolled back; no stored/public listing or price survives.
begin;
set local statement_timeout='60s';
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values('74600000-0000-0000-0000-000000000001','authenticated','authenticated','sf-performance@example.invalid','x',now(),'{}','{}',now(),now());
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision)
select md5('sf-perf-store:'||i)::uuid,'product_storefront','74600000-0000-0000-0000-000000000001',1 from generate_series(1,1000)i;
insert into public.product_storefronts(id,owner_user_id,name,description)
select id,owner_user_id,'Synthetic shop '||id,'Synthetic description for performance only' from private.commercial_resources where owner_user_id='74600000-0000-0000-0000-000000000001';
update private.commercial_resources set moderation_state='approved',approved_revision=1 where owner_user_id='74600000-0000-0000-0000-000000000001';
insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size)
select md5('sf-perf-media:'||i)::uuid,md5('sf-perf-store:'||((i-1)/10+1))::uuid,md5('sf-perf-store:'||((i-1)/10+1))::uuid::text||'/'||md5('sf-perf-media:'||i)::uuid::text||'.webp','ready',32,32,100 from generate_series(1,10000)i;
insert into public.partner_products(storefront_id,media_id,name,brand,description,category,store_url)
select storefront_id,id,'Synthetic item','Synthetic brand','Synthetic performance product','Fitness','https://example.invalid/product' from public.storefront_media where storefront_id in(select id from public.product_storefronts where owner_user_id='74600000-0000-0000-0000-000000000001');
insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason) values('74600000-0000-0000-0000-000000000002','product_storefront',1000000,1,1,30,now()-interval '1 day','74600000-0000-0000-0000-000000000001','Synthetic performance price rolled back');
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,quote_expires_at,status,fulfilled_at,period_start,period_end)
select md5('sf-perf-order:'||id)::uuid,owner_user_id,gen_random_uuid(),id,'product_storefront','74600000-0000-0000-0000-000000000002',1,7,1,7,clock_timestamp()+interval '5 minutes','fulfilled',now(),now(),now()+interval '168 hours' from public.product_storefronts where owner_user_id='74600000-0000-0000-0000-000000000001';
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at)
select resource_id,id,period_start,period_end from public.commercial_orders where payer_user_id='74600000-0000-0000-0000-000000000001';
analyze public.product_storefronts;analyze private.commercial_resources;analyze public.partner_products;analyze public.visibility_entitlements;
explain(analyze,buffers) select s.id,p.id from public.product_storefronts s join public.partner_products p on p.storefront_id=s.id where s.id=md5('sf-perf-store:500')::uuid and not p.archived and private.commercial_resource_visible(s.id) order by p.display_order,p.id limit 20;
explain(analyze,buffers) select public.public_product_catalog('groups','','','',0,5);
explain(analyze,buffers) select public.public_product_catalog('items','Synthetic','Fitness','',0,20);
explain(analyze,buffers) select public.public_product_catalog('categories');
rollback;
