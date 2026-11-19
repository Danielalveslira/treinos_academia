\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('75000000-0000-0000-0000-000000000001','authenticated','authenticated','supplier-gate@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='75000000-0000-0000-0000-000000000001';
select pg_temp.set_test_user('75000000-0000-0000-0000-000000000001',true);
-- set_test_user dá amr=password fresco por padrão agora (is_full_login_session()); este teste
-- quer um JWT com login antigo (amr presente, mas não recente) -- remover o amr por completo
-- derrubaria is_full_login_session()/has_app_access() primeiro, trocando a mensagem esperada.
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()-interval '1 hour')::bigint))))::text,true);
select ok(not has_function_privilege('anon','public.admin_set_supplier_info_configured(boolean,text,boolean)','execute'),
  'anonymous execution remains revoked');
select ok(not has_function_privilege('service_role','public.admin_set_supplier_info_configured(boolean,text,boolean)','execute'),
  'service-role execution remains revoked');
set local role authenticated;
select throws_ok($$select public.admin_set_supplier_info_configured(true,'No recent authentication',true)$$,
  '42501','RECENT_AUTH_REQUIRED','recent authentication remains mandatory');
reset role;
select set_config('request.jwt.claims',
  (current_setting('request.jwt.claims')::jsonb || jsonb_build_object('amr',jsonb_build_array(
    jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
create temp table supplier_gate_other_config as select config - 'supplierInfo' as value from public.economy_config;
set local role authenticated;

select throws_ok($$select public.admin_set_supplier_info_configured(true,'Fixture confirmation',false)$$,
  'INVALID_SUPPLIER_INFO_REQUEST','explicit confirmation remains required');
select is((public.admin_set_supplier_info_configured(true,'Fixture confirmation',true)->>'configured')::boolean,
  true,'closed financial controls allow audited supplier confirmation');
reset role;
select is((select count(*)::integer from public.admin_audit_log where action='supplier_info_gate_changed' and reason='Fixture confirmation'),
  1,'successful confirmation creates one audit event');
select is((select config - 'supplierInfo' from public.economy_config),
  (select value from supplier_gate_other_config),'other economy controls remain unchanged');
set local role authenticated;
select is((public.admin_set_supplier_info_configured(false,'Fixture closure',true)->>'configured')::boolean,
  false,'closing the supplier gate remains available');
reset role;

update public.evocash_pricing_state set quoting_enabled=true where id;
set local role authenticated;
select throws_ok($$select public.admin_set_supplier_info_configured(true,'Quoting open',true)$$,
  'SUPPLIER_INFO_FINANCIAL_GATES_OPEN','open EvoCash quoting blocks confirmation');
reset role;
update public.evocash_pricing_state set quoting_enabled=false,checkout_enabled=true where id;
set local role authenticated;
select throws_ok($$select public.admin_set_supplier_info_configured(true,'Checkout open',true)$$,
  'SUPPLIER_INFO_FINANCIAL_GATES_OPEN','open checkout blocks confirmation even when quoting is closed');
reset role;
update public.evocash_pricing_state set checkout_enabled=false where id;
update public.commercial_offerings set sales_enabled=true where code='post_boost';
set local role authenticated;
select throws_ok($$select public.admin_set_supplier_info_configured(true,'Sales open',true)$$,
  'SUPPLIER_INFO_FINANCIAL_GATES_OPEN','open commercial sales block confirmation');
reset role;
update public.commercial_offerings set sales_enabled=false where code='post_boost';
insert into public.cash_purchases(user_id,request_id,package_id,package_label,cash_amount,amount_centavos,status,payment_provider,provider_order_nsu)
values('75000000-0000-0000-0000-000000000001','supplier-gate-pending','synthetic','Synthetic fixture',1,100,'pending','infinitepay','supplier-gate-fixture');
set local role authenticated;
select throws_ok($$select public.admin_set_supplier_info_configured(true,'Purchase pending',true)$$,
  'SUPPLIER_INFO_FINANCIAL_GATES_OPEN','pending purchase blocks confirmation');
reset role;
select is(private.supplier_info_configured(),false,'rejected confirmations leave gate closed');
select is((select count(*)::integer from public.admin_audit_log where action='supplier_info_gate_changed' and reason in ('Fixture confirmation','Fixture closure','Quoting open','Checkout open','Sales open','Purchase pending')),
  2,'rejected confirmations create no audit events');

select * from finish();
rollback;
