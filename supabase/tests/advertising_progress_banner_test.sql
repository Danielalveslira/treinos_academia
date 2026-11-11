\ir _helpers/auth_session.sql
begin;
select no_plan();
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
 ('76930000-0000-0000-0000-000000000002','authenticated','authenticated','ads-progress-viewer@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='76930000-0000-0000-0000-000000000001';
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
select * from finish();
rollback;
