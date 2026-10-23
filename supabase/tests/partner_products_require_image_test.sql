-- enforce_partner_product_image (migration 20261111000001_partner_products_require_image.sql):
-- imagem é obrigatória em todo INSERT (cadastro novo) e sempre que approved=true
-- (publicação), mas produtos legados sem imagem seguem editáveis enquanto approved=false.
begin;
select no_plan();

select throws_ok($$ insert into public.partner_products
  (name, brand, description, category, store_url)
  values ('Sem imagem', 'Marca', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/x') $$,
  '22023', 'image_url is required to create a partner product',
  'novo cadastro sem imagem é rejeitado mesmo permanecendo rascunho (approved=false)');

select throws_ok($$ insert into public.partner_products
  (name, brand, description, category, store_url, approved)
  values ('Publicado sem imagem', 'Marca', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/x', true) $$,
  '22023', null,
  'novo cadastro publicado sem imagem é rejeitado');

select lives_ok($$ insert into public.partner_products
  (id, name, brand, description, category, store_url, image_url)
  values ('11111111-1111-1111-1111-111111111111', 'Com imagem', 'Marca', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/x', 'https://example.com/x.jpg') $$,
  'novo cadastro com imagem válida é aceito');

-- Simula um produto legado (anterior a esta regra): a imagem só pode faltar numa linha
-- que já existia -- nenhum fluxo normal da aplicação insere assim depois desta migration.
alter table public.partner_products disable trigger partner_products_require_image;
insert into public.partner_products
  (id, name, brand, description, category, store_url, image_url, approved)
  values ('22222222-2222-2222-2222-222222222222', 'Produto legado', 'Marca', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/legado', null, false);
alter table public.partner_products enable trigger partner_products_require_image;

select lives_ok($$ update public.partner_products set description = 'Descrição revisada e ainda válida'
  where id = '22222222-2222-2222-2222-222222222222' $$,
  'produto legado sem imagem continua editável enquanto não for publicado');

select throws_ok($$ update public.partner_products set approved = true
  where id = '22222222-2222-2222-2222-222222222222' $$,
  '22023', 'image_url is required to publish a partner product',
  'produto legado sem imagem não pode ser publicado');

select lives_ok($$ update public.partner_products set image_url = 'https://example.com/legado.jpg', approved = true
  where id = '22222222-2222-2222-2222-222222222222' $$,
  'produto legado passa a ser publicável assim que recebe uma imagem válida');

select * from finish();
rollback;
