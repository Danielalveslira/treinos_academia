-- Read surface, RLS and minimum grants.

alter table public.post_comments enable row level security;
create policy post_comments_select on public.post_comments
  for select to authenticated
  using (private.can_view_status(status_id, (select auth.uid())));

alter table public.comment_likes enable row level security;
create policy comment_likes_select_own on public.comment_likes
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.post_comments c
      where c.id = comment_likes.comment_id
        and private.can_view_status(c.status_id, (select auth.uid()))
    )
  );

alter table public.notifications enable row level security;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

-- security_invoker keeps post_comments RLS active while providing the missing
-- author relationship without one query per card.
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
  p.avatar_path as author_avatar_path
from public.post_comments c
left join public.public_profiles p on p.user_id = c.author_id;

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

revoke all on table public.post_comments, public.comment_likes, public.notifications from anon;
revoke insert, update, delete on table public.post_comments, public.comment_likes, public.notifications
  from authenticated;
grant select on table public.post_comments, public.comment_likes, public.notifications,
  public.comment_list_items to authenticated;

revoke execute on function public.comment_context(uuid) from public, anon;
grant execute on function public.comment_context(uuid) to authenticated;

-- Policies call these helpers internally; the schema is not exposed by PostgREST.
grant usage on schema private to authenticated;
grant execute on function private.can_view_status(uuid, uuid) to authenticated;
