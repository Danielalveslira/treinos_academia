\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
select no_plan();
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
-- Fixtures existentes não devem ocupar o teto legado; tudo volta no rollback.
delete from public.sponsored_ads where is_global;
update private.commercial_resources set moderation_state='suspended' where offering_code like 'ad_%';
truncate private.advertising_reservations;

select is((select surface from public.advertising_placements where code='progress_banner'), 'home', 'Progresso usa contexto global');
select is((select display_limit from public.advertising_placements where code='progress_banner'), 4, 'Progresso usa amostra rotativa limitada');
select is((select sales_enabled from public.advertising_placements where code='progress_banner'), false, 'vendas começam desligadas');
select is((select delivery_enabled from public.advertising_placements where code='progress_banner'), false, 'entrega começa desligada');
select ok(not exists(select 1 from private.advertising_network_bundle where placement_code='progress_banner'), 'pacote existente não recebe Progresso');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('76930000-0000-0000-0000-000000000001','authenticated','authenticated','ads-progress-admin@example.invalid','x',now(),'{}','{}',now(),now()),
 ('76930000-0000-0000-0000-000000000002','authenticated','authenticated','ads-progress-viewer@example.invalid','x',now(),'{}','{}',now(),now()),
 ('76930000-0000-0000-0000-000000000003','authenticated','authenticated','ads-progress-owner@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='76930000-0000-0000-0000-000000000001';
update public.users set data_nascimento=date '1990-01-01' where id='76930000-0000-0000-0000-000000000002';
select pg_temp.set_test_user('76930000-0000-0000-0000-000000000001',true);
insert into public.sponsored_ads(id,partner_name,title,is_global,display_mode,created_by)
values ('76940000-0000-0000-0000-000000000001','Marca teste','Anúncio legado da Home',true,array['banner'],'76930000-0000-0000-0000-000000000001');
reset role;

select is(private.advertising_peak('progress_banner','00000000-0000-0000-0000-000000000000'::uuid,now(),now()+interval '1 day'),0,'legado da Home não consome capacidade do Progresso');

update public.advertising_placements set delivery_enabled=true where code in ('home_banner','progress_banner');
select pg_temp.set_test_user('76930000-0000-0000-0000-000000000002',true);
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('home_banner',null)) x
  where x->>'id'='76940000-0000-0000-0000-000000000001'), 'legado aparece na Home autorizada');
select ok(not exists(select 1 from jsonb_array_elements(public.select_advertising('progress_banner',null)) x
  where x->>'id'='76940000-0000-0000-0000-000000000001'), 'legado da Home não aparece no Progresso');
select is(public.select_advertising('progress_banner','76930000-0000-0000-0000-000000000001'::uuid), '[]'::jsonb, 'contexto de comunidade é recusado no Progresso');
reset role;

update public.advertising_placements set delivery_enabled=false where code='home_banner';
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.select_advertising('home_banner',null)) x
  where x->>'id'='76940000-0000-0000-0000-000000000001'), 'bloqueio administrativo impede entrega de legado');
select ok(not exists(select 1 from public.sponsored_ads where id='76940000-0000-0000-0000-000000000001'), 'leitura direta também respeita bloqueio do legado');

-- Campanha gerenciada: escopo próprio, revisão editorial, cotação, débito, reserva,
-- entrega e coleta real. Tudo ocorre nesta transação sintética, desfeita no rollback.
reset role;
create temp table progress_results(name text primary key,value jsonb);
grant all on progress_results to authenticated;
create function pg_temp.progress_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('76930000-0000-0000-0000-000000000001',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;

select pg_temp.set_test_user('76930000-0000-0000-0000-000000000003',true);
set local role authenticated;
insert into progress_results values('account',to_jsonb(public.create_advertising_account('Marca no Progresso')));
select is(public.create_advertising_campaign((select (value#>>'{}')::uuid from progress_results where name='account'),'progress_banner',null,
  'Campanha de Progresso','Texto opcional do anúncio','https://example.invalid/progresso','76950000-0000-0000-0000-000000000001'),
  '76950000-0000-0000-0000-000000000001'::uuid,'campanha gerenciada nasce com escopo exclusivo de Progresso');
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,'rascunho não é entregue');
select public.edit_advertising_campaign('76950000-0000-0000-0000-000000000001',1,'Campanha de Progresso','Texto opcional do anúncio','https://example.invalid/progresso',true);
reset role;
select is((select placement_code from private.advertising_resource_inventory where resource_id='76950000-0000-0000-0000-000000000001'),'progress_banner','inventário da campanha não inclui Home');
select pg_temp.progress_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('76950000-0000-0000-0000-000000000001',2,true,'Material sintético aprovado');
select public.admin_configure_advertising_placement('progress_banner',1,true,true,0,
  'Capacidade sintética para teste',true);
reset role;
select pg_temp.publish_test_commercial_terms();
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'ad_progress',coalesce(max(revision),0)+1,7,1,30,clock_timestamp(),'76930000-0000-0000-0000-000000000001','Preço sintético do Progresso'
  from public.commercial_price_versions where offering_code='ad_progress';
update public.commercial_offerings set sales_enabled=true where code='ad_progress';
select public._wallet_credit_cash('76930000-0000-0000-0000-000000000003',100);
select public._ledger_record('76930000-0000-0000-0000-000000000003','synthetic-progress-ad','cash','credit',100,'synthetic','fixture','ads');
select pg_temp.set_test_user('76930000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,'aprovado sem contratação ainda não é entregue');
insert into progress_results values('quote',public.quote_commercial_order('76950000-0000-0000-0000-000000000001','2',gen_random_uuid()));
select is((select value->>'totalCash' from progress_results where name='quote'),'14','preço de dois dias é calculado no servidor');
insert into progress_results values('paid',pg_temp.confirm_with_terms((select (value->>'id')::uuid from progress_results where name='quote'),true));
select is(pg_temp.confirm_with_terms((select (value->>'id')::uuid from progress_results where name='quote'),true),
  (select value from progress_results where name='paid'),'repetir confirmação não debita novamente');
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('progress_banner',null)) x
  where x->>'id'='76950000-0000-0000-0000-000000000001'),'contrato pago e vigente é entregue em Progresso');
select ok(not exists(select 1 from jsonb_array_elements(public.select_advertising('home_banner',null)) x
  where x->>'id'='76950000-0000-0000-0000-000000000001'),'contrato de Progresso não ganha direito à Home');
reset role;
select is((select cash_balance from public.wallets where user_id='76930000-0000-0000-0000-000000000003'),86,'um débito de 14 EvoCash');
select is((select count(*)::integer from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
  where o.resource_id='76950000-0000-0000-0000-000000000001' and r.placement_code='progress_banner'),1,'uma reserva exclusiva no Progresso');

update public.sponsored_ad_metrics_settings set collection_enabled=false;
select pg_temp.set_test_user('76930000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((public.record_ad_events(jsonb_build_array(jsonb_build_object('id','76960000-0000-0000-0000-000000000001','type','impression',
  'ad','76950000-0000-0000-0000-000000000001','placement','progress_banner')))->>'accepted')::integer,0,'sem coleta habilitada não há impressão');
reset role;
update public.sponsored_ad_metrics_settings set collection_enabled=true;
set local role authenticated;
select is((public.record_ad_events(jsonb_build_array(jsonb_build_object('id','76960000-0000-0000-0000-000000000001','type','impression',
  'ad','76950000-0000-0000-0000-000000000001','placement','progress_banner')))->>'accepted')::integer,1,'impressão válida é aceita após habilitar coleta');
select is((public.record_ad_events(jsonb_build_array(jsonb_build_object('id','76960000-0000-0000-0000-000000000001','type','impression',
  'ad','76950000-0000-0000-0000-000000000001','placement','progress_banner')))->>'accepted')::integer,0,'retry da impressão não duplica');
select is((public.record_ad_events(jsonb_build_array(jsonb_build_object('id','76960000-0000-0000-0000-000000000002','type','click',
  'ad','76950000-0000-0000-0000-000000000001','placement','progress_banner')))->>'accepted')::integer,1,'clique válido é aceito');
reset role;
select is((select visible_impressions from public.sponsored_ad_daily_stats where ad_id='76950000-0000-0000-0000-000000000001'
  and placement='progress_banner' and context_id='00000000-0000-0000-0000-000000000000'),1::bigint,'agregado tem uma impressão visível');
select is((select clicks from public.sponsored_ad_daily_stats where ad_id='76950000-0000-0000-0000-000000000001'
  and placement='progress_banner' and context_id='00000000-0000-0000-0000-000000000000'),1::bigint,'agregado tem um clique');
select pg_temp.set_test_user('76930000-0000-0000-0000-000000000003',true);
set local role authenticated;
select is(public.get_advertiser_metrics((select (value#>>'{}')::uuid from progress_results where name='account'),30,null,null,
  '76950000-0000-0000-0000-000000000001',null,'progress_banner')#>>'{summary,visible_impressions}','1','relatório do anunciante mostra a impressão no Progresso');
reset role;
update public.advertising_placements set sales_enabled=false where code='progress_banner';
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('progress_banner',null)) x
  where x->>'id'='76950000-0000-0000-0000-000000000001'),'pausar vendas preserva entrega contratada');
reset role;
update public.advertising_placements set delivery_enabled=false where code='progress_banner';
set local role authenticated;
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,'desligar exibição bloqueia campanha paga');
select * from finish();
rollback;
