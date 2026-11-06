\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- '01' = autor/dono da comunidade; '02' = superadmin; '03' = membro comum da mesma comunidade.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('89000000-0000-0000-0000-0000000000' || n)::uuid,
       'authenticated', 'authenticated', 'edit-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;

update public.users set role = 'superadmin'
where id = '89000000-0000-0000-0000-000000000002';
update public.users u
set legal_acceptance_version = p.version,
    legal_acceptance_digest = p.digest,
    legal_acceptance_accepted_at = now()
from public.legal_policy p
where p.id and p.published
  and u.id::text like '89000000-%';
insert into public.public_profiles (user_id, username)
select id, 'editor' || right(id::text, 2)
from public.users where id::text like '89000000-%';

insert into public.communities (id, name, created_by, owner_id)
values ('8a000000-0000-0000-0000-000000000001', 'Comunidade de edição',
        '89000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id)
values
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000001'),
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000002'),
  ('8a000000-0000-0000-0000-000000000001', '89000000-0000-0000-0000-000000000003');

insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('8b000000-0000-0000-0000-000000000001', '8a000000-0000-0000-0000-000000000001',
        '89000000-0000-0000-0000-000000000001', 'text', 'Texto original', now() + interval '2 days');
insert into public.statuses (
  id, community_id, author_id, type, photo_path, photo_caption, expires_at
) values (
  '8b000000-0000-0000-0000-000000000002', '8a000000-0000-0000-0000-000000000001',
  '89000000-0000-0000-0000-000000000001', 'photo',
  'statusPhotos/8a000000-0000-0000-0000-000000000001/8b000000-0000-0000-0000-000000000002.webp',
  'Legenda original', now() + interval '2 days'
);
insert into public.statuses (
  id, community_id, author_id, type, poll_question, poll_options, expires_at
) values (
  '8b000000-0000-0000-0000-000000000003', '8a000000-0000-0000-0000-000000000001',
  '89000000-0000-0000-0000-000000000001', 'poll', 'Pergunta?',
  '[{"id":"1","label":"A"},{"id":"2","label":"B"}]'::jsonb, now() + interval '2 days'
);
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('8b000000-0000-0000-0000-000000000004', '8a000000-0000-0000-0000-000000000001',
        '89000000-0000-0000-0000-000000000001', 'text', 'Vai expirar', now() - interval '1 hour');

grant select on public.statuses to authenticated;
set local role authenticated;

-- 1) Autor edita o próprio texto: conteúdo muda, edited_at passa a existir, timestamps/contadores
-- protegidos permanecem intocados.
select pg_temp.as_user('01');
create temp table before_edit as
select * from public.statuses where id = '8b000000-0000-0000-0000-000000000001';

create temp table edited_text as
select public.update_own_status_content(
  '8b000000-0000-0000-0000-000000000001', 'Texto editado pelo autor', null, null
) as row;

select is((select (row).text from edited_text), 'Texto editado pelo autor', 'autor edita o próprio texto');
select isnt((select (row).edited_at from edited_text), null, 'edição grava edited_at');
select is(
  (select (row).author_id from edited_text),
  (select author_id from before_edit),
  'author_id permanece imutável'
);
select is(
  (select (row).community_id from edited_text),
  (select community_id from before_edit),
  'community_id permanece imutável'
);
select is(
  (select (row).created_at from edited_text),
  (select created_at from before_edit),
  'created_at permanece imutável'
);
select is(
  (select (row).expires_at from edited_text),
  (select expires_at from before_edit),
  'editar não renova expires_at'
);
select is(
  (select (row).comment_count from edited_text),
  (select comment_count from before_edit),
  'contadores (comment_count) permanecem intocados pela edição'
);

-- 2) Autor edita a legenda da foto (foto em si não muda nesta primeira entrega).
create temp table edited_photo as
select public.update_own_status_content(
  '8b000000-0000-0000-0000-000000000002', null, 'Legenda editada', null
) as row;
select is((select (row).photo_caption from edited_photo), 'Legenda editada', 'autor edita a legenda da foto');
select is(
  (select (row).photo_path from edited_photo),
  (select photo_path from public.statuses where id = '8b000000-0000-0000-0000-000000000002'),
  'editar legenda não altera photo_path'
);

-- 3) Usuário comum (não autor) tentando editar: PERMISSION_DENIED.
select pg_temp.as_user('03');
select throws_ok(
  $$select public.update_own_status_content('8b000000-0000-0000-0000-000000000001', 'hackeado', null, null)$$,
  'PERMISSION_DENIED',
  'usuário comum não edita publicação de terceiro'
);

-- 4) Superadmin e dono da comunidade (o mesmo usuário aqui) tentando editar post de outro autor:
-- moderação continua sendo só excluir -- editar silenciosamente é sempre proibido.
select pg_temp.as_user('02');
select throws_ok(
  $$select public.update_own_status_content('8b000000-0000-0000-0000-000000000001', 'hackeado pelo superadmin', null, null)$$,
  'PERMISSION_DENIED',
  'superadmin não edita silenciosamente publicação de terceiro'
);

-- 5) Manipulação de campos protegidos: a RPC só aceita texto/legenda -- não existe parâmetro
-- para author_id/community_id/type/created_at/expires_at/retention_mode/contadores/votos, então
-- uma chamada com mais argumentos do que a função aceita falha na própria assinatura.
select pg_temp.as_user('01');
select throws_ok(
  $$select public.update_own_status_content(
      '8b000000-0000-0000-0000-000000000001', 'x', null, null, '2099-01-01'::timestamptz
    )$$,
  '42883',
  'RPC não tem parâmetro para campos protegidos (assinatura rejeita argumento extra)'
);

-- 6) Publicação expirada: retorna erro claro, sem salvar nada.
select throws_ok(
  $$select public.update_own_status_content('8b000000-0000-0000-0000-000000000004', 'tentando', null, null)$$,
  'STATUS_EXPIRED',
  'publicação expirada não pode ser editada'
);
select is(
  (select text from public.statuses where id = '8b000000-0000-0000-0000-000000000004'),
  'Vai expirar',
  'nada foi salvo na tentativa de editar publicação expirada'
);

-- 7) Enquete continua somente leitura nesta primeira entrega.
select throws_ok(
  $$select public.update_own_status_content('8b000000-0000-0000-0000-000000000003', null, null, null)$$,
  'EDIT_NOT_SUPPORTED_FOR_TYPE',
  'enquete permanece somente leitura (fora do escopo desta entrega)'
);

-- 8) Conteúdo vazio é rejeitado (mesmo limite de criação).
select throws_ok(
  format(
    'select public.update_own_status_content(%L, %L, null, %L)',
    '8b000000-0000-0000-0000-000000000001', '   ',
    (select edited_at from public.statuses where id = '8b000000-0000-0000-0000-000000000001')
  ),
  'INVALID_BODY',
  'texto vazio é rejeitado'
);

-- 9) Concorrência: duas edições em paralelo -- a segunda a chegar (com o token antigo) recebe
-- EDIT_CONFLICT, nunca sobrescreve silenciosamente.
create temp table stale_token as
select edited_at from public.statuses where id = '8b000000-0000-0000-0000-000000000001';
select public.update_own_status_content(
  '8b000000-0000-0000-0000-000000000001', 'Primeira edição concorrente', null,
  (select edited_at from stale_token)
);
select throws_ok(
  format(
    'select public.update_own_status_content(%L, %L, null, %L)',
    '8b000000-0000-0000-0000-000000000001', 'Segunda edição, token velho',
    (select edited_at from stale_token)
  ),
  'EDIT_CONFLICT',
  'edição concorrente com token desatualizado é rejeitada, sem sobrescrita silenciosa'
);
select is(
  (select text from public.statuses where id = '8b000000-0000-0000-0000-000000000001'),
  'Primeira edição concorrente',
  'a edição vencedora (token correto) é a única que fica salva'
);

-- 10) Publicação inexistente.
select throws_ok(
  $$select public.update_own_status_content('00000000-0000-0000-0000-000000000000', 'x', null, null)$$,
  'STATUS_NOT_FOUND',
  'publicação inexistente retorna erro claro'
);

-- 11) Sem UPDATE genérico na tabela: a única porta de escrita é a RPC.
select ok(
  not has_table_privilege('authenticated', 'public.statuses', 'UPDATE'),
  'authenticated não tem UPDATE direto em public.statuses (só via RPC)'
);

reset role;
select * from finish();
rollback;
