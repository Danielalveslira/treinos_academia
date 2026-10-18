begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('81000000-0000-0000-0000-0000000000' || n)::uuid,
       'authenticated', 'authenticated', 'comment-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04']) as n;

update public.users set role = 'superadmin'
where id = '81000000-0000-0000-0000-000000000004';
update public.users u
set legal_acceptance_version = p.version,
    legal_acceptance_digest = p.digest,
    legal_acceptance_accepted_at = now()
from public.legal_policy p
where p.id and p.published
  and u.id::text like '81000000-%';
insert into public.public_profiles (user_id, username)
select id, 'commenter' || right(id::text, 2)
from public.users where id::text like '81000000-%';
-- Autor '02' tem avatar; '01' não -- cobre os dois casos na asserção de comment_context abaixo
-- (campo presente vs. ausente, nunca uma URL inventada no lugar de um avatar_path nulo).
update public.public_profiles set avatar_path = 'avatars/commenter02.webp'
where user_id = '81000000-0000-0000-0000-000000000002';

insert into public.communities (id, name, created_by, owner_id)
values (
  '82000000-0000-0000-0000-000000000001',
  'Comentários',
  '81000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001'
);
insert into public.community_members (community_id, user_id)
values
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000001', '81000000-0000-0000-0000-000000000002');

insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values
  ('83000000-0000-0000-0000-000000000001', '82000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001', 'text', 'Post A', now() + interval '2 days'),
  ('83000000-0000-0000-0000-000000000002', '82000000-0000-0000-0000-000000000001',
   '81000000-0000-0000-0000-000000000001', 'text', 'Post B', now() + interval '2 days');

update private.comment_rate_limits
set min_interval = interval '0 seconds', burst_limit = 0
where singleton;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', '81000000-0000-0000-0000-0000000000' || p, true)$$;

select pg_temp.as_user('02');
create temp table root_comment as
select public.comment_create(
  '83000000-0000-0000-0000-000000000001', null, 'Comentário raiz',
  '84000000-0000-0000-0000-000000000001'
) as row;

select is((select (row).body from root_comment), 'Comentário raiz', 'cria comentário raiz');
select is((select (row).depth from root_comment), 0::smallint, 'raiz tem depth zero');
select is((select comment_count from public.statuses where id = '83000000-0000-0000-0000-000000000001'), 1, 'contador do post incrementa');
select is((select count(*)::int from public.notifications where recipient_id = '81000000-0000-0000-0000-000000000001'), 1, 'resposta ao post cria notificação');

select is(
  (public.comment_create(
    '83000000-0000-0000-0000-000000000001', null, 'corpo de retry ignorado',
    '84000000-0000-0000-0000-000000000001'
  )).id,
  (select (row).id from root_comment),
  'retry com o mesmo request id retorna a mesma linha'
);
select is((select comment_count from public.statuses where id = '83000000-0000-0000-0000-000000000001'), 1, 'retry não duplica contador');

select pg_temp.as_user('01');
create temp table reply_comment as
select public.comment_create(
  '83000000-0000-0000-0000-000000000001',
  (select (row).id from root_comment),
  'Resposta direta',
  '84000000-0000-0000-0000-000000000002'
) as row;
select is((select (row).depth from reply_comment), 1::smallint, 'resposta incrementa depth');
select is((select cardinality((row).ancestor_ids) from reply_comment), 1, 'resposta guarda caminho de ancestrais');
select is((select (row).root_comment_id from reply_comment), (select (row).id from root_comment), 'resposta preserva root');
select is((select reply_count from public.post_comments where id = (select (row).id from root_comment)), 1, 'contador do pai incrementa');
select is((select comment_count from public.statuses where id = '83000000-0000-0000-0000-000000000001'), 2, 'contador do post inclui resposta');
select is((select count(*)::int from public.notifications where recipient_id = '81000000-0000-0000-0000-000000000002'), 1, 'resposta ao comentário notifica o pai');

select pg_temp.as_user('02');
select is(
  public.notifications_mark_read(
    array[(select id from public.notifications where recipient_id = '81000000-0000-0000-0000-000000000002')],
    null
  ),
  1,
  'destinatário marca a própria notificação como lida'
);
select ok(
  (select read_at is not null from public.notifications where recipient_id = '81000000-0000-0000-0000-000000000002'),
  'notificação persiste read_at'
);

select throws_ok(
  format(
    'select public.comment_create(%L, %L, %L, %L)',
    '83000000-0000-0000-0000-000000000002',
    (select (row).id from root_comment),
    'Pai de outro post',
    '84000000-0000-0000-0000-000000000003'
  ),
  'INVALID_PARENT',
  'pai de outro post é rejeitado'
);

select pg_temp.as_user('02');
select is((public.comment_set_like((select (row).id from reply_comment), true) ->> 'likeCount')::int, 1, 'like incrementa uma vez');
select is((public.comment_set_like((select (row).id from reply_comment), true) ->> 'likeCount')::int, 1, 'retry de like é idempotente');
select is((public.comment_set_like((select (row).id from reply_comment), false) ->> 'likeCount')::int, 0, 'unlike decrementa');
select is((public.comment_set_like((select (row).id from reply_comment), false) ->> 'likeCount')::int, 0, 'retry de unlike não deixa contador negativo');

select public.comment_delete((select (row).id from root_comment));
select is((select status::text from public.post_comments where id = (select (row).id from root_comment)), 'deleted_by_author', 'autor faz soft delete');
select is((select body from public.post_comments where id = (select (row).id from root_comment)), null, 'soft delete remove o corpo');
select is((select count(*)::int from public.post_comments where parent_comment_id = (select (row).id from root_comment)), 1, 'filho permanece após exclusão do pai');

grant select on root_comment, reply_comment to authenticated;
set local role authenticated;
select pg_temp.as_user('02');
select is(
  jsonb_array_length(public.comment_context((select (row).id from reply_comment)) -> 'comments'),
  2,
  'deep link retorna alvo e ancestral excluído'
);
-- Regressão: comment_context já juntava public_profiles para o username, mas nunca
-- selecionava avatar_path -- a tela de conversa (CommentContextPage) ficava sem a foto de
-- todos os autores do fio, mesmo quando o perfil tinha avatar_path preenchido.
select is(
  public.comment_context((select (row).id from reply_comment)) -> 'comments' -> 0 ->> 'authorAvatarPath',
  'avatars/commenter02.webp',
  'comment_context inclui o avatar do autor quando o perfil tem um'
);
select is(
  public.comment_context((select (row).id from reply_comment)) -> 'comments' -> 1 ->> 'authorAvatarPath',
  null,
  'autor sem avatar mantém authorAvatarPath nulo, nunca uma URL inventada'
);
reset role;

set local role anon;
select throws_ok(
  $$select count(*) from public.post_comments$$,
  '42501',
  'permission denied for table post_comments',
  'anon nao acessa comentarios'
);
select throws_ok(
  $$select count(*) from public.comment_list_items$$,
  '42501',
  'permission denied for table post_comments',
  'anon nao acessa a view de comentarios'
);
reset role;

set local role authenticated;
select pg_temp.as_user('02');
select is(
  (select count(*)::int from public.comment_list_items where status_id = '83000000-0000-0000-0000-000000000001'),
  2,
  'comment_list_items expoe somente a publicacao solicitada'
);
select is(
  (select count(*)::int from public.comment_list_items where status_id = '83000000-0000-0000-0000-000000000002'),
  0,
  'comentario de uma publicacao nao aparece em outra'
);
select is(
  (select count(*)::int from public.notifications where recipient_id = '81000000-0000-0000-0000-000000000002'),
  1,
  'destinatario autenticado acessa somente suas notificacoes'
);
reset role;

insert into public.statuses (
  id, community_id, author_id, type, expires_at,
  workout_title, workout_date, workout_location
) values (
  '83000000-0000-0000-0000-000000000003',
  '82000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'workout', now() - interval '1 hour',
  'Treino futuro', now() + interval '1 day', 'Academia'
);
insert into public.statuses (
  id, community_id, author_id, type, expires_at,
  achievement_day, achievement_text, achievement_entries, achievement_sets
) values (
  '83000000-0000-0000-0000-000000000004',
  '82000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'achievement', now() + interval '1 day',
  current_date::text, 'Conquista', 1, 1
);
insert into public.statuses (
  id, community_id, author_id, type, expires_at, poll_question, poll_options
) values (
  '83000000-0000-0000-0000-000000000005',
  '82000000-0000-0000-0000-000000000001',
  '81000000-0000-0000-0000-000000000001',
  'poll', now() + interval '1 day', 'Pergunta?',
  '[{"id":"1","label":"A"},{"id":"2","label":"B"}]'::jsonb
);

select pg_temp.as_user('02');
select lives_ok(
  $$select public.comment_create('83000000-0000-0000-0000-000000000003', null, 'Comentario no treino', '84000000-0000-0000-0000-000000000005')$$,
  'treino marcado futuro aceita comentario depois do expires_at do feed comum'
);
select lives_ok(
  $$select public.comment_create('83000000-0000-0000-0000-000000000004', null, 'Comentario na conquista', '84000000-0000-0000-0000-000000000006')$$,
  'conquista aceita comentario'
);
select lives_ok(
  $$select public.comment_create('83000000-0000-0000-0000-000000000005', null, 'Comentario na enquete', '84000000-0000-0000-0000-000000000007')$$,
  'outro tipo de publicacao aceita comentario'
);

select pg_temp.as_user('02');
create temp table comment_report as
select public.comment_report(
  (select (row).id from reply_comment),
  'Conteúdo impróprio',
  'Contexto suficiente para análise.'
) as request_id;
select pg_temp.as_user('04');
select lives_ok(
  format(
    'select public.decide_support_request(%L::jsonb)',
    jsonb_build_object(
      'requestId', (select request_id from comment_report),
      'action', 'remove_content',
      'reason', 'Conteúdo removido após análise.',
      'rule', 'Regra de convivência da comunidade.',
      'evidence', 'Snapshot e contexto do comentário revisados.',
      'targetUserId', '',
      'communityId', '82000000-0000-0000-0000-000000000001',
      'days', 7
    )::text
  ),
  'moderação remove somente o comentário denunciado'
);
select is((select status::text from public.post_comments where id = (select (row).id from reply_comment)), 'removed_by_moderation', 'moderação aplica soft delete');
select is((select count(*)::int from public.statuses where id = '83000000-0000-0000-0000-000000000001'), 1, 'moderar comentário não exclui a publicação');

select pg_temp.as_user('03');
select throws_ok(
  $$select public.comment_create('83000000-0000-0000-0000-000000000001', null, 'Sem acesso', '84000000-0000-0000-0000-000000000004')$$,
  'PERMISSION_DENIED',
  'não membro não cria comentário'
);

set local role authenticated;
select pg_temp.as_user('03');
select is((select count(*)::int from public.post_comments), 0, 'RLS esconde comentários de não membro');
select pg_temp.as_user('02');
select is((select count(*)::int from public.post_comments), 5, 'RLS libera a árvore para membro');
reset role;

-- Existing account deletion semantics: an author can disappear without deleting the thread.
delete from public.public_profiles where user_id = '81000000-0000-0000-0000-000000000002';
delete from public.community_members where user_id = '81000000-0000-0000-0000-000000000002';
update public.support_requests set user_id = null where user_id = '81000000-0000-0000-0000-000000000002';
delete from public.users where id = '81000000-0000-0000-0000-000000000002';
select is((select author_id from public.post_comments where id = (select (row).id from root_comment)), null, 'conta excluída anonimiza o autor');
select is((select count(*)::int from public.post_comments where id = (select (row).id from root_comment)), 1, 'conta excluída preserva o nó');

select ok(not has_function_privilege('anon', 'public.comment_create(uuid, uuid, text, uuid)', 'execute'), 'anon não executa comment_create');
select ok(not has_function_privilege('authenticated', 'private.comment_create(uuid, uuid, text, uuid)', 'execute'), 'implementação privada não é chamável pelo cliente');

select * from finish();
rollback;
