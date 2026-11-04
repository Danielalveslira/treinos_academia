\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
select no_plan();
delete from public.legal_policy;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fc000000-0000-0000-0000-000000000001','authenticated','authenticated','refund-service-owner@example.invalid','x',now(),'{}','{}',now(),now()),
('fc000000-0000-0000-0000-000000000002','authenticated','authenticated','refund-service-admin@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='fc000000-0000-0000-0000-000000000002';
create function pg_temp.service_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('fc000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint)))::text,true);
end$$;
insert into public.commercial_offerings(code,name,description,integration_ready) values('synthetic_refund_service','Synthetic service','Refund service fixture only',true);
select pg_temp.service_admin();
select public.admin_publish_commercial_price('synthetic_refund_service','3',1,30,null,0,gen_random_uuid(),'Synthetic refund service fixture',true);
select public.admin_set_commercial_sales('synthetic_refund_service',true,1,gen_random_uuid(),'Synthetic sales only',true);
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values('fc000000-0000-0000-0000-000000000003','synthetic_refund_service','fc000000-0000-0000-0000-000000000001',1,1,'approved');
select public._wallet_credit_cash('fc000000-0000-0000-0000-000000000001',100);
select public._ledger_record('fc000000-0000-0000-0000-000000000001','synthetic-service-seed','cash','credit',100,'synthetic','fixture','refund-services');
select pg_temp.set_test_user('fc000000-0000-0000-0000-000000000001',true);
select pg_temp.publish_test_commercial_terms(); -- 20261212000002: termos comerciais sintéticos publicados
create temp table quote as select public.quote_commercial_order('fc000000-0000-0000-0000-000000000003','7',gen_random_uuid()) q;
select is((select q->'refundPolicy'->>'version' from quote),'draft-1','service quote freezes offered policy');
insert into public.refund_policies(version,approved,body,counting_rule,days,cash_origin,service_origin)
values('draft-extension-test',false,'Synthetic more favorable extension','civil_days_brasilia',10,'receipt','contract');
update private.refund_settings set policy_version='draft-extension-test',financial_requests_enabled=true,settlement_enabled=true where id;
select pg_temp.confirm_with_terms((select(q->>'id')::uuid from quote),true);
select is(public.get_refund_source('order',(select(q->>'id')::uuid from quote))->'policy'->>'version','draft-1','later policy does not rewrite accepted contract');
select is((select origin_kind from public.refund_contract_terms where order_id=(select(q->>'id')::uuid from quote)),'contract','service origin differs from cash receipt');
create temp table req as select public.create_refund_request('order',(select(q->>'id')::uuid from quote),'withdrawal','',gen_random_uuid()) r;
select is((select cash_balance from public.wallets where user_id='fc000000-0000-0000-0000-000000000001'),79,'request itself never returns credits');
select pg_temp.service_admin();
select public.act_on_refund_request((select(r->>'id')::uuid from req),'review','Revisão sintética do serviço e do consumo',gen_random_uuid(),1);
select public.act_on_refund_request((select(r->>'id')::uuid from req),'approve','Devolução integral de créditos do serviço aprovada','fc000000-0000-0000-0000-000000000010',2,'{"legalReview":"confirmed","relatedContractsReview":"confirmed","basis":"Cancelamento integral revisado sem substituir restituição em dinheiro devida","partyClassification":"professional"}');
select public.act_on_refund_request((select(r->>'id')::uuid from req),'complete_service','Reversão integral do período com ledger auditado','fc000000-0000-0000-0000-000000000011',3);
select is((select cash_balance from public.wallets where user_id='fc000000-0000-0000-0000-000000000001'),100,'service uses existing exact EvoCash compensation');
select is((select status from public.commercial_orders where id=(select(q->>'id')::uuid from quote)),'reversed','service contract reversed atomically');
select is((select administrative_state from public.visibility_entitlements where resource_id='fc000000-0000-0000-0000-000000000003'),'revoked','paid visibility revoked without deleting editorial history');
select is((select count(*)::integer from public.cash_purchase_reversals where purchase_id=(select(r->>'purchaseId')::uuid from req)),0,'service cancellation never invents BRL refund');
select is(public.act_on_refund_request((select(r->>'id')::uuid from req),'complete_service','Reversão integral do período com ledger auditado','fc000000-0000-0000-0000-000000000011',3)->>'status','completed','service completion idempotent');
select is((select count(*)::integer from public.economy_transactions where natural_key='commercial_refund:'||(select q->>'id' from quote)),1,'one existing compensation ledger entry');
select is((select count(*)::integer from public.refund_settlements where order_id=(select(q->>'id')::uuid from quote)),1,'settlement references original service without second ledger');
select * from finish();
rollback;
