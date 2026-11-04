-- Cobertura de 20261212000005: conteúdo pessoal de vitrine some na exclusão de conta,
-- o anchor financeiro (commercial_resources) nunca é apagado, e capas de comunidade
-- entram no outbox de limpeza de Storage.
\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('95000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','asdc-'||i||'@example.invalid','x',now(),'{}','{}',now(),now()
from unnest(array[1,2,3]) i;
update public.users set role='superadmin' where id='95000000-0000-0000-0000-000000000002';

-- === 1. Vitrine aprovada e publicada, com produto financeiro (commercial_orders) real ===
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values ('95100000-0000-0000-0000-000000000001','product_storefront','95000000-0000-0000-0000-000000000001',2,null,'draft');
insert into public.product_storefronts(id,owner_user_id,name,description,contact,draft_revision,draft_state)
values ('95100000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000001','Loja aprovada','Descricao valida de teste','contato@example.invalid',2,'approved');
update private.commercial_resources set moderation_state='approved',approved_revision=2 where id='95100000-0000-0000-0000-000000000001';
insert into public.storefront_media(id,storefront_id,storage_path,state,width,height,byte_size)
values ('95110000-0000-0000-0000-000000000001','95100000-0000-0000-0000-000000000001','95100000-0000-0000-0000-000000000001/95110000-0000-0000-0000-000000000001.webp','ready',32,32,100);
update public.product_storefronts set logo_media_id='95110000-0000-0000-0000-000000000001' where id='95100000-0000-0000-0000-000000000001';
insert into public.partner_products(id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order,archived)
values ('95120000-0000-0000-0000-000000000001','95100000-0000-0000-0000-000000000001','Produto','Marca','Descricao valida','Fitness','https://example.invalid/p','95110000-0000-0000-0000-000000000001',1000,0,false);
insert into public.storefront_publications(storefront_id,revision,name,description,contact,logo_media_id)
values ('95100000-0000-0000-0000-000000000001',2,'Loja aprovada','Descricao valida de teste','contato@example.invalid','95110000-0000-0000-0000-000000000001');
insert into public.storefront_published_products(product_id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order)
values ('95120000-0000-0000-0000-000000000001','95100000-0000-0000-0000-000000000001','Produto','Marca','Descricao valida','Fitness','https://example.invalid/p','95110000-0000-0000-0000-000000000001',1000,0);

-- Registro financeiro real (fulfilled), pra provar que a exclusão não quebra a FK sem
-- cascade de commercial_orders -> commercial_resources nem perde o histórico de cobrança.
insert into public.commercial_price_versions(id,offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
values ('95130000-0000-0000-0000-000000000001','product_storefront',9001,700,1,30,now()-interval '1 day','95000000-0000-0000-0000-000000000002','Tarifa sintetica de teste');
insert into public.commercial_orders(id,payer_user_id,request_id,resource_id,offering_code,price_version_id,content_revision,duration_days,unit_price_cash,total_cash,status,quote_expires_at,fulfilled_at,period_start,period_end)
values ('95140000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000001',gen_random_uuid(),'95100000-0000-0000-0000-000000000001','product_storefront','95130000-0000-0000-0000-000000000001',2,7,700,4900,'fulfilled',now()+interval '1 hour',now()-interval '1 day',now()-interval '1 day',now()-interval '1 day'+interval '7 days');

-- === 2. Vitrine ainda em rascunho (nunca aprovada), do segundo usuário ===
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values ('95200000-0000-0000-0000-000000000001','product_storefront','95000000-0000-0000-0000-000000000003',1,null,'draft');
insert into public.product_storefronts(id,owner_user_id,name,description,contact,draft_revision,draft_state)
values ('95200000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000003','Loja rascunho','Descricao valida de teste','contato@example.invalid',1,'draft');
insert into public.partner_products(id,storefront_id,name,brand,description,category,store_url,media_id,price_centavos,display_order,archived)
values ('95220000-0000-0000-0000-000000000001','95200000-0000-0000-0000-000000000001','','','','','',null,null,0,false);

-- === 3. Comunidade com capa, do primeiro usuário ===
insert into public.communities(id,name,description,owner_id,created_by,is_active)
values ('95300000-0000-0000-0000-000000000001','Comunidade teste','desc','95000000-0000-0000-0000-000000000001','95000000-0000-0000-0000-000000000001',true);
update public.communities set cover_path='95300000-0000-0000-0000-000000000001.webp' where id='95300000-0000-0000-0000-000000000001';

select is((select count(*)::int from public.product_storefronts where id='95100000-0000-0000-0000-000000000001'),1,'setup: vitrine aprovada existe antes');
select is((select count(*)::int from public.storefront_media where storefront_id='95100000-0000-0000-0000-000000000001'),1,'setup: midia existe antes');

-- === Exclusão direta de comunidade (kind=community) enfileira a capa para limpeza ===
delete from public.communities where id='95300000-0000-0000-0000-000000000001';
select is((select state from public.storage_cleanup_tasks where bucket='community-covers' and reference='95300000-0000-0000-0000-000000000001.webp'),
  'pending','capa de comunidade excluida entra no outbox de limpeza');
select is((select object_key from public.storage_cleanup_tasks where bucket='community-covers' and reference='95300000-0000-0000-0000-000000000001.webp'),
  '95300000-0000-0000-0000-000000000001.webp','object_key da capa calculado corretamente (sem dono, um arquivo por comunidade)');

-- === Exclusão de conta 1 (vitrine aprovada + pedido financeiro) ===
insert into public.deletion_jobs(kind,target_id,state,stage) values ('account','95000000-0000-0000-0000-000000000001','pending',0);
select (public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='95000000-0000-0000-0000-000000000001'))->>'authPending')::boolean as _run1 \gset
select ok(:'_run1','job 1 roda sem erro (banco limpo, so falta Auth)');

select is((select count(*)::int from public.product_storefronts where id='95100000-0000-0000-0000-000000000001'),0,'vitrine aprovada: product_storefronts removida');
select is((select count(*)::int from public.partner_products where storefront_id='95100000-0000-0000-0000-000000000001'),0,'vitrine aprovada: produtos removidos');
select is((select count(*)::int from public.storefront_media where storefront_id='95100000-0000-0000-0000-000000000001'),0,'vitrine aprovada: midia removida');
select is((select count(*)::int from public.storefront_publications where storefront_id='95100000-0000-0000-0000-000000000001'),0,'vitrine aprovada: publicacao removida');
select is((select count(*)::int from public.storefront_published_products where storefront_id='95100000-0000-0000-0000-000000000001'),0,'vitrine aprovada: produto publicado removido');
select is((select moderation_state from private.commercial_resources where id='95100000-0000-0000-0000-000000000001'),'archived','anchor arquivado, nao apagado');
select is((select owner_user_id from private.commercial_resources where id='95100000-0000-0000-0000-000000000001'),null,'anchor perde o dono (FK on delete set null preexistente)');
select is((select state from public.storage_cleanup_tasks where bucket='storefront-media' and reference like '95100000%'),'pending','midia da vitrine aprovada entra no outbox de limpeza');

-- Garantia central: o registro financeiro sobrevive intacto, sem violar a FK sem cascade.
select is((select count(*)::int from public.commercial_orders where id='95140000-0000-0000-0000-000000000001'),1,'pedido financeiro (fulfilled) sobrevive intacto');
select is((select status from public.commercial_orders where id='95140000-0000-0000-0000-000000000001'),'fulfilled','pedido continua fulfilled, nao reescrito');
select is((select total_cash from public.commercial_orders where id='95140000-0000-0000-0000-000000000001')::int,4900,'valor cobrado preservado para auditoria');
select is((select count(*)::int from public.commercial_price_versions where id='95130000-0000-0000-0000-000000000001'),1,'tarifa historica preservada');
select is((select count(*)::int from public.users where id='95000000-0000-0000-0000-000000000001'),0,'conta 1 removida de public.users');

-- === Exclusão de conta 3 (vitrine ainda em rascunho, nunca aprovada/publicada) ===
insert into public.deletion_jobs(kind,target_id,state,stage) values ('account','95000000-0000-0000-0000-000000000003','pending',0);
select (public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='95000000-0000-0000-0000-000000000003'))->>'authPending')::boolean as _run3 \gset
select ok(:'_run3','job 3 (vitrine so rascunho) roda sem erro');
select is((select count(*)::int from public.product_storefronts where id='95200000-0000-0000-0000-000000000001'),0,'vitrine rascunho tambem e removida (nunca precisou estar aprovada)');
select is((select count(*)::int from public.partner_products where storefront_id='95200000-0000-0000-0000-000000000001'),0,'produto incompleto do rascunho tambem removido');
select is((select moderation_state from private.commercial_resources where id='95200000-0000-0000-0000-000000000001'),'archived','anchor do rascunho tambem arquivado');

-- === Conta sem nenhuma vitrine: loop e no-op, sem erro ===
insert into public.deletion_jobs(kind,target_id,state,stage) values ('account','95000000-0000-0000-0000-000000000002','pending',0);
select (public.run_deletion_job((select id from public.deletion_jobs where kind='account' and target_id='95000000-0000-0000-0000-000000000002'))->>'authPending')::boolean as _run2 \gset
select ok(:'_run2','conta sem vitrine: job roda normalmente, loop vazio nao erra');

-- === O outbox genérico continua limitado a buckets reais ===
select throws_ok(
  $$insert into public.storage_cleanup_tasks(bucket,reference,source_id) values ('not-a-real-bucket','x',gen_random_uuid())$$,
  '23514', null, 'bucket desconhecido continua rejeitado (CHECK ampliado, nao removido)');

select * from finish();
rollback;
