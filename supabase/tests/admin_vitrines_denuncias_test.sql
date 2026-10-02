begin;
select plan(25);

-- Fixtures: um dono de vitrine (reporter-alvo), um denunciante comum, um superadmin.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('51000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
   'owner-admintest@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('51000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
   'reporter-admintest@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
  ('51000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
   'superadmin-admintest@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

update public.users set usage_profile = 'professional', username = 'ownerdenuncia'
  where id = '51000000-0000-0000-0000-000000000001';
update public.users set username = 'reporterdenuncia'
  where id = '51000000-0000-0000-0000-000000000002';
update public.users set role = 'superadmin', username = 'superadmindenuncia'
  where id = '51000000-0000-0000-0000-000000000003';

-- Vitrine do dono, já publicada (pra existir algo pra denunciar/suspender/listar).
insert into public.professional_listings (id, owner_id, kind, lifecycle_state, published_version)
values ('52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'professional', 'published', 1);
insert into public.professional_listing_drafts (
  listing_id, owner_id, kind, display_name, category_key, modality_keys, specialties, bio, city, city_key, uf,
  service_mode, contacts, version
) values (
  '52000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000001', 'professional',
  'Personal Trainer Teste Admin', 'personal_trainer', array['musculacao'], '{}', 'Bio de teste',
  'São Paulo', 'sao paulo', 'SP', 'online', '{}'::jsonb, 1
);

insert into public.published_professional_listings (
  listing_id, kind, display_name, sort_key, category_key, modality_keys, specialties, bio, city, city_key, uf,
  service_mode, public_contacts, published_version
) values (
  '52000000-0000-0000-0000-000000000001', 'professional', 'Personal Trainer Teste Admin', 'personal trainer teste admin',
  'personal_trainer', array['musculacao'], '{}', 'Bio de teste', 'São Paulo', 'sao paulo', 'SP', 'online', '[]'::jsonb, 1
);

-- === usuário comum não lista Vitrines ===
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000002', true);
select throws_ok(
  $$select public.admin_list_professional_listings()$$,
  'PERMISSION_DENIED',
  'usuário comum não pode listar Vitrines no admin'
);
select throws_ok(
  $$select public.admin_get_professional_listing('52000000-0000-0000-0000-000000000001')$$,
  'PERMISSION_DENIED',
  'usuário comum não pode ver detalhe de Vitrine no admin'
);

-- === denúncia de Vitrine mantém listing_id / categoria salva / contexto automático ===
select is(
  (public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Este profissional está usando foto de outra pessoa.',
    'listingId', '52000000-0000-0000-0000-000000000001', 'category', 'image_or_identity_misuse'
  )))->>'id' is not null,
  true,
  'denúncia de vitrine é aceita com categoria válida'
);
select is(
  (select listing_id from public.support_requests where user_id = '51000000-0000-0000-0000-000000000002' order by created_at desc limit 1)::text,
  '52000000-0000-0000-0000-000000000001',
  'listing_id persiste na denúncia (não é mais descartado)'
);
select is(
  (select listing_owner_id from public.support_requests where user_id = '51000000-0000-0000-0000-000000000002' order by created_at desc limit 1)::text,
  '51000000-0000-0000-0000-000000000001',
  'listing_owner_id é resolvido pelo próprio banco, não pelo cliente'
);
select is(
  (select listing_kind from public.support_requests where user_id = '51000000-0000-0000-0000-000000000002' order by created_at desc limit 1),
  'professional',
  'listing_kind é resolvido pelo próprio banco'
);
select is(
  (select category from public.support_requests where user_id = '51000000-0000-0000-0000-000000000002' order by created_at desc limit 1),
  'image_or_identity_misuse',
  'categoria da denúncia é salva corretamente'
);

-- Cada submit_support_request grava support_limits (cooldown de 60s) -- os testes
-- seguintes disparam várias chamadas do mesmo usuário na mesma transação, então o
-- cooldown é resetado entre elas pra cada teste exercitar a validação que realmente quer
-- (não RATE_LIMITED mascarando outro erro esperado).
delete from public.support_limits where user_id = '51000000-0000-0000-0000-000000000002';

-- === usuário não consegue denunciar listing inexistente ===
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Denúncia de vitrine que não existe mais.',
    'listingId', '52000000-0000-0000-0000-000000000099', 'category', 'spam'
  ))$$,
  'LISTING_NOT_FOUND',
  'não é possível denunciar uma vitrine inexistente'
);

-- === kind=report sem categoria é rejeitado; kind=report com categoria 'other' é aceito (descrição já é obrigatória via message) ===
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Denúncia sem categoria selecionada.'
  ))$$,
  'INVALID_CATEGORY',
  'denúncia (kind=report) exige categoria'
);
delete from public.support_limits where user_id = '51000000-0000-0000-0000-000000000002';
select is(
  (public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Motivo não listado nas categorias padrão.', 'category', 'other'
  )))->>'id' is not null,
  true,
  'categoria other é aceita quando a descrição (message) está preenchida'
);

-- === não pode denunciar a própria vitrine ===
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Tentando denunciar a própria vitrine.',
    'listingId', '52000000-0000-0000-0000-000000000001', 'category', 'spam'
  ))$$,
  'CANNOT_REPORT_SELF',
  'titular não pode denunciar a própria vitrine'
);

-- === post/comunidade (status) continua funcionando (regressão) ===
insert into public.communities (id, name, created_by) values
  ('53000000-0000-0000-0000-000000000001', 'Comunidade Teste Admin', '51000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) values
  ('53000000-0000-0000-0000-000000000001', '51000000-0000-0000-0000-000000000002');
insert into public.statuses (id, community_id, author_id, type, text, expires_at) values
  ('54000000-0000-0000-0000-000000000001', '53000000-0000-0000-0000-000000000001',
   '51000000-0000-0000-0000-000000000001', 'text', 'Post de teste', now() + interval '1 day');

select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000002', true);
delete from public.support_limits where user_id = '51000000-0000-0000-0000-000000000002';
select is(
  (public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Denunciando este post por conteúdo proibido.',
    'statusId', '54000000-0000-0000-0000-000000000001', 'category', 'prohibited_content'
  )))->>'id' is not null,
  true,
  'denúncia de post/comunidade continua funcionando (regressão) e aceita categoria'
);
select is(
  (select status_id from public.support_requests where user_id = '51000000-0000-0000-0000-000000000002'
    and status_id is not null order by created_at desc limit 1)::text,
  '54000000-0000-0000-0000-000000000001',
  'status_id de uma denúncia de post continua sendo gravado normalmente'
);

-- === appeal/privacy continuam funcionando (regressão) ===
delete from public.support_limits where user_id = '51000000-0000-0000-0000-000000000002';
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object('kind', 'appeal', 'message', 'Recurso sem decisionId válido.'))$$,
  'DECISION_NOT_FOUND',
  'appeal continua exigindo decisionId válido (regressão, categoria não se aplica)'
);
delete from public.support_limits where user_id = '51000000-0000-0000-0000-000000000002';
select is(
  (public.submit_support_request(jsonb_build_object(
    'kind', 'privacy', 'message', 'Quero excluir minha conta e meus dados.'
  )))->>'id' is not null,
  true,
  'privacy continua funcionando sem categoria (regressão)'
);

-- === superadmin lista Vitrines (com busca) e vê detalhe ===
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000003', true);
select is(
  (select count(*)::int from public.admin_list_professional_listings('Personal Trainer Teste Admin', '', null, 50)),
  1,
  'superadmin encontra a vitrine pela busca por nome'
);
select is(
  (select owner_username from public.admin_list_professional_listings('', '', null, 50)
    where id = '52000000-0000-0000-0000-000000000001'),
  'ownerdenuncia',
  'listagem admin resolve o titular (owner_username) sem N+1'
);
select is(
  (public.admin_get_professional_listing('52000000-0000-0000-0000-000000000001'))->>'ownerUsername',
  'ownerdenuncia',
  'detalhe admin resolve o titular'
);

-- === paginação (cursor) ===
select is(
  (select count(*)::int from public.admin_list_professional_listings('', '', null, 1)),
  1,
  'paginação respeita page_size'
);

-- === suspensão via denúncia (decide_support_request com suspend_listing) ===
select set_config('request.jwt.claim.sub', '51000000-0000-0000-0000-000000000003', true);
select public.decide_support_request(jsonb_build_object(
  'requestId', (select id from public.support_requests where listing_id = '52000000-0000-0000-0000-000000000001' order by created_at desc limit 1),
  'action', 'suspend_listing',
  'rule', 'Regra de uso de imagem de terceiros',
  'reason', 'Confirmado uso indevido de imagem na vitrine denunciada.',
  'evidence', 'Comparação com a foto original enviada pelo denunciante.'
));
select is(
  (select lifecycle_state from public.professional_listings where id = '52000000-0000-0000-0000-000000000001'),
  'suspended',
  'suspend_listing suspende a vitrine de verdade (via suspend_professional_listing)'
);
select is(
  (select count(*)::int from public.published_professional_listings where listing_id = '52000000-0000-0000-0000-000000000001'),
  0,
  'vitrine suspensa via denúncia sai de published_professional_listings'
);

-- === histórico de decisão (moderation_decisions.listing_id) ===
select is(
  (select listing_id from public.moderation_decisions where action = 'suspend_listing' order by created_at desc limit 1)::text,
  '52000000-0000-0000-0000-000000000001',
  'moderation_decisions guarda o listing_id da suspensão (histórico, sem sistema paralelo)'
);

-- === Vitrine suspensa aparece corretamente no admin ===
select is(
  (select lifecycle_state from public.admin_list_professional_listings('', 'suspended', null, 50) where id = '52000000-0000-0000-0000-000000000001'),
  'suspended',
  'vitrine suspensa aparece no admin com o lifecycle_state correto'
);

-- === denúncia aparece na central de moderação com contexto da vitrine ===
select is(
  (select item->>'listingDisplayName' from jsonb_array_elements(
    (public.admin_list_support_requests('', '52000000-0000-0000-0000-000000000001'))->'items'
  ) item limit 1),
  'Personal Trainer Teste Admin',
  'admin_list_support_requests resolve o nome da vitrine em lote'
);
select is(
  (select item->>'listingLifecycleState' from jsonb_array_elements(
    (public.admin_list_support_requests('', '52000000-0000-0000-0000-000000000001'))->'items'
  ) item limit 1),
  'suspended',
  'admin_list_support_requests mostra o estado atual (ao vivo) da vitrine'
);

select * from finish();
rollback;
