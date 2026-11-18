\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
select no_plan();
-- Isolate from committed synthetic preview fixtures. Every change rolls back.
update private.commercial_resources set moderation_state='suspended' where offering_code='ad_home';
update public.advertising_placements set capacity=0,revision=0,sales_enabled=false,delivery_enabled=false where code='home_banner';
update public.commercial_offerings set sales_enabled=false where code='ad_home';

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('76500000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','ads-duration-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,2)i;
update public.users set role='superadmin' where id='76500000-0000-0000-0000-000000000002';
create function pg_temp.ads_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('76500000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table d_results(name text primary key,value jsonb); grant all on d_results to authenticated;

select pg_temp.set_test_user('76500000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into d_results values('account',to_jsonb(public.create_advertising_account('Synthetic duration advertiser')));
select public.create_advertising_campaign((select(value#>>'{}')::uuid from d_results where name='account'),'home_banner',null,'Whey synthetic','','https://example.invalid/duration','76510000-0000-0000-0000-000000000001');

-- Desired duration is a stored intention on the draft, not a contract: settable before
-- any submission, bounded, and preserved by later edits that omit it.
select throws_ok($$select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000001',1,'Whey synthetic','','https://example.invalid/duration',false,null,0)$$,'INVALID_DURATION','zero days is rejected');
select throws_ok($$select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000001',1,'Whey synthetic','','https://example.invalid/duration',false,null,3651)$$,'INVALID_DURATION','above the 3650-day sanity bound is rejected');
select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000001',1,'Whey synthetic','','https://example.invalid/duration',false,null,7);
select is((select (x->>'desired_duration_days')::integer from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),7,'desired duration is readable from the same consolidated projection');
select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000001',2,'Whey synthetic','Agora com descrição','https://example.invalid/duration',true);
select is((select (x->>'desired_duration_days')::integer from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),7,'omitting the parameter on a later edit never clears the stored preference');
reset role;
select is((select count(*)::integer from public.visibility_entitlements where resource_id='76510000-0000-0000-0000-000000000001'),0,'choosing a desired duration never starts a contract period');
select is((select count(*)::integer from private.advertising_reservations res join public.commercial_orders o on o.id=res.order_id where o.resource_id='76510000-0000-0000-0000-000000000001'),0,'choosing a desired duration never reserves inventory');

select pg_temp.ads_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('76510000-0000-0000-0000-000000000001',3,true,'Synthetic duration approval');
select public.admin_configure_advertising_placement('home_banner',1,true,true,0,'Synthetic capacity for delivery test',true);
reset role;
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'ad_home',coalesce(max(revision),0)+1,7,1,30,clock_timestamp(),'76500000-0000-0000-0000-000000000002','Synthetic price only' from public.commercial_price_versions where offering_code='ad_home';
update public.commercial_offerings set sales_enabled=true where code='ad_home';
select public._wallet_credit_cash('76500000-0000-0000-0000-000000000001',100);
select public._ledger_record('76500000-0000-0000-0000-000000000001','synthetic-ads-duration','cash','credit',100,'synthetic','fixture','ads');

-- Approved + fully paid + placement actually enabled: the one case where the consolidated
-- per-placement signal must be true.
select pg_temp.set_test_user('76500000-0000-0000-0000-000000000001',true);
set local role authenticated;

-- 20261222000010: desired_duration_days agora valida contra a faixa real da oferta vigente
-- (min_days/max_days de commercial_price_versions), não só o limite genérico de 1-3650.
select public.create_advertising_campaign((select(value#>>'{}')::uuid from d_results where name='account'),'home_banner',null,'Whey synthetic range','','https://example.invalid/duration-range','76510000-0000-0000-0000-000000000002');
select throws_ok($$select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000002',1,'Whey synthetic range','','https://example.invalid/duration-range',false,null,31)$$,'AD_DURATION_OUT_OF_OFFER_RANGE','above the offer''s real max_days (30) is rejected even though it is inside the generic 3650 sanity bound');
select public.edit_advertising_campaign('76510000-0000-0000-0000-000000000002',1,'Whey synthetic range','','https://example.invalid/duration-range',false,null,30);
select is((select (x->>'desired_duration_days')::integer from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000002'),30,'exactly the offer''s real max_days is accepted');

select pg_temp.publish_test_commercial_terms(); -- 20261212000002: termos comerciais sintéticos publicados
insert into d_results values('quote',public.quote_commercial_order('76510000-0000-0000-0000-000000000001','2',gen_random_uuid()));
insert into d_results values('paid',pg_temp.confirm_with_terms((select(value->>'id')::uuid from d_results where name='quote'),true));
select is((select x->>'delivery_state' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'active','paid approved campaign is visible to the resource-level check');
select is((select x->>'placement_delivery_active' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'true','home_banner is delivery_enabled with an active fulfilled reservation');

-- The gap this migration closes: commercial_resource_visible alone never looks at the
-- placement''s own delivery_enabled gate, so a resource-level check alone could still say
-- "active" after an administrator pauses delivery at the placement. The consolidated
-- per-placement signal must catch this without a per-card RPC call.
reset role;
select pg_temp.ads_admin();
set local role authenticated;
select public.admin_configure_advertising_placement('home_banner',1,true,false,1,'Synthetic delivery pause only',true);
reset role;
select pg_temp.set_test_user('76500000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select x->>'delivery_state' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'active','the resource-level signal alone still says active (the known gap)');
select is((select x->>'placement_delivery_active' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from d_results where name='account'))) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'false','the consolidated placement signal correctly flips to false once delivery is paused at the placement');

-- Re-enable placement delivery, then prove the other half of the gap: commercial_resource_visible
-- checks the USER''s account_status, never the advertiser ACCOUNT''s own active flag, so a
-- deactivated advertiser account alone would otherwise still read as "active" too. Reusing
-- private.advertising_eligible (rather than a hand-rolled copy) catches this for free.
reset role;
select pg_temp.ads_admin();
set local role authenticated;
select public.admin_configure_advertising_placement('home_banner',1,true,true,2,'Synthetic delivery resume',true);
reset role;
update public.advertiser_accounts set active=false where id=(select(value#>>'{}')::uuid from d_results where name='account');
-- A deactivated account loses access to its own campaign summary entirely (defense in
-- depth), so the per-row signal is exercised from the admin-wide read instead.
select pg_temp.set_test_user('76500000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok(
  format('select public.get_advertising_campaigns(%L::uuid)', (select(value#>>'{}')::uuid from d_results where name='account')),
  'PERMISSION_DENIED',
  'a deactivated advertiser account loses read access to its own campaigns entirely'
);
reset role;
select pg_temp.ads_admin();
set local role authenticated;
select is((select x->>'delivery_state' from jsonb_array_elements(public.get_advertising_campaigns(null)) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'active','the resource-level signal alone does not look at the advertiser account''s own active flag either');
select is((select x->>'placement_delivery_active' from jsonb_array_elements(public.get_advertising_campaigns(null)) x where x->>'ad_id'='76510000-0000-0000-0000-000000000001'),'false','a deactivated advertiser account also correctly flips the consolidated signal to false');

select * from finish();
rollback;
