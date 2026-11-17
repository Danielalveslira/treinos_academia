\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Simulates exactly what the pre-PR151 interrupt_advertising_campaign left behind: a resource
-- suspended, with the account's own owner recorded as the actor of the 'suspend' operation --
-- indistinguishable, in the old data, from a real moderation suspension except by that actor
-- identity. Built with direct inserts (fixture, not the creation flow, already covered
-- elsewhere) to isolate the recovery RPC's own guards.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','advrecover-'||n||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,4) n;
update public.users set role='superadmin' where id='97000000-0000-0000-0000-000000000004';
create function pg_temp.ads_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('97000000-0000-0000-0000-000000000004',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;

insert into public.advertiser_accounts(id,name,created_by,owner_user_id)
values ('97100000-0000-0000-0000-000000000001','Conta de recuperação','97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001');
insert into public.advertiser_members(account_id,user_id,permission,granted_by)
values ('97100000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','owner','97000000-0000-0000-0000-000000000001');

-- visibility_entitlements.origin_order_id is a real FK to commercial_orders -- a minimal fixed
-- order per case, fulfilled, is the only way to satisfy it without running the full quote/pay
-- flow (already covered by advertising_campaigns_test.sql).
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'ad_home',coalesce(max(revision),0)+1,7,1,30,now()-interval '1 day','97000000-0000-0000-0000-000000000004','Synthetic recovery fixture' from public.commercial_price_versions where offering_code='ad_home';
create temp table recovery_price as select id from public.commercial_price_versions where offering_code='ad_home' order by active_from desc limit 1;

-- Case A: eligible -- owner was the actor, contract still vigente.
insert into public.sponsored_ads(id,partner_name,title,created_by,display_mode,is_global)
values ('97200000-0000-0000-0000-000000000001','Parceiro','Anúncio recuperável','97000000-0000-0000-0000-000000000001',array['banner'],true);
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values ('97200000-0000-0000-0000-000000000001','ad_home','97000000-0000-0000-0000-000000000001',2,2,'suspended');
insert into private.advertising_drafts(ad_id,account_id,version,state,title,destination,creation_request,approved_version)
values ('97200000-0000-0000-0000-000000000001','97100000-0000-0000-0000-000000000001',2,'approved','Anúncio recuperável','https://example.invalid/recover','{}',2);
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,quote_expires_at,fulfilled_at,period_start,period_end)
values ('97300000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001',gen_random_uuid(),'97200000-0000-0000-0000-000000000001','ad_home',(select id from recovery_price),2,6,7,42,'fulfilled',now()+interval '1 hour',now()-interval '1 day',now()-interval '1 day',now()+interval '5 days');
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at,administrative_state)
values ('97200000-0000-0000-0000-000000000001','97300000-0000-0000-0000-000000000001',now()-interval '1 day',now()+interval '5 days','enabled');
insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
values ('97000000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000001','suspend','Interrupção solicitada pelo anunciante');

-- Case B: NOT eligible -- actor is a genuine outsider (real moderation under the old code).
insert into public.sponsored_ads(id,partner_name,title,created_by,display_mode,is_global)
values ('97200000-0000-0000-0000-000000000002','Parceiro','Anúncio moderado de verdade','97000000-0000-0000-0000-000000000001',array['banner'],true);
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values ('97200000-0000-0000-0000-000000000002','ad_home','97000000-0000-0000-0000-000000000001',1,1,'suspended');
insert into private.advertising_drafts(ad_id,account_id,version,state,title,destination,creation_request,approved_version)
values ('97200000-0000-0000-0000-000000000002','97100000-0000-0000-0000-000000000001',1,'approved','Anúncio moderado de verdade','https://example.invalid/moderated','{}',1);
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,quote_expires_at,fulfilled_at,period_start,period_end)
values ('97300000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000001',gen_random_uuid(),'97200000-0000-0000-0000-000000000002','ad_home',(select id from recovery_price),1,6,7,42,'fulfilled',now()+interval '1 hour',now()-interval '1 day',now()-interval '1 day',now()+interval '5 days');
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at,administrative_state)
values ('97200000-0000-0000-0000-000000000002','97300000-0000-0000-0000-000000000002',now()-interval '1 day',now()+interval '5 days','enabled');
insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
values ('97000000-0000-0000-0000-000000000003','97200000-0000-0000-0000-000000000002','suspend','Conteúdo infringe as diretrizes');

-- Case C: owner was the actor, but the contract already expired -- not eligible either.
insert into public.sponsored_ads(id,partner_name,title,created_by,display_mode,is_global)
values ('97200000-0000-0000-0000-000000000003','Parceiro','Anúncio vencido','97000000-0000-0000-0000-000000000001',array['banner'],true);
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values ('97200000-0000-0000-0000-000000000003','ad_home','97000000-0000-0000-0000-000000000001',1,1,'suspended');
insert into private.advertising_drafts(ad_id,account_id,version,state,title,destination,creation_request,approved_version)
values ('97200000-0000-0000-0000-000000000003','97100000-0000-0000-0000-000000000001',1,'approved','Anúncio vencido','https://example.invalid/expired','{}',1);
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,quote_expires_at,fulfilled_at,period_start,period_end)
values ('97300000-0000-0000-0000-000000000003','97000000-0000-0000-0000-000000000001',gen_random_uuid(),'97200000-0000-0000-0000-000000000003','ad_home',(select id from recovery_price),1,9,7,63,'fulfilled',now()+interval '1 hour',now()-interval '10 days',now()-interval '10 days',now()-interval '1 day');
insert into public.visibility_entitlements(resource_id,origin_order_id,starts_at,expires_at,administrative_state)
values ('97200000-0000-0000-0000-000000000003','97300000-0000-0000-0000-000000000003',now()-interval '10 days',now()-interval '1 day','enabled');
insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
values ('97000000-0000-0000-0000-000000000001','97200000-0000-0000-0000-000000000003','suspend','Interrupção solicitada pelo anunciante');

select pg_temp.ads_admin();
select throws_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000002',1)$$,
  'P0001','AD_RECOVERY_NOT_ELIGIBLE','suspensão real de moderação (ator de fora da conta) não é recuperada'
);
select throws_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000003',1)$$,
  'P0001','AD_RECOVERY_NOT_ELIGIBLE','contrato já vencido não é recuperado, mesmo com origem voluntária'
);
select throws_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000001',99)$$,
  'P0001','AD_REVISION_CONFLICT','revisão incorreta é rejeitada'
);
select lives_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000001',2)$$,
  'candidato elegível é recuperado'
);
select is((select moderation_state from private.commercial_resources where id='97200000-0000-0000-0000-000000000001'),'approved','recuperação restaura a entrega');
select is((select advertiser_pause_count from private.commercial_resources where id='97200000-0000-0000-0000-000000000001'),1::smallint,'a pausa recuperada é contabilizada no limite de 3, não é um reset gratuito');
select is((select count(*)::int from public.advertising_operations where resource_id='97200000-0000-0000-0000-000000000001' and action='advertising_suspension_recovered'),1,'recuperação deixa auditoria');
select throws_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000001',2)$$,
  'P0001','AD_NOT_SUSPENDED','já recuperado não pode ser recuperado de novo'
);

select pg_temp.set_test_user('97000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok(
  $$select public.admin_recover_advertising_voluntary_suspension('97200000-0000-0000-0000-000000000002',1)$$,
  '42501','PERMISSION_DENIED','o próprio proprietário (não superadmin) não executa a recuperação administrativa'
);
reset role;

select finish();
rollback;
