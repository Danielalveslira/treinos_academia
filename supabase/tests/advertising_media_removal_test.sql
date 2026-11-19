\ir _helpers/auth_session.sql
begin;
select no_plan();

-- 20261222000011 (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md, seção 5.2.2): p_media_id
-- (default null) sempre significou "sem alteração" em edit_advertising_campaign; nunca houve
-- como voltar um rascunho a "sem imagem" depois de anexar uma. p_clear_media é o novo jeito
-- explícito, mutuamente exclusivo com p_media_id na mesma chamada.
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('76990000-0000-0000-0000-000000000001','authenticated','authenticated','ads-media-removal@example.invalid','x',now(),'{}','{}',now(),now());

create temp table media_results(name text primary key,value jsonb); grant all on media_results to authenticated;

select pg_temp.set_test_user('76990000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into media_results values('account',to_jsonb(public.create_advertising_account('Synthetic media-removal advertiser')));
select public.create_advertising_campaign((select(value#>>'{}')::uuid from media_results where name='account'),'home_banner',null,'Synthetic media removal','','https://example.invalid/media-removal','76991000-0000-0000-0000-000000000001');
reset role;

insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size)
values ('76992000-0000-0000-0000-000000000001','76991000-0000-0000-0000-000000000001','76991000-0000-0000-0000-000000000001/76992000-0000-0000-0000-000000000001.webp','ready',32,32,100);

select pg_temp.set_test_user('76990000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok(
  $$select public.edit_advertising_campaign('76991000-0000-0000-0000-000000000001',1,'Synthetic media removal','','https://example.invalid/media-removal',false,'76992000-0000-0000-0000-000000000001'::uuid,null,true)$$,
  'AD_MEDIA_CONFLICT','p_media_id e p_clear_media juntos são rejeitados');
select public.edit_advertising_campaign('76991000-0000-0000-0000-000000000001',1,'Synthetic media removal','','https://example.invalid/media-removal',false,'76992000-0000-0000-0000-000000000001'::uuid);
reset role;
select is((select media_id from private.advertising_drafts where ad_id='76991000-0000-0000-0000-000000000001'),'76992000-0000-0000-0000-000000000001'::uuid,'imagem anexada normalmente');

select pg_temp.set_test_user('76990000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.edit_advertising_campaign('76991000-0000-0000-0000-000000000001',2,'Synthetic media removal','','https://example.invalid/media-removal',false,null,null,true);
reset role;
select is((select media_id from private.advertising_drafts where ad_id='76991000-0000-0000-0000-000000000001'),null,'p_clear_media remove a imagem do rascunho');

-- Omitir p_media_id (fica null por padrão) numa edição posterior continua "sem alteração",
-- agora sobre um rascunho que já está sem imagem -- nunca reanexa nem duplica a limpeza.
select pg_temp.set_test_user('76990000-0000-0000-0000-000000000001',true);
set local role authenticated;
select public.edit_advertising_campaign('76991000-0000-0000-0000-000000000001',3,'Synthetic media removal renamed','','https://example.invalid/media-removal',false);
reset role;
select is((select media_id from private.advertising_drafts where ad_id='76991000-0000-0000-0000-000000000001'),null,'omitir p_media_id depois de remover continua sem imagem');
select is((select title from private.advertising_drafts where ad_id='76991000-0000-0000-0000-000000000001'),'Synthetic media removal renamed','outros campos continuam editáveis normalmente');

select * from finish();
rollback;
