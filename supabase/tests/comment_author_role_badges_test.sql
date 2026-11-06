\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Regressão: comment_list_items já existia (20261002000005_comments_read_rls.sql) com uma lista
-- explícita de colunas -- CREATE OR REPLACE VIEW só aceita acrescentar ao FINAL, nunca reordenar
-- as já existentes. author_is_superadmin/author_is_community_admin precisam continuar entrando
-- só depois de author_avatar_path, nunca antes.
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
   from information_schema.columns
   where table_schema = 'public' and table_name = 'comment_list_items'),
  'id,status_id,author_id,parent_comment_id,root_comment_id,ancestor_ids,depth,body,status,' ||
  'reply_count,like_count,score,created_at,updated_at,edited_at,author_username,' ||
  'author_avatar_path,author_is_superadmin,author_is_community_admin',
  'comment_list_items preserva nome/tipo/ORDEM de toda coluna pré-existente; os dois selos só ' ||
  'entram ao final'
);

-- '01' = dono da comunidade A (nao superadmin); '02' = superadmin (nao dono);
-- '03' = membro comum da comunidade A; '04' = dono da comunidade B (outra comunidade).
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('85000000-0000-0000-0000-0000000000' || n)::uuid,
       'authenticated', 'authenticated', 'badge-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04']) as n;

update public.users set role = 'superadmin'
where id = '85000000-0000-0000-0000-000000000002';
update public.users u
set legal_acceptance_version = p.version,
    legal_acceptance_digest = p.digest,
    legal_acceptance_accepted_at = now()
from public.legal_policy p
where p.id and p.published
  and u.id::text like '85000000-%';
insert into public.public_profiles (user_id, username)
select id, 'badge' || right(id::text, 2)
from public.users where id::text like '85000000-%';

insert into public.communities (id, name, created_by, owner_id)
values
  ('86000000-0000-0000-0000-000000000001', 'Comunidade A',
   '85000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000002', 'Comunidade B',
   '85000000-0000-0000-0000-000000000004', '85000000-0000-0000-0000-000000000004');
insert into public.community_members (community_id, user_id)
values
  ('86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001'),
  ('86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000002'),
  ('86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000003'),
  ('86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000004'),
  ('86000000-0000-0000-0000-000000000002', '85000000-0000-0000-0000-000000000004');

insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('87000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001',
   '85000000-0000-0000-0000-000000000001', 'text', 'Post na comunidade A', now() + interval '2 days');

update private.comment_rate_limits
set min_interval = interval '0 seconds', burst_limit = 0
where singleton;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( '85000000-0000-0000-0000-0000000000' || p, true)$$;

-- Comentário raiz do DONO da comunidade A.
select pg_temp.as_user('01');
create temp table owner_comment as
select public.comment_create(
  '87000000-0000-0000-0000-000000000001', null, 'Comentário do dono', '88000000-0000-0000-0000-000000000001'
) as row;

-- Resposta do SUPERADMIN (não é dono desta comunidade).
select pg_temp.as_user('02');
create temp table superadmin_reply as
select public.comment_create(
  '87000000-0000-0000-0000-000000000001', (select (row).id from owner_comment),
  'Resposta do superadmin', '88000000-0000-0000-0000-000000000002'
) as row;

-- Resposta aninhada de um MEMBRO COMUM.
select pg_temp.as_user('03');
create temp table member_reply as
select public.comment_create(
  '87000000-0000-0000-0000-000000000001', (select (row).id from superadmin_reply),
  'Resposta aninhada de membro comum', '88000000-0000-0000-0000-000000000003'
) as row;

-- Comentário do DONO DA COMUNIDADE B comentando na comunidade A (não deve herdar selo de admin).
select pg_temp.as_user('04');
create temp table other_owner_comment as
select public.comment_create(
  '87000000-0000-0000-0000-000000000001', null,
  'Comentário do dono de outra comunidade', '88000000-0000-0000-0000-000000000004'
) as row;

grant select on owner_comment, superadmin_reply, member_reply, other_owner_comment to authenticated;
set local role authenticated;
select pg_temp.as_user('03');

-- 1) Superadmin em publicação (campo já existente, sem regressão).
select is(
  (select author_is_superadmin from public.statuses where id = '87000000-0000-0000-0000-000000000001'),
  false,
  'post do dono (não superadmin) continua sem o selo de superadmin'
);

-- 2) Administrador da comunidade em comentário raiz.
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from owner_comment)),
  true,
  'comentário raiz do dono da comunidade recebe selo de administrador'
);
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from owner_comment)),
  false,
  'dono não é superadmin: sem selo de superadmin'
);

-- 3) Superadmin em resposta aninhada.
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from superadmin_reply)),
  true,
  'resposta do superadmin recebe o selo de superadmin'
);
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from superadmin_reply)),
  false,
  'superadmin que não é dono desta comunidade não recebe selo de administrador'
);

-- 4) Resposta profundamente aninhada de usuário comum: nenhum selo.
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from member_reply)),
  false,
  'membro comum nunca recebe o selo de superadmin'
);
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from member_reply)),
  false,
  'membro comum nunca recebe o selo de administrador'
);

-- 5) Administrador de OUTRA comunidade comentando aqui: nenhum selo (nunca herda).
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from other_owner_comment)),
  false,
  'dono de outra comunidade não recebe selo de superadmin aqui'
);
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from other_owner_comment)),
  false,
  'dono de uma comunidade não recebe selo de administrador em outra comunidade'
);

-- 6) comment_context (tela de conversa / deep link) carrega os mesmos dois campos.
select is(
  (public.comment_context((select (row).id from member_reply))
    -> 'comments' -> 0 ->> 'authorIsCommunityAdmin')::boolean,
  true,
  'comment_context: item 0 do caminho (comentário do dono) tem authorIsCommunityAdmin'
);
select is(
  (public.comment_context((select (row).id from member_reply))
    -> 'comments' -> 1 ->> 'authorIsSuperAdmin')::boolean,
  true,
  'comment_context: item 1 do caminho (resposta do superadmin) tem authorIsSuperAdmin'
);
select is(
  (public.comment_context((select (row).id from member_reply))
    -> 'comments' -> 2 ->> 'authorIsCommunityAdmin')::boolean,
  false,
  'comment_context: alvo (membro comum) não tem nenhum selo'
);

-- 7) Mudança de proprietário da comunidade: o selo de admin segue o dono ATUAL, nunca fica
-- "preso" em quem publicou o comentário. Troca de dono é um evento independente do papel de
-- superadmin (nunca toca public.users.role), então o selo de superadmin não deveria mudar só
-- por isso -- mas (ver item 7b) ele NÃO é histórico: muda se o PAPEL em si mudar.
reset role;
update public.communities set owner_id = '85000000-0000-0000-0000-000000000003'
where id = '86000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.as_user('03');
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from owner_comment)),
  false,
  'ex-dono perde o selo de administrador imediatamente após a troca de posse'
);
select is(
  (select author_is_community_admin from public.comment_list_items
   where id = (select (row).id from member_reply)),
  true,
  'novo dono da comunidade ganha o selo de administrador nos comentários que já tinha feito'
);
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from superadmin_reply)),
  true,
  'troca de posse da comunidade (evento independente) não altera o selo de superadmin'
);

-- 7b) Selo de Superadmin em comentário é AO VIVO, de propósito -- diferente do selo do POST
-- (statuses.author_is_superadmin, histórico desde sempre). Comentários nunca tiveram nenhum
-- registro de papel histórico antes desta migration: não há dado confiável para reconstruir
-- "era superadmin quando comentou" para o que já existia, e fabricar isso a partir do papel
-- ATUAL confundiria papel atual com histórico. Resolver ao vivo corrige o selo em QUALQUER
-- comentário (antigo ou novo) sem nenhuma migração/backfill de dados, e nunca mantém o selo
-- depois de alguém perder o cargo.
reset role;
update public.users set role = 'user' where id = '85000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.as_user('03');
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from superadmin_reply)),
  false,
  'demover o superadmin remove o selo do comentário já existente, na hora, sem backfill'
);
reset role;
update public.users set role = 'superadmin' where id = '85000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.as_user('03');
select is(
  (select author_is_superadmin from public.comment_list_items
   where id = (select (row).id from superadmin_reply)),
  true,
  'repromover devolve o selo ao mesmo comentário pré-existente, sem nenhuma migração de dados'
);

-- 8) Sem consulta por linha: comment_list_items é 1 view (join único), nunca 1 chamada por
-- comentário -- aqui a prova é estrutural (as duas colunas vêm da MESMA linha da view, sem
-- nenhuma função adicional chamada pelo cliente por comentário).
select ok(
  (select count(*) from public.comment_list_items
   where status_id = '87000000-0000-0000-0000-000000000001') = 4,
  'a mesma consulta de listagem já traz os dois selos para todos os comentários do post'
);

-- 9) RLS: anon não acessa a view (e portanto nenhum selo nem outro dado privado).
reset role;
set local role anon;
select throws_ok(
  $$select count(*) from public.comment_list_items$$,
  '42501',
  'permission denied for table post_comments',
  'anon não acessa comment_list_items (nem os selos)'
);
reset role;

select * from finish();
rollback;
