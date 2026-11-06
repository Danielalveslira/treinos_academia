-- Selo de autoridade (Superadmin / Admin da comunidade) nos comentários e respostas: hoje só
-- aparece no post (author_is_superadmin em statuses, ver 20260926000018_status_author_badge.sql).
-- Nunca confia no que o cliente manda; resolvido na MESMA query que já lista/pagina os
-- comentários (join, não 1 consulta por comentário).
--
-- Superadmin: histórico (mesma semântica de statuses.author_is_superadmin -- grafado no momento
-- da publicação do comentário, nunca recalculado depois, para não reabrir a regressão descrita
-- naquela migration). Admin de comunidade: ao vivo (dono ATUAL da comunidade) -- perder a posse
-- não pode deixar o selo "preso" num comentário antigo, e um dono de outra comunidade nunca pode
-- herdar o selo aqui.

alter table public.post_comments
  add column if not exists author_is_superadmin boolean not null default false;

create or replace function private.enforce_comment_author_badge() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.author_is_superadmin := public.is_superadmin();
  return new;
end;
$$;

drop trigger if exists post_comments_enforce_author_badge on public.post_comments;
create trigger post_comments_enforce_author_badge
  before insert on public.post_comments
  for each row execute function private.enforce_comment_author_badge();

-- security_invoker=true (já era assim): o join novo com statuses/communities fica sujeito à
-- MESMA RLS que o viewer já teria para ler esses dois status/comunidade (statuses_select e
-- communities_select) -- quem já pode ler os comentários de um post também pode ler o status e a
-- comunidade dele, então o join nunca nega nem vaza nada que can_view_status já não garantisse.
create or replace view public.comment_list_items
with (security_invoker = true) as
select
  c.id,
  c.status_id,
  c.author_id,
  c.parent_comment_id,
  c.root_comment_id,
  c.ancestor_ids,
  c.depth,
  c.body,
  c.status,
  c.reply_count,
  c.like_count,
  c.score,
  c.created_at,
  c.updated_at,
  c.edited_at,
  p.username as author_username,
  p.avatar_path as author_avatar_path,
  c.author_is_superadmin,
  (cm.owner_id is not null and cm.owner_id = c.author_id) as author_is_community_admin
from public.post_comments c
left join public.public_profiles p on p.user_id = c.author_id
left join public.statuses s on s.id = c.status_id
left join public.communities cm on cm.id = s.community_id;

-- comment_context (tela "Conversa", deep link de notificação/comentário): a comunidade é a MESMA
-- para todo o fio (todo item do caminho pertence ao mesmo status), então o dono é resolvido 1 vez
-- (status_ctx), não por item do caminho.
create or replace function public.comment_context(p_comment_id uuid)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with target as (
    select * from public.post_comments where id = p_comment_id
  ), status_ctx as (
    select st.community_id, cm.owner_id as community_owner_id
    from target t
    join public.statuses st on st.id = t.status_id
    left join public.communities cm on cm.id = st.community_id
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
        'authorIsSuperAdmin', c.author_is_superadmin,
        'authorIsCommunityAdmin', coalesce(
          (select sc.community_owner_id is not null and sc.community_owner_id = c.author_id
           from status_ctx sc),
          false
        ),
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
