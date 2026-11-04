begin;
select no_plan();
update private.commercial_resources set moderation_state='draft' where offering_code='product_storefront';

-- The public form may write only through its validated RPC.
set local role anon;
select throws_ok($$ select * from public.commercial_leads $$, '42501', null,
  'anonymous visitors cannot read commercial contacts');
select throws_ok($$ insert into public.commercial_leads
  (company, contact, email, segment, website, modality, message)
  values ('Empresa', 'Contato', 'direct@example.com', 'Fitness', 'https://example.com',
          'Publicidade', 'Mensagem comercial suficientemente longa') $$,
  '42501', null, 'anonymous visitors cannot insert contacts directly');
select throws_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'invalid-email', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  '22023', 'invalid submission', 'server rejects invalid email');
select throws_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'lead@example.com', null, 'Fitness', 'http://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  '22023', 'invalid submission', 'server rejects insecure website');
select lives_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'legacy@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', false, '') $$,
  'legacy false flag does not block a proposal or record consent');
select lives_ok($$ select public.submit_commercial_lead(
  p_company => 'Empresa', p_contact => 'Contato', p_email => 'new@example.com',
  p_whatsapp => null, p_segment => 'Fitness', p_website => '',
  p_modality => 'Publicidade', p_message => 'Mensagem comercial suficientemente longa') $$,
  'new clients may omit the legacy privacy flag');
select throws_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'lead@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, 'spam') $$,
  '22023', 'invalid submission', 'honeypot rejects automated submissions');
select lives_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'LEAD@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  'validated anonymous submission persists');
select lives_ok($$ select public.submit_commercial_lead(
  'Empresa sem site', 'Contato', 'sem-site@example.com', null, 'Fitness', '',
  'Vitrine de produtos', 'Proposta comercial sem site para avaliação', true, '') $$,
  'website is optional for a validated anonymous proposal');
reset role;
select is((select count(*)::int from public.commercial_leads where email = 'lead@example.com'), 1,
  'email is normalized and exactly one contact was stored');
select is((select website from public.commercial_leads where email = 'sem-site@example.com'), '',
  'missing website is stored without inventing a URL');
set local role anon;
select lives_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'lead@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  'second submission within the daily allowance works');
select lives_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'lead@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  'third submission within the daily allowance works');
select throws_ok($$ select public.submit_commercial_lead(
  'Empresa', 'Contato', 'lead@example.com', null, 'Fitness', 'https://example.com',
  'Publicidade', 'Mensagem comercial suficientemente longa', true, '') $$,
  'P0001', 'rate limited', 'fourth submission is rate limited');
reset role;

-- Unbound legacy products remain private in Phase 4, with their data preserved.
-- Todo INSERT exige image_url (enforce_partner_product_image, migration
-- 20261111000001_partner_products_require_image.sql) -- ver partner_products_require_image_test.sql
-- pra a regra em si (incluindo o caso de um produto legado sem imagem).
insert into public.partner_products
  (name, brand, description, category, store_url, image_url, approved, starts_at, ends_at)
values
  ('Produto aprovado', 'Marca A', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/a', 'https://example.com/a.jpg', true, now() - interval '1 day', now() + interval '1 day'),
  ('Produto rascunho', 'Marca B', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/b', 'https://example.com/b.jpg', false, null, null),
  ('Produto vencido', 'Marca C', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/c', 'https://example.com/c.jpg', true, now() - interval '2 days', now() - interval '1 day'),
  ('Produto futuro', 'Marca D', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/d', 'https://example.com/d.jpg', true, now() + interval '1 day', now() + interval '2 days');
set local role anon;
select throws_ok($$select * from public.partner_products$$,'42501',null,'legacy table cannot bypass storefront contracts');
select is((public.public_product_catalog('groups')->>'totalProducts')::int, 0,
  'legacy approvals do not grant storefront rights');
select is((public.public_product_catalog('groups')->>'totalBrands')::int, 0,
  'unbound legacy brands remain private');
select is((public.public_product_catalog('items', 'rascunho')->>'totalProducts')::int, 0,
  'search cannot reveal a draft');
select is((public.public_product_catalog('items', 'vencido')->>'totalProducts')::int, 0,
  'search cannot reveal an expired product');
select is((public.public_product_catalog('items', 'futuro')->>'totalProducts')::int, 0,
  'search cannot reveal a product before its start date');
select is((public.public_product_catalog('items', '', 'Acessórios', 'marca a')->>'totalProducts')::int, 0,
  'filters cannot reveal unbound legacy products');
select is(jsonb_array_length(public.public_product_catalog('categories')), 0,
  'category facets use only published products');
select throws_ok($$ insert into public.partner_products
  (name, brand, description, category, store_url, approved)
  values ('Produto externo', 'Marca D', 'Descrição verificável do produto', 'Acessórios', 'https://example.com/d', true) $$,
  '42501', null, 'anonymous visitors cannot publish products');
reset role;

select * from finish();
rollback;
