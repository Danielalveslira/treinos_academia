\ir _helpers/auth_session.sql
begin;
select no_plan();
delete from public.sponsored_ad_daily_stats;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('a9100000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','adv'||n||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,4)n;
update public.users u set username='advtest'||right(u.id::text,1),legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and p.published and u.id::text like 'a9100000-%';
update public.users set role='superadmin' where id='a9100000-0000-0000-0000-000000000001';
create function pg_temp.as_ad_user(n integer) returns text language sql as $$select pg_temp.set_test_user('a9100000-0000-0000-0000-00000000000'||n,true)$$;
create function pg_temp.aderr(q text) returns text language plpgsql as $$begin execute q;return 'ok';exception when others then return sqlerrm;end$$;
create function pg_temp.report(a integer,ad uuid default null,off integer default 0) returns jsonb language sql as $$
 select public.get_advertiser_metrics(('a9200000-0000-0000-0000-00000000000'||a)::uuid,30,null,null,ad,null,null,off,0)$$;
insert into public.advertiser_accounts(id,name,created_by) values
 ('a9200000-0000-0000-0000-000000000001','Empresa A','a9100000-0000-0000-0000-000000000001'),
 ('a9200000-0000-0000-0000-000000000002','Empresa B','a9100000-0000-0000-0000-000000000001');
insert into public.sponsored_ads(id,title,partner_name,is_global,display_mode,created_by) values
 ('a9300000-0000-0000-0000-000000000001','Campanha A','Mesmo nome',true,'{banner}','a9100000-0000-0000-0000-000000000001'),
 ('a9300000-0000-0000-0000-000000000002','Campanha B','Mesmo nome',true,'{banner}','a9100000-0000-0000-0000-000000000001');
insert into public.sponsored_ad_daily_stats(day,ad_id,placement,context_id,partner_name,visible_impressions,unique_viewers,clicks,unqualified_clicks)
values
 (private.ad_metrics_day(now()),'a9300000-0000-0000-0000-000000000001','home_banner','00000000-0000-0000-0000-000000000000','Mesmo nome',10,5,20,2),
 (private.ad_metrics_day(now())-30,'a9300000-0000-0000-0000-000000000001','home_banner','00000000-0000-0000-0000-000000000000','Mesmo nome',5,3,0,0),
 (private.ad_metrics_day(now()),'a9300000-0000-0000-0000-000000000002','home_banner','00000000-0000-0000-0000-000000000000','Mesmo nome',700,500,1,1),
 (private.ad_metrics_day(now()),'a9300000-0000-0000-0000-000000000003','home_banner','00000000-0000-0000-0000-000000000000','Mesmo nome',999,1,1,0);
set local role authenticated;
select pg_temp.as_ad_user(1);
select lives_ok($$select public.admin_manage_advertiser('link','a9200000-0000-0000-0000-000000000001',null,true,'a9300000-0000-0000-0000-000000000001')$$,'admin vincula A');
select lives_ok($$select public.admin_manage_advertiser('link','a9200000-0000-0000-0000-000000000002',null,true,'a9300000-0000-0000-0000-000000000002')$$,'admin vincula B');
select lives_ok($$select public.admin_manage_advertiser('grant','a9200000-0000-0000-0000-000000000001',null,true,'a9100000-0000-0000-0000-000000000002')$$,'admin concede leitura A');
select lives_ok($$select public.admin_manage_advertiser('grant','a9200000-0000-0000-0000-000000000002',null,true,'a9100000-0000-0000-0000-000000000003')$$,'admin concede leitura B');
select is(pg_temp.aderr($$select public.admin_manage_advertiser('link','a9200000-0000-0000-0000-000000000002',null,true,'a9300000-0000-0000-0000-000000000001')$$),'CAMPAIGN_OWNER_IMMUTABLE','transferência direta bloqueada');
select lives_ok($$select public.get_sponsored_ad_metrics_dashboard()$$,'RPC administrativa anterior preservada');
select lives_ok($$select public.get_admin_ad_metrics_v2()$$,'RPC administrativa V2');
select pg_temp.as_ad_user(2);
select is(jsonb_array_length(public.list_advertiser_accounts()),1,'A lista só sua conta');
select is(pg_temp.report(1)#>>'{summary,visible_impressions}','10','A só agrega campanha atribuída, sem inferir nome');
select is(pg_temp.report(1)#>>'{summary,ctr_qualified}','180.00','CTR acima de 100 preservado');
select is(pg_temp.report(1)#>>'{previous,summary,visible_impressions}','5','período anterior equivalente');
select is((pg_temp.report(1)#>>'{previous,period,days}')::int,30,'janelas equivalentes');
select is(pg_temp.aderr('select pg_temp.report(2)'),'PERMISSION_DENIED','A não lê B');
select is(pg_temp.aderr($$select pg_temp.report(1,'a9300000-0000-0000-0000-000000000002')$$),'PERMISSION_DENIED','ad_id forjado B negado');
select is(pg_temp.aderr($$select pg_temp.report(1,'a9300000-0000-0000-0000-000000000003')$$),'PERMISSION_DENIED','ad_id não atribuído negado');
select is(pg_temp.aderr($$select public.get_sponsored_ad_metrics_dashboard()$$),'PERMISSION_DENIED','RPC antiga continua somente admin');
select is(pg_temp.aderr($$select public.get_admin_ad_metrics_v2()$$),'PERMISSION_DENIED','RPC V2 admin não abre a leitor');
select is(pg_temp.aderr($$select public.admin_manage_advertiser('create',null,'intruso')$$),'PERMISSION_DENIED','leitor não administra');
select is(pg_temp.aderr($$select public.admin_advertiser_directory('users',null,'adv')$$),'PERMISSION_DENIED','busca só admin');
select is((select count(*)::int from public.sponsored_ad_daily_stats),0,'RLS bloqueia estatísticas diretas');
select ok(not has_table_privilege('authenticated','public.advertiser_members','select'),'membros sem leitura direta');
select ok(not has_function_privilege('authenticated','private.advertiser_snapshot(uuid,integer,integer,integer,date,date,uuid,uuid,text)','execute'),'helper privado sem execute');
select ok(not has_function_privilege('anon','public.get_advertiser_metrics(uuid,integer,date,date,uuid,uuid,text,integer,integer)','execute'),'anon sem execute');
select pg_temp.as_ad_user(4);
select is(pg_temp.aderr('select pg_temp.report(1)'),'PERMISSION_DENIED','sem vínculo negado');
select pg_temp.as_ad_user(1);
select public.admin_manage_advertiser('grant','a9200000-0000-0000-0000-000000000002',null,true,'a9100000-0000-0000-0000-000000000002');
select pg_temp.as_ad_user(2);
select is(jsonb_array_length(public.list_advertiser_accounts()),2,'mesma pessoa em duas contas');
select is(pg_temp.report(2)#>>'{summary,visible_impressions}','700','segunda conta isolada');
select is(pg_temp.report(1)#>>'{summary,visible_impressions}','10','primeira conta permanece isolada');
select pg_temp.as_ad_user(1);
select public.admin_manage_advertiser('revoke','a9200000-0000-0000-0000-000000000001',null,true,'a9100000-0000-0000-0000-000000000002');
select pg_temp.as_ad_user(2);
select is(pg_temp.aderr('select pg_temp.report(1)'),'PERMISSION_DENIED','revogação imediata');
select pg_temp.as_ad_user(1);
select public.admin_manage_advertiser('grant','a9200000-0000-0000-0000-000000000001',null,true,'a9100000-0000-0000-0000-000000000002');
select public.admin_manage_advertiser('update','a9200000-0000-0000-0000-000000000001','Empresa A',false);
select pg_temp.as_ad_user(2);
select is(pg_temp.aderr('select pg_temp.report(1)'),'PERMISSION_DENIED','conta inativa nega leitura');
select pg_temp.as_ad_user(1);
select public.admin_manage_advertiser('update','a9200000-0000-0000-0000-000000000001','Empresa A',true);
delete from public.sponsored_ads where id='a9300000-0000-0000-0000-000000000001';
select pg_temp.as_ad_user(2);
select is(pg_temp.report(1)#>>'{summary,visible_impressions}','10','exclusão mantém histórico e autorização');
select is(pg_temp.report(1)#>>'{by_campaign,0,deleted}','true','campanha marcada removida');
select is(pg_temp.report(1)#>>'{by_campaign,0,title}','Campanha A','identidade histórica preservada');
select is((public.list_advertiser_campaigns('a9200000-0000-0000-0000-000000000001')->0->>'id'),'a9300000-0000-0000-0000-000000000001','catálogo mantém removida');
select is(pg_temp.aderr($$select public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',367)$$),'INVALID_RANGE','intervalo limitado');
select is(pg_temp.aderr('select pg_temp.report(1,null,-1)'),'INVALID_FILTER','offset inválido negado');
select pg_temp.set_test_user(null,true);
select is(pg_temp.aderr('select pg_temp.report(1)'),'PERMISSION_DENIED','sem sessão negado');
reset role;
insert into public.advertiser_campaigns(ad_id,account_id,title)
select md5('adv-pagination-'||n)::uuid,'a9200000-0000-0000-0000-000000000001','Página '||n from generate_series(1,105)n;
insert into public.sponsored_ad_daily_stats(day,ad_id,placement,context_id,partner_name,visible_impressions,unique_viewers,clicks,unqualified_clicks)
select private.ad_metrics_day(now()),md5('adv-pagination-'||n)::uuid,'home_banner','00000000-0000-0000-0000-000000000000','Página',1,1,0,0 from generate_series(1,105)n;
set local role authenticated;
select pg_temp.as_ad_user(2);
select is(jsonb_array_length(pg_temp.report(1)->'by_campaign'),100,'primeira página limitada a 100');
select is(jsonb_array_length(pg_temp.report(1,null,100)->'by_campaign'),6,'segunda página completa');
select is(pg_temp.report(1)->'summary',pg_temp.report(1,null,100)->'summary','paginação não altera totais');
select is(pg_temp.report(1)#>>'{campaigns_total}','106','total inclui todas');
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',30,null,null,null,null,'community_feed')#>>'{summary,visible_impressions}',null,'filtro sem registros mantém null');
select is(jsonb_array_length(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',30,null,null,null,null,'community_feed')->'daily'),0,'ausência não inventa série');
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',30,null,null,null,null,'home_banner')#>>'{summary,visible_impressions}','115','posicionamento soma apenas escopo autorizado');
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',30,null,null,null,'a9990000-0000-0000-0000-000000000001')#>>'{has_data}','false','comunidade sem registros não inclui dados de outra');
reset role;
insert into public.sponsored_ad_daily_stats(day,ad_id,placement,context_id,partner_name,visible_impressions,unique_viewers,clicks,unqualified_clicks)
values(private.ad_metrics_day(now())-2,'a9300000-0000-0000-0000-000000000001','home_banner','00000000-0000-0000-0000-000000000000','Zero medido',0,0,2,2);
set local role authenticated;
select pg_temp.as_ad_user(2);
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',1,(now() at time zone 'America/Sao_Paulo')::date-2,(now() at time zone 'America/Sao_Paulo')::date-2)#>>'{summary,visible_impressions}','0','zero comprovado preservado');
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',1,(now() at time zone 'America/Sao_Paulo')::date-2,(now() at time zone 'America/Sao_Paulo')::date-2)#>>'{summary,ctr_qualified}',null,'clique sem impressão mantém CTR null');
select is(public.get_advertiser_metrics('a9200000-0000-0000-0000-000000000001',1,(now() at time zone 'America/Sao_Paulo')::date-2,(now() at time zone 'America/Sao_Paulo')::date-2)#>>'{summary,qualified_clicks}','0','cliques sem impressão não viram qualificados');
select pg_temp.revoke_test_session('a9100000-0000-0000-0000-000000000002');
select is(pg_temp.aderr('select pg_temp.report(1)'),'PERMISSION_DENIED','sessão revogada nega leitura');
reset role;
select ok((select count(*)>5 from public.advertiser_audit),'operações auditadas');
select ok(not (select collection_enabled from public.sponsored_ad_metrics_settings where id),'coleta não ativada');
select * from finish();
rollback;
