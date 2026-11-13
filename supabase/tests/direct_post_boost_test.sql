\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
update public.economy_config set config=config||jsonb_build_object('supplierInfo',jsonb_build_object('configured',true)) where id;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('7d000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','direct-boost-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,2)i;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and p.published and u.id::text like '7d000000-%';
insert into public.communities(id,name,created_by,owner_id) values
('7d200000-0000-0000-0000-000000000001','Direct boost fixture','7d000000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) values
('7d200000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001');
insert into public.community_advertising_permissions(community_id,post_boosts_enabled) values
('7d200000-0000-0000-0000-000000000001',true);
insert into public.statuses(id,community_id,author_id,type,expires_at,text) values
('7d300000-0000-0000-0000-000000000001','7d200000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001','text',now()+interval '1 day','Boost me'),
('7d300000-0000-0000-0000-000000000002','7d200000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001','text',now()+interval '1 day','Do not boost me'),
('7d300000-0000-0000-0000-000000000003','7d200000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001','text',now()+interval '1 day','Existing submitted request');
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
values('post_boost',1,7,1,30,now()-interval '1 minute','7d000000-0000-0000-0000-000000000001','Fixture price only');
update public.commercial_offerings set sales_enabled=true where code='post_boost';
update public.advertising_placements set sales_enabled=true,delivery_enabled=true,capacity=10 where code='community_post_boost';
select pg_temp.publish_test_commercial_terms();
select public._wallet_credit_cash('7d000000-0000-0000-0000-000000000001',100);
select pg_temp.set_test_user('7d000000-0000-0000-0000-000000000001',true);
create temp table boost_results(name text primary key,value jsonb); grant all on boost_results to authenticated;
set local role authenticated;
insert into boost_results values('offer',public.get_direct_post_boost_offer('7d300000-0000-0000-0000-000000000001'));
select is((select value->'tariff'->>'price' from boost_results where name='offer'),'7','opening reads configured server price');
select is((select count(*)::integer from public.promotions where target_id='7d300000-0000-0000-0000-000000000001'),0,'opening creates no submitted promotion');
select is((select count(*)::integer from public.commercial_orders),0,'opening creates no quote or debit');
insert into boost_results values('old_submitted',public.prepare_commercial_promotion('post','7d300000-0000-0000-0000-000000000003'));
select is((select status from public.promotions where target_id='7d300000-0000-0000-0000-000000000003'),'submitted','existing request starts submitted with no charge');
select public.get_direct_post_boost_offer('7d300000-0000-0000-0000-000000000003');
select is((select status from public.promotions where target_id='7d300000-0000-0000-0000-000000000003'),'submitted','opening never approves a previous request retroactively');
select public.prepare_direct_post_boost('7d300000-0000-0000-0000-000000000003');
select is((select status from public.promotions where target_id='7d300000-0000-0000-0000-000000000003'),'approved','explicit quote intent converts unchanged submitted request without charge');
insert into boost_results values('prepared',public.prepare_direct_post_boost('7d300000-0000-0000-0000-000000000001'));
select is((select status from public.promotions where id=(select (value->>'resourceId')::uuid from boost_results where name='prepared')),'approved','direct request passes automatic source validation');
select is((select count(*)::integer from public.promotions where target_id='7d300000-0000-0000-0000-000000000001' and status='submitted'),0,'no pending human review');
select is(public.prepare_direct_post_boost('7d300000-0000-0000-0000-000000000001')->>'resourceId',(select value->>'resourceId' from boost_results where name='prepared'),'preparation is idempotent');
select throws_ok($q$select public.quote_commercial_order((select (value->>'resourceId')::uuid from boost_results where name='prepared'),'31',gen_random_uuid())$q$,'INVALID_DURATION','server rejects over-limit days');
insert into boost_results values('quote',public.quote_commercial_order((select (value->>'resourceId')::uuid from boost_results where name='prepared'),'7','7d400000-0000-0000-0000-000000000001'));
select is((select value->>'totalCash' from boost_results where name='quote'),'49','server computes 7 days from versioned price');
select is(public.quote_commercial_order((select (value->>'resourceId')::uuid from boost_results where name='prepared'),'7','7d400000-0000-0000-0000-000000000001')->>'id',(select value->>'id' from boost_results where name='quote'),'quote retry reuses one order');
insert into boost_results values('paid',pg_temp.confirm_with_terms((select (value->>'id')::uuid from boost_results where name='quote'),true));
select is((select value->>'status' from boost_results where name='paid'),'fulfilled','confirmation activates directly');
select is(pg_temp.confirm_with_terms((select (value->>'id')::uuid from boost_results where name='quote'),true)->>'id',(select value->>'id' from boost_results where name='paid'),'confirmation replay is idempotent');
select is((select cash_balance::integer from public.wallets where user_id='7d000000-0000-0000-0000-000000000001'),51,'exactly one debit');
select is((select count(*)::integer from public.economy_transactions where reference_type='commercial_order' and user_id='7d000000-0000-0000-0000-000000000001'),1,'one financial ledger entry');
reset role;
select ok((select expires_at>now()+interval '6 days' from public.visibility_entitlements where resource_id=(select (value->>'resourceId')::uuid from boost_results where name='prepared')),'paid right extends beyond original deadline');
update public.community_advertising_permissions set post_boosts_enabled=false where community_id='7d200000-0000-0000-0000-000000000001';
select ok((select verified_promoted_until is null from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'community permission immediately hides paid promotion');
update public.community_advertising_permissions set post_boosts_enabled=true where community_id='7d200000-0000-0000-0000-000000000001';
update private.commercial_resources set moderation_state='suspended' where id=(select (value->>'resourceId')::uuid from boost_results where name='prepared');
select ok((select verified_promoted_until is null from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'suspension immediately hides paid promotion');
update private.commercial_resources set moderation_state='approved' where id=(select (value->>'resourceId')::uuid from boost_results where name='prepared');
update public.statuses set expires_at=now()-interval '1 hour' where id='7d300000-0000-0000-0000-000000000001';
select ok((select publication_expires_at>now() and verified_promoted_until>now() from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'effective publication stays live after original expiry');
select ok(private.comments_open((select s from public.statuses s where id='7d300000-0000-0000-0000-000000000001')),'comments stay open during paid right');
update public.status_expiration_control set enabled=true where id;
select public.process_expired_statuses(50);
select ok(exists(select 1 from public.statuses where id='7d300000-0000-0000-0000-000000000001'),'expiration worker preserves paid post');
set local role authenticated;
insert into boost_results values('renew',public.quote_commercial_order((select (value->>'resourceId')::uuid from boost_results where name='prepared'),'2',gen_random_uuid()));
insert into boost_results values('renew_paid',pg_temp.confirm_with_terms((select (value->>'id')::uuid from boost_results where name='renew'),true));
select ok((select (value->>'periodStart')::timestamptz=(select (value->>'periodEnd')::timestamptz from boost_results where name='paid') from boost_results where name='renew_paid'),'renewal begins after prior contracted period');
insert into boost_results values('too_expensive',public.quote_commercial_order((select (value->>'resourceId')::uuid from boost_results where name='prepared'),'30',gen_random_uuid()));
select throws_ok($q$select pg_temp.confirm_with_terms((select (value->>'id')::uuid from boost_results where name='too_expensive'),true)$q$,'Saldo de EvoCash insuficiente.','insufficient balance cannot debit');
reset role;
select is((select count(*)::integer from public.commercial_order_events where action in('fulfilled','renewed') and offering_code='post_boost'),2,'both purchases retain audit events');
update public.statuses set text='Edited after payment' where id='7d300000-0000-0000-0000-000000000001';
select ok((select verified_promoted_until is null from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'edited source loses advertising authorization');
update public.statuses set text='Boost me' where id='7d300000-0000-0000-0000-000000000001';
select ok((select verified_promoted_until>now() from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'original approved content regains its paid window');
update public.visibility_entitlements set starts_at=now()-interval '10 days',expires_at=now()-interval '1 second'
 where resource_id=(select (value->>'resourceId')::uuid from boost_results where name='prepared');
select ok((select verified_promoted_until is null from public.status_publications where id='7d300000-0000-0000-0000-000000000001'),'ended paid period is no longer advertised');
select public.process_expired_statuses(50);
select ok(not exists(select 1 from public.statuses where id='7d300000-0000-0000-0000-000000000001'),'expired paid post is deleted after right ends');
delete from public.statuses where id='7d300000-0000-0000-0000-000000000002';
select pg_temp.set_test_user('7d000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($q$select public.get_direct_post_boost_offer('7d300000-0000-0000-0000-000000000002')$q$,'PROMOTION_SOURCE_CHANGED','removed publication cannot be bought');
reset role;
select pg_temp.set_test_user('7d000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($q$select public.get_direct_post_boost_offer('7d300000-0000-0000-0000-000000000001')$q$,'PROMOTION_SOURCE_CHANGED','other user cannot access the offer');
reset role;
select ok(not has_function_privilege('anon','public.prepare_direct_post_boost(uuid)','execute'),'anonymous cannot prepare direct boost');
select * from finish();
rollback;
