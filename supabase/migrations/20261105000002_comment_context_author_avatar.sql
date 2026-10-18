-- Corrige regressão: comment_context (tela "Conversa" do deep link de comentário/notificação)
-- já faz left join em public_profiles para author_username, mas nunca selecionava avatar_path --
-- diferente de comment_list_items (usada no feed normal), que sempre trouxe author_avatar_path.
-- Resultado: a foto de TODOS os autores do fio sumia nessa tela específica, mesmo com o perfil
-- tendo avatar_path preenchido. Única mudança: adiciona 'authorAvatarPath' ao jsonb_build_object,
-- mesmo join já existente -- nenhuma outra coluna, policy ou comportamento é alterado.
create or replace function public.comment_context(p_comment_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with target as (
    select * from public.post_comments where id = p_comment_id
  ), path_ids as (
    select item.item_id, item.ordinality
    from target t
    cross join lateral unnest(t.ancestor_ids || t.id)
      with ordinality as item(item_id, ordinality)
  ), path as (
    select jsonb_agg(
      jsonb_build_object(
        'id', c.id,
        'statusId', c.status_id,
        'authorId', c.author_id,
        'authorUsername', p.username,
        'authorAvatarPath', p.avatar_path,
        'parentCommentId', c.parent_comment_id,
        'rootCommentId', c.root_comment_id,
        'ancestorIds', c.ancestor_ids,
        'depth', c.depth,
        'body', c.body,
        'status', c.status,
        'replyCount', c.reply_count,
        'likeCount', c.like_count,
        'score', c.score,
        'createdAt', c.created_at,
        'updatedAt', c.updated_at,
        'editedAt', c.edited_at
      ) order by i.ordinality
    ) as comments
    from path_ids i
    join public.post_comments c on c.id = i.item_id
    left join public.public_profiles p on p.user_id = c.author_id
  )
  select case when t.id is null then null else jsonb_build_object(
    'statusId', t.status_id,
    'communityId', s.community_id,
    'targetCommentId', t.id,
    'comments', coalesce(path.comments, '[]'::jsonb)
  ) end
  from (select 1) seed
  left join target t on true
  left join public.statuses s on s.id = t.status_id
  left join path on true
$$;

revoke execute on function public.comment_context(uuid) from public, anon;
grant execute on function public.comment_context(uuid) to authenticated;
