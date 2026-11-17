\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
select no_plan();
-- Isolate from committed synthetic preview fixtures. Every change rolls back.
truncate private.advertising_reservations;
update private.commercial_resources set moderation_state='suspended' where offering_code like 'ad_%';
update public.advertising_placements set capacity=0,revision=0,sales_enabled=false,delivery_enabled=false where code='home_banner';
update public.commercial_offerings set sales_enabled=false where code='ad_home';
delete from private.advertising_network_bundle;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('76000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','ads-phase6-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,4)i;
update public.users set role='superadmin' where id='76000000-0000-0000-0000-000000000003';
create function pg_temp.ads_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('76000000-0000-0000-0000-000000000003',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table ads_results(name text primary key,value jsonb); grant all on ads_results to authenticated;
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into ads_results values('account',to_jsonb(public.create_advertising_account('Synthetic advertiser')));
select throws_ok($$select public.create_advertising_account('Duplicate')$$,'AD_ACCOUNT_EXISTS','account creation cannot spam');
insert into ads_results values('ad',to_jsonb(public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Synthetic campaign','Only synthetic content','https://example.invalid/ads','76100000-0000-0000-0000-000000000001')));
select is(public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Synthetic campaign','Only synthetic content','https://example.invalid/ads','76100000-0000-0000-0000-000000000001'),'76100000-0000-0000-0000-000000000001'::uuid,'creation replay returns same resource');
select throws_ok($$select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Changed','Only synthetic content','https://example.invalid/ads','76100000-0000-0000-0000-000000000001')$$,'IDEMPOTENCY_CONFLICT','creation replay rejects changed content');
select throws_ok($$select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'network',null,'Network','','https://example.invalid/ads',gen_random_uuid())$$,'AD_NETWORK_UNCONFIGURED','network does not include surfaces automatically');
select throws_ok($$select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Unsafe URL','','javascript:alert(1)',gen_random_uuid())$$,'23514',null,'unsafe destination protocol is rejected');
select throws_ok($$select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Unsafe authority','','https://user@example.invalid/',gen_random_uuid())$$,'23514',null,'destination authority cannot contain credentials');
select is((select count(*)::integer from public.sponsored_ads where id='76100000-0000-0000-0000-000000000001'),0,'draft hidden by RLS');
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'unconfigured surface has no ad');
select is(jsonb_array_length(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))),1,'owner sees private campaign summary');
select pg_temp.publish_test_commercial_terms(); -- 20261212000002: termos comerciais sintéticos publicados
select throws_ok($$select public.quote_commercial_order('76100000-0000-0000-0000-000000000001','1',gen_random_uuid())$$,'COMMERCIAL_SALES_PAUSED','sales closed by default');
select public.edit_advertising_campaign('76100000-0000-0000-0000-000000000001',1,'Synthetic campaign','Only synthetic content','https://example.invalid/ads',true);
reset role;
select pg_temp.ads_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('76100000-0000-0000-0000-000000000001',2,true,'Synthetic editorial approval');
select public.admin_configure_advertising_placement('home_banner',1,true,true,0,'Synthetic capacity only',true);
-- Dynamic current revision: no assumptions about previous synthetic fixture configuration.
reset role;
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'ad_home',coalesce(max(revision),0)+1,7,1,30,clock_timestamp(),'76000000-0000-0000-0000-000000000003','Synthetic price only' from public.commercial_price_versions where offering_code='ad_home';
update public.commercial_offerings set sales_enabled=true where code='ad_home';
select public._wallet_credit_cash('76000000-0000-0000-0000-000000000001',100);
select public._ledger_record('76000000-0000-0000-0000-000000000001','synthetic-ads-phase6','cash','credit',100,'synthetic','fixture','ads');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into ads_results values('quote',public.quote_commercial_order('76100000-0000-0000-0000-000000000001','2',gen_random_uuid()));
select is((select value->>'totalCash' from ads_results where name='quote'),'14','PostgreSQL computes daily price');
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'approved unpaid ad not delivered');
insert into ads_results values('paid',pg_temp.confirm_with_terms((select(value->>'id')::uuid from ads_results where name='quote'),true));
select is(pg_temp.confirm_with_terms((select(value->>'id')::uuid from ads_results where name='quote'),true),(select value from ads_results where name='paid'),'payment replay returns same order');
select is(jsonb_array_length(public.select_advertising('home_banner',null)),1,'approved paid reserved ad delivered');
select public.edit_advertising_campaign('76100000-0000-0000-0000-000000000001',2,'Pending secret revision','Not public','https://example.invalid/revision',true);
select is(public.select_advertising('home_banner',null)->0->>'title','Synthetic campaign','pending revision never replaces projection');
-- The owner-facing summary must say the same thing a different way: still delivering
-- the last approved version, with a newer unreviewed revision on file (never "Em análise"
-- as if the live campaign had gone dark).
select is((select x->>'moderation_state' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'approved','live campaign stays approved while a revision is pending review');
select is((select x->>'delivery_state' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'active','paid campaign keeps delivering its last approved version during a pending revision');
select is((select (x->>'version')::bigint from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),3::bigint,'a newer unreviewed revision exists');
select is((select (x->>'approved_version')::bigint from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),2::bigint,'the approved projection still points at the live version, not the pending one');
select is((select x->>'placement_delivery_active' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'true','home_banner is delivery_enabled with an active reservation, so the consolidated signal is true without a per-card RPC');
update public.sponsored_ads set title='Bypass' where id='76100000-0000-0000-0000-000000000001';
reset role;
select is((select title from public.sponsored_ads where id='76100000-0000-0000-0000-000000000001'),'Synthetic campaign','approved title unmodified');
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),86,'exactly one debit');
select is((select count(*)::integer from private.advertising_reservations where order_id=(select(value->>'id')::uuid from ads_results where name='quote')),1,'exactly one reservation');
select is((select extract(epoch from expires_at-starts_at)::bigint from private.advertising_reservations where order_id=(select(value->>'id')::uuid from ads_results where name='quote')),172800::bigint,'two days are exactly 48 hours');
-- Real SQL permissions and protected-media identity; byte upload is tested separately.
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into ads_results values('media',public.allocate_storefront_media('76100000-0000-0000-0000-000000000001'));
select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'home_banner',null,'Second private campaign','','https://example.invalid/second','76100000-0000-0000-0000-000000000002');
insert into ads_results values('foreign_media',public.allocate_storefront_media('76100000-0000-0000-0000-000000000002'));
reset role;
update public.storefront_media set state='ready',width=100,height=100,byte_size=100 where id in(select(value->>'id')::uuid from ads_results where name in('media','foreign_media'));
set local role authenticated;
select throws_ok($$select public.edit_advertising_campaign('76100000-0000-0000-0000-000000000001',3,'Wrong media','','https://example.invalid/wrong',true,(select(value->>'id')::uuid from ads_results where name='foreign_media'))$$,'INVALID_AD_MEDIA','cannot associate media of another campaign even with same owner');
select public.edit_advertising_campaign('76100000-0000-0000-0000-000000000001',3,'Approved image campaign','Synthetic image evidence','https://example.invalid/image',true,(select(value->>'id')::uuid from ads_results where name='media'));
reset role;
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000002',true);
select is(public.authorize_storefront_media((select(value->>'id')::uuid from ads_results where name='media')),null::text,'pending image is not public');
select pg_temp.ads_admin();
select public.admin_review_advertising_campaign('76100000-0000-0000-0000-000000000001',4,true,'Synthetic image review');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000002',true);
select ok(public.authorize_storefront_media((select(value->>'id')::uuid from ads_results where name='media')) is not null,'approved paid campaign image is authorized');
select is(public.authorize_storefront_media((select(value->>'id')::uuid from ads_results where name='foreign_media')),null::text,'another campaign draft stays private');
-- Team membership does not authorize spending the owner's personal wallet.
insert into public.advertiser_members(account_id,user_id,permission,granted_by) values((select(value#>>'{}')::uuid from ads_results where name='account'),'76000000-0000-0000-0000-000000000002','manager','76000000-0000-0000-0000-000000000003');
set local role authenticated;
select is(jsonb_array_length(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))),2,'manager can prepare authorized account campaigns');
select throws_ok($$select public.quote_commercial_order('76100000-0000-0000-0000-000000000001','1',gen_random_uuid())$$,'RESOURCE_NOT_ELIGIBLE','manager cannot debit the owner wallet');
reset role;
update public.advertiser_members set permission='viewer' where user_id='76000000-0000-0000-0000-000000000002';
set local role authenticated;
select throws_ok($$select public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))$$,'42501','AD_EDITOR_REQUIRED','analyst cannot edit campaigns');
reset role;
update public.advertiser_members set revoked_at=now() where user_id='76000000-0000-0000-0000-000000000002';
-- Revision approval changes no paid time and keeps immutable submitted evidence.
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),86,'editorial review never debits');
select is((select extract(epoch from expires_at-starts_at)::bigint from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'),172800::bigint,'editorial review never extends duration');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select public.archive_advertising_campaign('76100000-0000-0000-0000-000000000002','Synthetic unpaid archive');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000002'),'archived','archive preserves content privately');
select pg_temp.ads_admin();
select throws_ok($$select public.admin_configure_advertising_placement('home_banner',0,false,true,1,'Synthetic reduction attempt',true)$$,'AD_CAPACITY_COMMITTED','cannot reduce capacity below paid commitments');
select public.admin_configure_advertising_placement('home_banner',1,false,true,1,'Synthetic pause sales only',true);
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select is(jsonb_array_length(public.select_advertising('home_banner',null)),1,'sales pause preserves existing delivery');
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic voluntary interruption',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'voluntary pause blocks server delivery immediately');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','voluntary pause does not become administrative suspension');
select is((select advertiser_paused_by from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'), '76000000-0000-0000-0000-000000000001'::uuid,'pause origin is recorded');
select is((select x->>'advertiser_paused' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'true','summary exposes authorized pause flag');
select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is(jsonb_array_length(public.select_advertising('home_banner',null)),1,'owner resumes without a new order');
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),86,'resume does not debit or credit');
-- In a savepoint, make this contracted campaign the superadmin's personal ad. The common
-- advertiser RPC must record a voluntary pause even though the caller also has admin powers.
savepoint superadmin_personal_ad;
update public.advertiser_accounts set owner_user_id='76000000-0000-0000-0000-000000000003'
  where id=(select(value#>>'{}')::uuid from ads_results where name='account');
update private.commercial_resources set owner_user_id='76000000-0000-0000-0000-000000000003'
  where id='76100000-0000-0000-0000-000000000001';
select pg_temp.ads_admin();
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Pausa do anúncio pessoal do superadmin',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','superadmin na interface comum não suspende administrativamente o anúncio pessoal');
select is((select advertiser_paused_by from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'76000000-0000-0000-0000-000000000003'::uuid,'pausa pessoal do superadmin é auditada como ação do anunciante');
rollback to savepoint superadmin_personal_ad;
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
-- A pause is an account-level action: any authorized editor (owner or active manager) of the
-- same account can resume it, not only whoever personally clicked "Pausar". Locking resume to
-- the exact pausing identity would strand the ad whenever that one person is unavailable.
insert into public.advertiser_members(account_id,user_id,permission,granted_by) values((select(value#>>'{}')::uuid from ads_results where name='account'),'76000000-0000-0000-0000-000000000004','manager','76000000-0000-0000-0000-000000000003');
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic voluntary interruption by owner',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is((select advertiser_paused_by from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'76000000-0000-0000-0000-000000000001'::uuid,'second pause is also attributed to the owner who triggered it');
-- A resume carrying the operation id of an EARLIER pause (the one from before this second
-- pause, already undone by the first resume) must never be honored as if it targeted the
-- current one: a delayed resume request, executed here for the FIRST time, is only allowed
-- to undo the exact pause the client observed.
select throws_ok($$select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' and action='advertiser_resume' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'AD_RESUME_STALE','a resume bound to an already-undone pause is rejected, never undoing the current one');
select is((select advertiser_paused_at is not null from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),true,'the stale resume attempt left the current pause untouched');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000004',true);
select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is(jsonb_array_length(public.select_advertising('home_banner',null)),1,'a different authorized manager can resume a pause started by the owner');
select is((select advertiser_paused_by from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),null,'pause attribution is cleared once resumed');
select is((select action from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),'advertiser_resume','resume by another manager is still audited');
select is((select actor_user_id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),'76000000-0000-0000-0000-000000000004'::uuid,'the audit trail attributes the resume to whoever actually performed it');
update public.advertiser_members set revoked_at=now() where user_id='76000000-0000-0000-0000-000000000004';
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000004',true);
select throws_ok($$select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'42501','PERMISSION_DENIED','manager with revoked permission cannot resume, even with no active pause');

-- Pause limit (20261222000001): up to 3 completed voluntary pause/resume cycles per continuous
-- contracted period; two are already done above (owner, then a different manager). A 3rd is
-- still an ordinary resumable pause; a 4th CONFIRMED pause becomes an Evolutus-side suspension,
-- not a 5th resumable pause.
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),2::smallint,'two completed cycles counted so far');
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic pause number 3',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),3::smallint,'third pause increments the shared counter');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','third pause is still a resumable voluntary pause, not a suspension');
select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is(jsonb_array_length(public.select_advertising('home_banner',null)),1,'third resume is still permitted, exactly like the first two');
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),3::smallint,'resuming never changes the pause count');
savepoint period_projection;
update public.visibility_entitlements set expires_at=expires_at+interval '1 day'
  where resource_id='76100000-0000-0000-0000-000000000001';
select is((select x->>'pauses_available' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'0','renovação antecipada que preserva o início não concede pausas extras');
update public.visibility_entitlements set starts_at=statement_timestamp()-interval '1 minute'
  where resource_id='76100000-0000-0000-0000-000000000001';
select is((select x->>'pauses_available' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'3','novo período contratual mostra três pausas antes da primeira ação');
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Primeira pausa de um novo período',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),1::smallint,'primeira pausa no novo período reinicia o contador autoritativo');
rollback to savepoint period_projection;
-- A duplicate/retried call on an already-paused ad must not double count (idempotent early
-- return), and clicking pause without confirming never reaches the server at all (frontend-only
-- dialog state) -- both already guaranteed by the existing advertiser_paused_at is not null
-- early return, reused unchanged by this migration.
select throws_ok($$select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic pause number 4 without confirmation',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'AD_PAUSE_LIMIT_CONFIRM_REQUIRED','fourth ordinary pause does not suspend');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','the unconfirmed fourth pause leaves delivery active');
select throws_ok($$select public.confirm_advertising_pause_limit('76100000-0000-0000-0000-000000000001',now()-interval '1 day',1,0,'Stale confirmation')$$,'AD_PAUSE_CONFIRM_STALE','stale confirmation is rejected');
create temporary table pause_confirmation_token as select
 (select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001') period_start,
 (select approved_revision from private.commercial_resources where id='76100000-0000-0000-0000-000000000001') revision,
 (select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1) operation_id;
select public.confirm_advertising_pause_limit('76100000-0000-0000-0000-000000000001',
 (select period_start from pause_confirmation_token),
 (select revision from pause_confirmation_token),
 (select operation_id from pause_confirmation_token),
 'Suspensão confirmada após três pausas');
select public.confirm_advertising_pause_limit('76100000-0000-0000-0000-000000000001',
 (select period_start from pause_confirmation_token),
 (select revision from pause_confirmation_token),
 (select operation_id from pause_confirmation_token),
 'Suspensão confirmada após três pausas');
select is((select count(*) from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' and action='suspend_pause_limit'),1::bigint,'retry after a lost confirmation response does not create another suspension operation');
select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Duplicate call, same pause',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'));
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),3::smallint,'a duplicated call while already suspended by the limit does not increment further');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'suspended','a 4th confirmed pause becomes an Evolutus-side suspension, not a 4th resumable pause');
select is((select advertiser_paused_at from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),null,'suspension by limit is not also recorded as an open voluntary pause');
select is((select action from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),'suspend_pause_limit','the 4th pause is audited with its own distinct action, not the generic voluntary pause');
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'suspension by limit blocks delivery exactly like any other suspension');
select throws_ok($$select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'AD_RESUME_BLOCKED','the owner cannot lift a suspension caused by the pause limit, same as an administrative one');
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),86,'reaching the pause limit never debits or credits EvoCash');
select is((select x->>'pauses_used' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'3','the summary exposes the pause count the advertiser has used');
select is((select x->>'pauses_available' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'0','and how many remain (zero, already at the limit)');
select is((select x->>'suspension_origin' from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))) x where x->>'ad_id'='76100000-0000-0000-0000-000000000001'),'pause_limit','the admin-facing summary distinguishes a pause-limit suspension from a real moderation suspension');

-- Administrative release does not grant new pauses, and does not require the pause-limit
-- suspension to be treated any differently from any other suspended state it already handles.
select pg_temp.ads_admin();
select public.admin_resume_advertising_campaign('76100000-0000-0000-0000-000000000001',
  (select approved_revision from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),
  'Liberação administrativa após limite de pausas');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','administrative release restores delivery');
select is((select advertiser_pause_count from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),3::smallint,'administrative release does not reset or grant additional pauses');
select throws_ok($$select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic pause attempt right after release',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'AD_PAUSE_LIMIT_CONFIRM_REQUIRED','administrative release does not allow an unconfirmed fourth pause');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'approved','unconfirmed pause after release does not re-suspend');

select pg_temp.ads_admin();
-- interrupt_advertising_campaign is advertiser-only now (see 20261222000001): a superadmin
-- acting outside the admin console follows the advertiser's own rules just like anyone else.
-- Real administrative suspension has its own dedicated, explicitly-authorized RPC.
select throws_ok($$select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic administrative suspension attempt',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'42501','AD_EDITOR_REQUIRED','admin acting outside the console cannot use the advertiser pause path on someone else''s ad');
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
  select '76100000-0000-0000-0000-000000000099',code,'76000000-0000-0000-0000-000000000001',1,1,'approved'
  from public.commercial_offerings where code not like 'ad_%' order by code limit 1;
select throws_ok($$select public.admin_suspend_advertising_campaign('76100000-0000-0000-0000-000000000099','Tentativa fora do domínio de anúncios')$$,
  'AD_NOT_FOUND','a RPC administrativa não suspende outro tipo de recurso comercial');
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000099'),'approved','recurso externo permanece intocado');
select public.admin_suspend_advertising_campaign('76100000-0000-0000-0000-000000000001','Synthetic administrative suspension');
savepoint suspended_renewal;
update public.visibility_entitlements set expires_at=expires_at+interval '1 day'
  where resource_id='76100000-0000-0000-0000-000000000001';
select is((select moderation_state from private.commercial_resources where id='76100000-0000-0000-0000-000000000001'),'suspended','renovar prazo não remove suspensão administrativa');
select is(private.commercial_resource_visible('76100000-0000-0000-0000-000000000001'),false,'contrato renovado continua inelegível enquanto suspenso');
rollback to savepoint suspended_renewal;
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),(select id from public.advertising_operations where resource_id='76100000-0000-0000-0000-000000000001' order by id desc limit 1),(select starts_at from public.visibility_entitlements where resource_id='76100000-0000-0000-0000-000000000001'))$$,'AD_RESUME_BLOCKED','owner cannot lift administrative suspension');
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'administrative suspension blocks delivery');
select is(public.authorize_storefront_media((select(value->>'id')::uuid from ads_results where name='media')), (select storage_path from public.storefront_media where id=(select(value->>'id')::uuid from ads_results where name='media')), 'owner retains private media access during suspension');
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),86,'interruption does not grant automatic credit');
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok($$select public.get_advertising_campaigns((select(value#>>'{}')::uuid from ads_results where name='account'))$$,'42501','PERMISSION_DENIED','other user cannot read private campaigns');
-- Running as `authenticated` here (unlike every earlier resume call in this file, which runs
-- unrestricted): advertising_operations has no SELECT grant for that role, so the expected
-- operation id must be a plain literal, never a live subquery -- the permission check inside
-- the RPC itself is what this assertion is actually proving, and it must fire first regardless.
select throws_ok($$select public.resume_my_advertising_campaign('76100000-0000-0000-0000-000000000001',gen_random_uuid(),0,null)$$,'42501','PERMISSION_DENIED','other user cannot resume an advertising campaign by direct RPC');
select throws_ok($$select public.interrupt_advertising_campaign('76100000-0000-0000-0000-000000000001','Unauthorized pause attempt',gen_random_uuid(),0,null)$$,'42501','PERMISSION_DENIED','other user cannot pause an advertising campaign by direct RPC');
select throws_ok($$select public.edit_advertising_campaign('76100000-0000-0000-0000-000000000001',3,'Attack','','https://example.invalid/attack',false)$$,'42501','PERMISSION_DENIED','other user cannot edit');
select throws_ok($$select pg_temp.confirm_with_terms((select(value->>'id')::uuid from ads_results where name='quote'),true)$$,'ORDER_NOT_FOUND','other user cannot spend original payer balance');
reset role;
-- A global campaign keeps its prepared scope even if the administrative bundle grows.
select pg_temp.ads_admin();
select public.admin_set_advertising_network(array['home_banner'],(select network_revision from private.advertising_configuration where id),'Synthetic global bundle version A',true);
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='account'),'network',null,'Frozen global campaign','','https://example.invalid/global','76100000-0000-0000-0000-000000000003');
reset role;
select pg_temp.ads_admin();
select public.admin_set_advertising_network(array['home_banner','community_banner'],(select network_revision from private.advertising_configuration where id),'Synthetic global bundle version B',true);
select is((select count(*)::integer from private.advertising_resource_inventory where resource_id='76100000-0000-0000-0000-000000000003'),1,'new placement never enters a prepared global campaign');
select is((select placement_code from private.advertising_resource_inventory where resource_id='76100000-0000-0000-0000-000000000003'),'home_banner','global snapshot preserves its exact original placement');
-- Revoked online sessions cannot quote or replay a confirmation.
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000001',true);
select pg_temp.revoke_test_session('76000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$select pg_temp.confirm_with_terms((select(value->>'id')::uuid from ads_results where name='quote'),true)$$,'42501','APP_ACCESS_DENIED','revoked session blocks even a confirmation replay');
reset role;
select pg_temp.ads_admin();
insert into ads_results values('refund',public.admin_reverse_commercial_order((select(value->>'id')::uuid from ads_results where name='quote'),'76200000-0000-0000-0000-000000000001','Synthetic explicitly authorized reversal',true));
select is(public.admin_reverse_commercial_order((select(value->>'id')::uuid from ads_results where name='quote'),'76200000-0000-0000-0000-000000000001','Synthetic explicitly authorized reversal',true),(select value from ads_results where name='refund'),'administrative reversal replay is idempotent');
select is((select cash_balance from public.wallets where user_id='76000000-0000-0000-0000-000000000001'),100,'explicit reversal restores exactly the paid amount');
select is(private.advertising_peak('home_banner','00000000-0000-0000-0000-000000000000',now(),'infinity'),0,'reversed reservation releases capacity without deleting history');
select is((select count(*)::integer from private.advertising_reservations where order_id=(select(value->>'id')::uuid from ads_results where name='quote')),1,'reversal retains reservation evidence');
-- Deleted owners retain private evidence without an FK preventing authorized deletion.
select pg_temp.set_test_user('76000000-0000-0000-0000-000000000002',true);
set local role authenticated;
insert into ads_results values('deleted_account',to_jsonb(public.create_advertising_account('Synthetic deleted advertiser')));
select public.create_advertising_campaign((select(value#>>'{}')::uuid from ads_results where name='deleted_account'),'home_banner',null,'Deleted owner draft','','https://example.invalid/deleted','76100000-0000-0000-0000-000000000004');
reset role;
select lives_ok($$delete from auth.users where id='76000000-0000-0000-0000-000000000002'$$,'deletion of a nonfinancial synthetic owner is not blocked by advertiser FKs');
select ok((select created_by is null and commercial_resource_id=id from public.sponsored_ads where id='76100000-0000-0000-0000-000000000004'),'deleted-owner campaign stays managed, never falls into legacy publication');
select ok(not private.commercial_resource_visible('76100000-0000-0000-0000-000000000004'),'ownerless resource is not public');
select * from finish();
rollback;
