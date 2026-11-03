\ir auth_session.sql
\ir commercial_terms.sql
begin;
select no_plan();
update private.commercial_resources set moderation_state='draft' where offering_code='product_storefront';
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('74000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','storefront-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,3)i;
update public.users set role='superadmin' where id='74000000-0000-0000-0000-000000000003';
create function pg_temp.sf_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('74000000-0000-0000-0000-000000000003',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table sf_results(k text primary key,v text);grant all on sf_results to authenticated;grant select on sf_results to anon;
create function pg_temp.sf_rev(p_id uuid) returns bigint language sql security definer set search_path='' as $$select draft_revision from public.product_storefronts where id=p_id$$;
select pg_temp.sf_admin();
set local role authenticated;
select throws_ok($$select public.admin_set_storefront_limits(10,2,0,'Synthetic setup',false)$$,'INVALID_STOREFRONT_LIMITS','limits require explicit consent');
reset role;
-- Make limits independent of preview fixtures while preserving rollback.
update public.storefront_settings set max_products=null,max_storefronts=null,revision=0;
select pg_temp.set_test_user('74000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.create_product_storefront('Synthetic storefront',gen_random_uuid())$$,'STOREFRONT_LIMITS_UNCONFIGURED','no invented limits are implicitly approved');
reset role;
select pg_temp.sf_admin();
set local role authenticated;
select public.admin_set_storefront_limits(3,2,0,'Synthetic fixtures only',true);
select throws_ok($$select public.admin_set_storefront_limits(4,2,0,'Concurrent stale change',true)$$,'PRICE_REVISION_CONFLICT','limits use CAS');
reset role;
select pg_temp.set_test_user('74000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into sf_results values('sf',public.create_product_storefront('Synthetic storefront','74100000-0000-0000-0000-000000000001')::text);
select is(public.create_product_storefront('Synthetic storefront','74100000-0000-0000-0000-000000000001')::text,(select v from sf_results where k='sf'),'create replay yields same storefront');
select throws_ok($$select public.create_product_storefront('Changed name','74100000-0000-0000-0000-000000000001')$$,'IDEMPOTENCY_CONFLICT','create key cannot change payload');
select is(public.list_managed_storefronts()->'items'->0->>'editorialState','draft','new storefront is draft');
select public.save_product_storefront((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),'Synthetic storefront','A real description for a synthetic storefront','Public contact');
insert into sf_results values('product',public.save_storefront_product((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),null,'{}')::text);
select is(public.list_managed_storefronts()->'items'->0->'products'->0->>'name','','incomplete product drafts allowed without image');
select throws_ok($$select public.set_storefront_editorial((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),'submitted')$$,'STOREFRONT_INCOMPLETE','incomplete product cannot be submitted');
select throws_ok($$select public.save_storefront_product((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),null,'{"owner_user_id":"fake"}')$$,'INVALID_PRODUCT','ownership parameters rejected');
select throws_ok($$update public.visibility_entitlements set expires_at=clock_timestamp()+interval '1 year'$$,'42501',null,'expiry cannot be edited by client');
select throws_ok($$select public.confirm_storefront_media_internal(gen_random_uuid(),1,1,30)$$,'42501',null,'only media backend may attest bytes');
select is(public.authorize_storefront_media(gen_random_uuid()),null::text,'missing media returns null safely');
reset role;
-- Synthetic verified media metadata for SQL tests. Real bytes validated separately via HTTP.
insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size)
select '74200000-0000-0000-0000-000000000001',v::uuid,v||'/74200000-0000-0000-0000-000000000001.webp','ready',32,32,100 from sf_results where k='sf';
set local role authenticated;
select public.save_storefront_product((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),(select v::uuid from sf_results where k='product'),'{"name":"Synthetic product","brand":"Test brand","description":"Complete synthetic product","category":"Fitness","storeUrl":"https://example.invalid/product","mediaId":"74200000-0000-0000-0000-000000000001","priceCentavos":"1234"}');
select public.set_storefront_editorial((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),'submitted');
select throws_ok($$select public.set_storefront_editorial((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),'approved','User cannot approve')$$,'42501','PERMISSION_DENIED','owner cannot approve self');
select is(public.public_product_catalog('items')->>'totalProducts','0','unpaid unapproved storefront remains private');
reset role;
select pg_temp.sf_admin();
set local role authenticated;
select public.set_storefront_editorial((select v::uuid from sf_results where k='sf'),pg_temp.sf_rev((select v::uuid from sf_results where k='sf')),'approved','Synthetic approval after review');
select throws_ok($$select public.set_storefront_editorial((select v::uuid from sf_results where k='sf'),0,'suspended','Stale review')$$,'EDITORIAL_REVISION_CONFLICT','moderator cannot overwrite newer revision');
reset role;
select is((select count(*)::integer from public.commercial_orders where resource_id=(select v::uuid from sf_results where k='sf')),0,'creation editing approval never create a financial order');
select ok(not private.commercial_resource_visible((select v::uuid from sf_results where k='sf')),'approval alone does not publish');
-- Publish only a transactional synthetic tariff, not migration data.
update public.commercial_offerings set sales_enabled=false where code='product_storefront';
select public.admin_publish_commercial_price('product_storefront','7',1,30,null,(select revision from public.commercial_offerings where code='product_storefront'),gen_random_uuid(),'Synthetic tariff only',true);
select public.admin_set_commercial_sales('product_storefront',true,(select revision from public.commercial_offerings where code='product_storefront'),gen_random_uuid(),'Synthetic sales only',true);
select pg_temp.set_test_user('74000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.publish_test_commercial_terms(); -- 20261212000002: termos comerciais sintéticos publicados
insert into sf_results values('quote',public.quote_commercial_order((select v::uuid from sf_results where k='sf'),'7',gen_random_uuid())->>'id');
select throws_ok($$select pg_temp.confirm_with_terms((select v::uuid from sf_results where k='quote'),true)$$,'Saldo de EvoCash insuficiente.','insufficient cash cannot publish');
reset role;
select public._wallet_credit_cash('74000000-0000-0000-0000-000000000001',200);
select public._ledger_record('74000000-0000-0000-0000-000000000001','sf-test-seed','cash','credit',200,'synthetic','fixture','phase4');
set local role authenticated;
select pg_temp.confirm_with_terms((select v::uuid from sf_results where k='quote'),true);
select pg_temp.confirm_with_terms((select v::uuid from sf_results where k='quote'),true);
reset role;
select is((select cash_balance from public.wallets where user_id='74000000-0000-0000-0000-000000000001'),151,'seven days debit once for the entire storefront');
select is((select count(*)::integer from public.economy_transactions where reference_id=(select v from sf_results where k='quote') and direction='debit'),1,'one ledger record per commercial order');
select is((select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id=(select v::uuid from sf_results where k='sf')),604800::bigint,'exact 168-hour storefront period');
set local role anon;
select is(public.public_product_catalog('items')->>'totalProducts','1','anonymous catalogue returns paid approved product');
select is(public.public_product_catalog('detail','', '',(select v from sf_results where k='sf'))->'groups'->0->>'brand','Synthetic storefront','direct detail is eligible');
select ok(not (public.public_product_catalog('items')->'items'->0 ? 'owner_user_id'),'public projection has no owner identifier');
select ok(public.authorize_storefront_media('74200000-0000-0000-0000-000000000001') is not null,'eligible product media authorized anonymously');
select throws_ok($$select * from public.product_storefronts$$,'42501',null,'anonymous direct storefront read denied');
select throws_ok($$select * from public.partner_products$$,'42501',null,'legacy API cannot bypass commercial visibility');
reset role;
