-- Private implementations and narrow public wrappers for comment mutations.

create or replace function private.can_view_status(p_status_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_uid is not null
    and p_uid = (select auth.uid())
    and exists (
      select 1
      from public.statuses s
      where s.id = p_status_id
        and (
          coalesce(public.is_superadmin(), false)
          or coalesce(public.is_community_member(s.community_id), false)
        )
    ),
    false
  )
$$;

create or replace function private.can_moderate_status(p_status_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_uid is not null
    and p_uid = (select auth.uid())
    and exists (
      select 1
      from public.statuses s
      join public.communities c on c.id = s.community_id
      where s.id = p_status_id
        and (coalesce(public.is_superadmin(), false) or c.owner_id = p_uid)
    ),
    false
  )
$$;

create or replace function private.comments_open(p_status public.statuses)
returns boolean
language sql stable set search_path = '' as $$
  select coalesce(p_status.comments_close_at > now(), false)
$$;

create or replace function private.comment_create(
  p_status_id uuid,
  p_parent_comment_id uuid,
  p_body text,
  p_client_request_id uuid
) returns public.post_comments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_status public.statuses;
  v_parent public.post_comments;
  v_existing public.post_comments;
  v_comment public.post_comments;
  v_id uuid := gen_random_uuid();
  v_limits private.comment_rate_limits;
  v_recipient uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_status_id is null or p_client_request_id is null then raise exception 'INVALID_ARGUMENT'; end if;
  if char_length(v_body) not between 1 and 8000 then raise exception 'INVALID_BODY'; end if;

  select * into v_existing
  from public.post_comments
  where author_id = v_uid and client_request_id = p_client_request_id;
  if found then return v_existing; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 17931));

  -- Recheck after the per-user lock so concurrent retries return the winner.
  select * into v_existing
  from public.post_comments
  where author_id = v_uid and client_request_id = p_client_request_id;
  if found then return v_existing; end if;

  select * into v_status from public.statuses where id = p_status_id for share;
  if not found then raise exception 'STATUS_NOT_FOUND'; end if;
  if not private.can_view_status(p_status_id, v_uid) then raise exception 'PERMISSION_DENIED'; end if;
  if not private.comments_open(v_status) then raise exception 'COMMENTS_CLOSED'; end if;

  select * into v_limits from private.comment_rate_limits where singleton;
  if v_limits.min_interval > interval '0 seconds' and exists (
    select 1 from public.post_comments
    where author_id = v_uid and created_at > now() - v_limits.min_interval
  ) then
    raise exception 'RATE_LIMITED';
  end if;
  if v_limits.burst_limit > 0 and (
    select count(*) from (
      select 1 from public.post_comments
      where author_id = v_uid and created_at > now() - v_limits.burst_window
      order by created_at desc limit v_limits.burst_limit
    ) recent
  ) >= v_limits.burst_limit then
    raise exception 'RATE_LIMITED';
  end if;

  if p_parent_comment_id is not null then
    select * into v_parent
    from public.post_comments
    where id = p_parent_comment_id
    for share;
    if not found then raise exception 'PARENT_NOT_FOUND'; end if;
    if v_parent.status_id <> p_status_id then raise exception 'INVALID_PARENT'; end if;
    if v_parent.status <> 'active' then raise exception 'PARENT_UNAVAILABLE'; end if;
    if v_parent.depth >= 32 then raise exception 'MAX_DEPTH_REACHED'; end if;
  end if;

  insert into public.post_comments (
    id, status_id, author_id, parent_comment_id, root_comment_id,
    ancestor_ids, depth, body, client_request_id
  ) values (
    v_id,
    p_status_id,
    v_uid,
    p_parent_comment_id,
    case when p_parent_comment_id is null then v_id else v_parent.root_comment_id end,
    case when p_parent_comment_id is null then '{}'::uuid[] else v_parent.ancestor_ids || v_parent.id end,
    case when p_parent_comment_id is null then 0 else v_parent.depth + 1 end,
    v_body,
    p_client_request_id
  ) returning * into v_comment;

  if p_parent_comment_id is not null then
    update public.post_comments
    set reply_count = reply_count + 1,
        score = (like_count * 2) + reply_count + 1
    where id = p_parent_comment_id;
    v_recipient := v_parent.author_id;
  else
    v_recipient := v_status.author_id;
  end if;

  update public.statuses set comment_count = comment_count + 1 where id = p_status_id;

  if v_recipient is not null and v_recipient <> v_uid then
    insert into public.notifications (
      recipient_id, actor_id, type, status_id, comment_id, dedupe_key
    ) values (
      v_recipient,
      v_uid,
      case when p_parent_comment_id is null then 'post_reply'::public.notification_type
           else 'comment_reply'::public.notification_type end,
      p_status_id,
      v_comment.id,
      'comment-created:' || v_comment.id::text
    ) on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  end if;

  return v_comment;
end;
$$;

create or replace function public.comment_create(
  p_status_id uuid,
  p_parent_comment_id uuid,
  p_body text,
  p_client_request_id uuid
) returns public.post_comments
language sql volatile security definer set search_path = '' as $$
  select private.comment_create(p_status_id, p_parent_comment_id, p_body, p_client_request_id)
$$;

create or replace function private.comment_edit(
  p_comment_id uuid,
  p_body text,
  p_expected_updated_at timestamptz
) returns public.post_comments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_body text := btrim(coalesce(p_body, ''));
  v_comment public.post_comments;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if char_length(v_body) not between 1 and 8000 then raise exception 'INVALID_BODY'; end if;

  select * into v_comment from public.post_comments where id = p_comment_id for update;
  if not found or v_comment.status <> 'active' then raise exception 'COMMENT_NOT_FOUND'; end if;
  if v_comment.author_id is distinct from v_uid then raise exception 'PERMISSION_DENIED'; end if;
  if not private.can_view_status(v_comment.status_id, v_uid) then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1 from public.statuses s
    where s.id = v_comment.status_id and private.comments_open(s)
  ) then raise exception 'COMMENTS_CLOSED'; end if;
  if v_comment.updated_at is distinct from p_expected_updated_at then raise exception 'EDIT_CONFLICT'; end if;

  update public.post_comments
  set body = v_body, edited_at = now(), updated_at = now()
  where id = p_comment_id
  returning * into v_comment;
  return v_comment;
end;
$$;

create or replace function public.comment_edit(
  p_comment_id uuid,
  p_body text,
  p_expected_updated_at timestamptz
) returns public.post_comments
language sql volatile security definer set search_path = '' as $$
  select private.comment_edit(p_comment_id, p_body, p_expected_updated_at)
$$;

create or replace function private.comment_delete(p_comment_id uuid)
returns public.post_comments
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment public.post_comments;
  v_moderator boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_comment from public.post_comments where id = p_comment_id for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  v_moderator := private.can_moderate_status(v_comment.status_id, v_uid);
  if v_comment.author_id is distinct from v_uid and not v_moderator then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_comment.status <> 'active' then return v_comment; end if;

  update public.post_comments
  set body = null,
      status = case when v_moderator and v_comment.author_id is distinct from v_uid
                    then 'removed_by_moderation'::public.comment_status
                    else 'deleted_by_author'::public.comment_status end,
      deleted_at = now(),
      updated_at = now()
  where id = p_comment_id
  returning * into v_comment;
  return v_comment;
end;
$$;

create or replace function public.comment_delete(p_comment_id uuid)
returns public.post_comments
language sql volatile security definer set search_path = '' as $$
  select private.comment_delete(p_comment_id)
$$;

create or replace function private.comment_set_like(p_comment_id uuid, p_liked boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment public.post_comments;
  v_changed boolean := false;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_liked is null then raise exception 'INVALID_ARGUMENT'; end if;
  select * into v_comment from public.post_comments where id = p_comment_id for update;
  if not found or v_comment.status <> 'active' then raise exception 'COMMENT_NOT_FOUND'; end if;
  if not private.can_view_status(v_comment.status_id, v_uid) then raise exception 'PERMISSION_DENIED'; end if;
  if not exists (
    select 1 from public.statuses s
    where s.id = v_comment.status_id and private.comments_open(s)
  ) then raise exception 'COMMENTS_CLOSED'; end if;

  if p_liked then
    insert into public.comment_likes (comment_id, user_id)
    values (p_comment_id, v_uid)
    on conflict do nothing;
    v_changed := found;
    if v_changed then
      update public.post_comments
      set like_count = like_count + 1,
          score = ((like_count + 1) * 2) + reply_count
      where id = p_comment_id
      returning * into v_comment;
      if v_comment.author_id is not null and v_comment.author_id <> v_uid then
        insert into public.notifications (
          recipient_id, actor_id, type, status_id, comment_id, dedupe_key
        ) values (
          v_comment.author_id, v_uid, 'comment_like', v_comment.status_id, v_comment.id,
          'comment-like:' || v_comment.id::text || ':' || v_uid::text
        ) on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  else
    delete from public.comment_likes where comment_id = p_comment_id and user_id = v_uid;
    v_changed := found;
    if v_changed then
      update public.post_comments
      set like_count = greatest(like_count - 1, 0),
          score = (greatest(like_count - 1, 0) * 2) + reply_count
      where id = p_comment_id
      returning * into v_comment;
      delete from public.notifications
      where recipient_id = v_comment.author_id
        and dedupe_key = 'comment-like:' || v_comment.id::text || ':' || v_uid::text;
    end if;
  end if;

  return jsonb_build_object(
    'commentId', v_comment.id,
    'liked', p_liked,
    'likeCount', v_comment.like_count,
    'changed', v_changed
  );
end;
$$;

create or replace function public.comment_set_like(p_comment_id uuid, p_liked boolean)
returns jsonb
language sql volatile security definer set search_path = '' as $$
  select private.comment_set_like(p_comment_id, p_liked)
$$;

create or replace function private.comment_report(
  p_comment_id uuid,
  p_reason text,
  p_details text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment public.post_comments;
  v_status public.statuses;
  v_existing uuid;
  v_request_id uuid;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_details text := nullif(btrim(coalesce(p_details, '')), '');
  v_message text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  v_message := 'Comentário: ' || v_reason
    || case when v_details is null then '' else E'\n' || v_details end;
  if char_length(v_reason) not between 3 and 120 or char_length(v_message) > 3000 then
    raise exception 'INVALID_REPORT';
  end if;
  select * into v_comment from public.post_comments where id = p_comment_id;
  if not found or v_comment.status <> 'active' then raise exception 'COMMENT_NOT_FOUND'; end if;
  if not private.can_view_status(v_comment.status_id, v_uid) then raise exception 'PERMISSION_DENIED'; end if;
  if v_comment.author_id = v_uid then raise exception 'SELF_REPORT'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_uid::text || ':' || p_comment_id::text, 29417)
  );
  select id into v_existing from public.support_requests
  where user_id = v_uid and comment_id = p_comment_id and kind = 'report' and state = 'open';
  if found then return v_existing; end if;

  select * into v_status from public.statuses where id = v_comment.status_id;
  insert into public.support_requests (
    user_id, kind, message, status_id, community_id, comment_id, content_snapshot
  ) values (
    v_uid,
    'report',
    v_message,
    v_comment.status_id,
    v_status.community_id,
    v_comment.id,
    jsonb_build_object(
      'commentId', v_comment.id,
      'authorId', v_comment.author_id,
      'body', v_comment.body,
      'status', v_comment.status,
      'createdAt', v_comment.created_at
    )
  ) returning id into v_request_id;
  return v_request_id;
end;
$$;

create or replace function public.comment_report(
  p_comment_id uuid,
  p_reason text,
  p_details text default null
) returns uuid
language sql volatile security definer set search_path = '' as $$
  select private.comment_report(p_comment_id, p_reason, p_details)
$$;

create or replace function public.notifications_mark_read(
  p_ids bigint[] default null,
  p_before timestamptz default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_ids is null and p_before is null then raise exception 'INVALID_ARGUMENT'; end if;
  update public.notifications
  set read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and read_at is null
    and (p_ids is null or id = any(p_ids))
    and (p_before is null or created_at <= p_before);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Remove PostgreSQL's default PUBLIC execution grant before this migration commits.
revoke all on all functions in schema private from public, anon, authenticated;
revoke execute on function public.comment_create(uuid, uuid, text, uuid) from public, anon;
revoke execute on function public.comment_edit(uuid, text, timestamptz) from public, anon;
revoke execute on function public.comment_delete(uuid) from public, anon;
revoke execute on function public.comment_set_like(uuid, boolean) from public, anon;
revoke execute on function public.comment_report(uuid, text, text) from public, anon;
revoke execute on function public.notifications_mark_read(bigint[], timestamptz) from public, anon;
grant execute on function public.comment_create(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.comment_edit(uuid, text, timestamptz) to authenticated;
grant execute on function public.comment_delete(uuid) to authenticated;
grant execute on function public.comment_set_like(uuid, boolean) to authenticated;
grant execute on function public.comment_report(uuid, text, text) to authenticated;
grant execute on function public.notifications_mark_read(bigint[], timestamptz) to authenticated;
