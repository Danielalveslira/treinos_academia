-- PR3: creating a new legacy partner_products row (storefront_id null) via direct
-- client insert is removed for good (RLS policy dropped + INSERT grant revoked from
-- authenticated), not just hidden in the UI. Editing/deleting an EXISTING legacy row
-- must keep working -- this file only proves the removed/preserved grants; the
-- image/publication trigger itself is already covered by
-- partner_products_require_image_test.sql (which runs as the unrestricted test role,
-- unaffected by this migration), and the modern storefront write path (never used
-- direct insert) by product_storefronts_test.sql.
\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('7f000000-0000-0000-0000-000000000001','authenticated','authenticated','pr3-legacy-admin@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='7f000000-0000-0000-0000-000000000001';

-- Fixture only: a pre-existing legacy row, inserted with the unrestricted role (same
-- technique as partner_products_require_image_test.sql), never through the removed
-- grant being tested here.
insert into public.partner_products(id,name,brand,description,category,store_url,image_url)
values('7f100000-0000-0000-0000-000000000001','PR3 legacy fixture','Marca','Descrição verificável do produto legado','Acessórios','https://example.com/pr3-legacy','https://example.com/pr3-legacy.jpg');

select pg_temp.set_test_user('7f000000-0000-0000-0000-000000000001',true);
set local role authenticated;

select throws_ok(
 $$insert into public.partner_products(name,brand,description,category,store_url,image_url)
   values('Tentativa de criação removida','Marca','Descrição verificável do produto','Acessórios','https://example.com/novo','https://example.com/novo.jpg')$$,
 '42501',null,
 'superadmin autenticado não pode mais criar um produto legado novo -- a política de insert foi removida, não só escondida'
);

select lives_ok(
 $$update public.partner_products set description='Descrição legada revisada, ainda válida' where id='7f100000-0000-0000-0000-000000000001'$$,
 'editar um produto legado já existente continua permitido'
);

select ok(
 not has_table_privilege('authenticated','public.partner_products','insert'),
 'o grant de insert em partner_products foi revogado de authenticated, não só a policy'
);
select ok(
 has_table_privilege('authenticated','public.partner_products','update'),
 'o grant de update permanece -- edição de legado preservada'
);
select ok(
 has_table_privilege('authenticated','public.partner_products','delete'),
 'o grant de delete permanece -- exclusão de legado preservada'
);

select lives_ok(
 $$delete from public.partner_products where id='7f100000-0000-0000-0000-000000000001'$$,
 'excluir um produto legado já existente continua permitido'
);

reset role;
select * from finish();
rollback;
