\ir _helpers/auth_session.sql
begin;
select no_plan();

delete from public.sponsored_ads where commercial_resource_id is null;
truncate private.advertising_reservations;
update public.advertising_placements set delivery_enabled=true,capacity=1
 where code in('home_banner','progress_banner','community_banner','community_feed');

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values
 ('77010000-0000-0000-0000-000000000001','authenticated','authenticated','institutional-admin@example.invalid','x',now(),'{}','{}',now(),now()),
 ('77010000-0000-0000-0000-000000000002','authenticated','authenticated','institutional-viewer@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='77010000-0000-0000-0000-000000000001';
update public.users set data_nascimento=date '1990-01-01' where id='77010000-0000-0000-0000-000000000002';
insert into public.communities(id,name,created_by,owner_id) values
 ('77020000-0000-0000-0000-000000000001','Comunidade institucional','77010000-0000-0000-0000-000000000001','77010000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) values
 ('77020000-0000-0000-0000-000000000001','77010000-0000-0000-0000-000000000002');
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision)
values('77050000-0000-0000-0000-000000000001','ad_home','77010000-0000-0000-0000-000000000001',1);
insert into public.sponsored_ads(id,partner_name,title,is_global,display_mode,created_by,commercial_resource_id)
values('77050000-0000-0000-0000-000000000001','Marca paga','Contrato preservado',true,array['banner'],
 '77010000-0000-0000-0000-000000000001','77050000-0000-0000-0000-000000000001');

create function pg_temp.ad_payload(p_places jsonb) returns jsonb language sql as $$
 select jsonb_build_object('partnerName','Marca institucional','title','Mensagem institucional',
 'description','','imageUrl','','ctaLabel','Conhecer','ctaType','internal','ctaTarget','/app',
 'expiresAt','','placements',p_places)
$$;
create function pg_temp.as_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('77010000-0000-0000-0000-000000000001',true);
end$$;
create function pg_temp.as_viewer() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('77010000-0000-0000-0000-000000000002',true);
end$$;
create function pg_temp.ad_status(p_ad uuid) returns text language sql as $$
 select x->>'delivery_status' from jsonb_array_elements(public.admin_list_institutional_ads()) x
 where x->>'id'=p_ad::text
$$;

select pg_temp.as_viewer();
set local role authenticated;
select throws_ok($$select public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000001',0,pg_temp.ad_payload('[{"code":"home_banner","contextId":null}]'))$$,
 '42501','ADMIN_REQUIRED','usuário comum não cria anúncio institucional');
select throws_ok($$insert into public.sponsored_ads(partner_name,title,is_global,display_mode,created_by)
 values('Invasor','Anúncio',true,array['banner'],'77010000-0000-0000-0000-000000000002')$$,
 '42501','INSTITUTIONAL_AD_RPC_REQUIRED','escrita direta não contorna a operação administrativa');
select throws_ok($$select public.admin_list_institutional_ads()$$,
 '42501','ADMIN_REQUIRED','usuário comum não lê a lista administrativa');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000001',0,
 pg_temp.ad_payload(jsonb_build_array(
 jsonb_build_object('code','home_banner','contextId',null),
 jsonb_build_object('code','progress_banner','contextId',null),
 jsonb_build_object('code','community_banner','contextId','77020000-0000-0000-0000-000000000001')))),1::bigint,
 'superadmin cria anúncio com três rotas sem checkout');
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000001',0,
 pg_temp.ad_payload(jsonb_build_array(
 jsonb_build_object('code','home_banner','contextId',null),
 jsonb_build_object('code','progress_banner','contextId',null),
 jsonb_build_object('code','community_banner','contextId','77020000-0000-0000-0000-000000000001')))),1::bigint,
 'reenvio idempotente não duplica anúncio');
select throws_ok($$select public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000002',0,
 pg_temp.ad_payload('[{"code":"future_route","contextId":null}]'))$$,
 'INVALID_AD_PLACEMENT','posicionamento inexistente é recusado');
select throws_ok($$select public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000002',0,
 pg_temp.ad_payload('[{"code":"community_feed","contextId":null}]'))$$,
 'INVALID_AD_CONTEXT','card sem comunidade é recusado');
select throws_ok($$select public.admin_save_institutional_ad('77050000-0000-0000-0000-000000000001',0,
 pg_temp.ad_payload('[{"code":"progress_banner","contextId":null}]'))$$,
 '42501','COMMERCIAL_AD_IMMUTABLE','RPC institucional não edita campanha comercial');
select throws_ok($$select public.admin_set_institutional_ad_active('77050000-0000-0000-0000-000000000001',0,false)$$,
 '42501','COMMERCIAL_AD_IMMUTABLE','RPC institucional não suspende contrato comercial');
select is((select count(*)::integer from public.commercial_orders where resource_id='77030000-0000-0000-0000-000000000001'),0,
 'institucional não cria pedido comercial');
select is((select commercial_resource_id from public.sponsored_ads where id='77030000-0000-0000-0000-000000000001'),null::uuid,
 'institucional não usa recurso comercial');
select is((select jsonb_array_length(x->'placements') from jsonb_array_elements(public.admin_list_institutional_ads()) x
 where x->>'id'='77030000-0000-0000-0000-000000000001'),3,
 'listagem administrativa mostra os três locais de exibição');
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'suspended','rascunho é suspenso');
reset role;

select pg_temp.as_viewer();
set local role authenticated;
select is(public.select_advertising('home_banner',null),'[]'::jsonb,'rascunho institucional não é entregue');
reset role;

select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000001',1,true),2::bigint,
 'ativação usa capacidade existente');
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'delivering',
 'ativo e disponível em todos os três locais é elegível para entrega');
select is((select count(*)::integer from public.sponsored_ad_daily_stats where ad_id='77030000-0000-0000-0000-000000000001'),0,
 'status de entrega não pressupõe impressão registrada');
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000002',0,
 pg_temp.ad_payload('[{"code":"progress_banner","contextId":null}]')),1::bigint,
 'outro anúncio pode ser salvo como rascunho');
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000003',0,
 pg_temp.ad_payload('[{"code":"home_banner","contextId":null}]') || jsonb_build_object('expiresAt','2099-01-01T12:30:00Z')),1::bigint,
 'validade exata legada pode ser preservada em edição');
select is((select expires_at at time zone 'UTC' from public.sponsored_ads where id='77030000-0000-0000-0000-000000000003'),
 timestamp '2099-01-01 12:30:00','timestamp original não é arredondado');
select throws_ok($$select public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000002',1,true)$$,
 'AD_CAPACITY_REACHED:progress_banner','ativação excedente é recusada');
select throws_ok($$select public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000001',1,
 pg_temp.ad_payload('[{"code":"home_banner","contextId":null}]'))$$,
 'AD_REVISION_CONFLICT','revisão antiga não altera escopo ativo');
select throws_ok($$update public.sponsored_ads set title='Mudança direta' where id='77030000-0000-0000-0000-000000000001'$$,
 '42501','INSTITUTIONAL_AD_RPC_REQUIRED','superadmin também não contorna o controle de capacidade');
reset role;

select is(private.advertising_peak('progress_banner','00000000-0000-0000-0000-000000000000',now(),now()+interval '1 day'),1,
 'institucional ativo ocupa uma unidade da capacidade');
select is((select count(*)::integer from private.institutional_ad_scopes where ad_id='77030000-0000-0000-0000-000000000001'),3,
 'três posicionamentos explícitos persistidos');

select pg_temp.as_viewer();
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('home_banner',null)) x
 where x->>'id'='77030000-0000-0000-0000-000000000001'),'anúncio aparece na Home');
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('progress_banner',null)) x
 where x->>'id'='77030000-0000-0000-0000-000000000001'),'mesmo anúncio aparece no Progresso autorizado');
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('community_banner','77020000-0000-0000-0000-000000000001')) x
 where x->>'id'='77030000-0000-0000-0000-000000000001'),'anúncio aparece na comunidade autorizada');
select is(public.select_advertising('community_feed','77020000-0000-0000-0000-000000000001'),'[]'::jsonb,
 'anúncio não herda o feed da comunidade');
reset role;

update public.sponsored_ad_metrics_settings set collection_enabled=true;
select pg_temp.as_viewer();
set local role authenticated;
select is((public.record_ad_events('[{"id":"77040000-0000-0000-0000-000000000001","type":"impression","ad":"77030000-0000-0000-0000-000000000001","placement":"progress_banner"}]')) ->> 'accepted','1',
 'impressão visível no Progresso é aceita');
select is((public.record_ad_events('[{"id":"77040000-0000-0000-0000-000000000002","type":"impression","ad":"77030000-0000-0000-0000-000000000001","placement":"community_feed","community":"77020000-0000-0000-0000-000000000001"}]')) ->> 'accepted','0',
 'evento de posicionamento não autorizado é rejeitado');
reset role;
select is((select visible_impressions from public.sponsored_ad_daily_stats where ad_id='77030000-0000-0000-0000-000000000001' and placement='progress_banner'),1::bigint,
 'métrica institucional reutiliza agregado existente');
update public.advertising_placements set delivery_enabled=false where code='progress_banner';
select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'partial',
 'um posicionamento desativado não pausa anúncio que continua na Home e comunidade');
reset role;
select pg_temp.as_viewer();
set local role authenticated;
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,'gate de exibição bloqueia anúncio institucional');
select is((public.record_ad_events('[{"id":"77040000-0000-0000-0000-000000000003","type":"impression","ad":"77030000-0000-0000-0000-000000000001","placement":"progress_banner"}]')) ->> 'accepted','0',
 'gate de exibição bloqueia métrica institucional');
reset role;
update public.advertising_placements set delivery_enabled=false where code in('home_banner','community_banner');
select pg_temp.as_admin();
set local role authenticated;
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'paused',
 'todos os posicionamentos indisponíveis pausam a entrega');
reset role;
update public.advertising_placements set delivery_enabled=true where code in('home_banner','community_banner');
update public.advertising_placements set delivery_enabled=true where code='progress_banner';

select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000001',2,false),3::bigint,
 'suspensão interrompe entrega');
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'suspended',
 'estado suspenso prevalece sobre posicionamentos disponíveis');
reset role;
select pg_temp.as_viewer();
set local role authenticated;
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,'anúncio suspenso não aparece');
reset role;
update public.sponsored_ads set expires_at=now()-interval '1 second' where id='77030000-0000-0000-0000-000000000001';
select pg_temp.as_admin();
set local role authenticated;
select throws_ok($$select public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000001',3,true)$$,
 'AD_EXPIRED','anúncio expirado não é reativado');
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000001'),'expired',
 'expiração tem prioridade na classificação administrativa');
reset role;

-- Cada combinação preserva os escopos autorizados sem herdar outras rotas.
select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000004',0,
 pg_temp.ad_payload('[{"code":"progress_banner","contextId":null},{"code":"community_feed","contextId":"77020000-0000-0000-0000-000000000001"}]')),1::bigint,
 'Progresso + Feed da comunidade criado');
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000004',1,true),2::bigint,
 'Progresso + Feed ativo');
reset role;
select pg_temp.as_viewer();
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('progress_banner',null)) x where x->>'id'='77030000-0000-0000-0000-000000000004'),
 'Progresso autorizado aparece');
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('community_feed','77020000-0000-0000-0000-000000000001')) x where x->>'id'='77030000-0000-0000-0000-000000000004'),
 'Feed autorizado aparece');
select is(public.select_advertising('community_banner','77020000-0000-0000-0000-000000000001'),'[]'::jsonb,
 'Feed não herda Banner da comunidade');
reset role;
select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000004',2,false),3::bigint,'primeira combinação suspensa');
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000005',0,
 pg_temp.ad_payload('[{"code":"community_banner","contextId":"77020000-0000-0000-0000-000000000001"},{"code":"community_feed","contextId":"77020000-0000-0000-0000-000000000001"}]')),1::bigint,
 'Banner + Feed da comunidade criado');
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000005',1,true),2::bigint,
 'Banner + Feed ativo');
reset role;
select pg_temp.as_viewer();
set local role authenticated;
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('community_banner','77020000-0000-0000-0000-000000000001')) x where x->>'id'='77030000-0000-0000-0000-000000000005'),
 'Banner da comunidade autorizado aparece');
select ok(exists(select 1 from jsonb_array_elements(public.select_advertising('community_feed','77020000-0000-0000-0000-000000000001')) x where x->>'id'='77030000-0000-0000-0000-000000000005'),
 'Feed da mesma comunidade autorizado aparece');
select is(public.select_advertising('progress_banner',null),'[]'::jsonb,
 'Banner + Feed da comunidade não ganha Progresso');
reset role;
select pg_temp.as_admin();
set local role authenticated;
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000005',2,false),3::bigint,'segunda combinação suspensa');
select is(public.admin_save_institutional_ad('77030000-0000-0000-0000-000000000006',0,
 pg_temp.ad_payload('[{"code":"home_banner","contextId":null},{"code":"progress_banner","contextId":null},{"code":"community_banner","contextId":"77020000-0000-0000-0000-000000000001"},{"code":"community_feed","contextId":"77020000-0000-0000-0000-000000000001"}]')),1::bigint,
 'quatro posicionamentos explícitos criados');
select is(public.admin_set_institutional_ad_active('77030000-0000-0000-0000-000000000006',1,true),2::bigint,
 'quatro posicionamentos ativados sem exceder capacidade');
select is(pg_temp.ad_status('77030000-0000-0000-0000-000000000006'),'delivering',
 'todos os quatro posicionamentos elegíveis');
reset role;
select pg_temp.as_viewer();
set local role authenticated;
select is((select count(*)::integer from jsonb_array_elements(public.select_advertising('home_banner',null)) x where x->>'id'='77030000-0000-0000-0000-000000000006')+
 (select count(*)::integer from jsonb_array_elements(public.select_advertising('progress_banner',null)) x where x->>'id'='77030000-0000-0000-0000-000000000006')+
 (select count(*)::integer from jsonb_array_elements(public.select_advertising('community_banner','77020000-0000-0000-0000-000000000001')) x where x->>'id'='77030000-0000-0000-0000-000000000006')+
 (select count(*)::integer from jsonb_array_elements(public.select_advertising('community_feed','77020000-0000-0000-0000-000000000001')) x where x->>'id'='77030000-0000-0000-0000-000000000006'),4,
 'anúncio em quatro rotas aparece exatamente nas quatro autorizações');
reset role;
select ok(exists(select 1 from public.admin_audit_log where action='institutional_ad_activate' and metadata->>'adId'='77030000-0000-0000-0000-000000000001'),
 'ativação tem registro administrativo');
select * from finish();
rollback;
