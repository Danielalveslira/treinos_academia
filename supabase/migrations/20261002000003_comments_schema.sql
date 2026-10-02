-- Comments/replies for community statuses. A status is the existing Evolutus post entity.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

do $$ begin
  create type public.comment_status as enum (
    'active',
    'deleted_by_author',
    'removed_by_moderation'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type public.notification_type as enum (
    'post_reply',
    'comment_reply',
    'comment_mention',
    'comment_like'
  );
exception when duplicate_object then null;
end $$;

alter table public.statuses
  add column if not exists comment_count integer not null default 0
    check (comment_count >= 0),
  add column if not exists comments_close_at timestamptz generated always as (
    greatest(
      expires_at,
      case when type = 'workout' then workout_date else null end,
      case when promoted then promoted_until else null end
    )
  ) stored;

create table public.post_comments (
  id uuid primary key default gen_random_uuid(),
  status_id uuid not null references public.statuses(id) on delete cascade,
  -- Accounts are physically removed by the existing deletion worker. The node stays
  -- anonymous so replies and moderation context do not break.
  author_id uuid references public.users(id) on delete set null,
  parent_comment_id uuid references public.post_comments(id) on delete cascade,
  root_comment_id uuid not null references public.post_comments(id) on delete cascade,
  ancestor_ids uuid[] not null default '{}',
  depth smallint not null default 0,
  body text,
  status public.comment_status not null default 'active',
  reply_count integer not null default 0 check (reply_count >= 0),
  like_count integer not null default 0 check (like_count >= 0),
  score integer not null default 0,
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  constraint post_comments_body_state_ck check (
    (status = 'active' and body is not null and char_length(btrim(body)) between 1 and 8000)
    or (status <> 'active' and body is null)
  ),
  constraint post_comments_depth_ck check (depth between 0 and 32),
  constraint post_comments_no_self_parent_ck check (
    parent_comment_id is null or parent_comment_id <> id
  )
);

create unique index post_comments_idempotency_idx
  on public.post_comments (author_id, client_request_id)
  where author_id is not null;
create index post_comments_roots_new_idx
  on public.post_comments (status_id, created_at desc, id desc)
  where parent_comment_id is null;
create index post_comments_roots_score_idx
  on public.post_comments (status_id, score desc, created_at desc, id desc)
  where parent_comment_id is null;
create index post_comments_parent_created_idx
  on public.post_comments (parent_comment_id, created_at asc, id asc)
  where parent_comment_id is not null;
create index post_comments_author_created_idx
  on public.post_comments (author_id, created_at desc, id desc)
  where author_id is not null;
create index post_comments_status_created_idx
  on public.post_comments (status_id, created_at desc, id desc);
create index post_comments_root_created_idx
  on public.post_comments (root_comment_id, created_at asc, id asc);

create table public.comment_likes (
  comment_id uuid not null references public.post_comments(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index comment_likes_user_idx
  on public.comment_likes (user_id, created_at desc);

create table public.notifications (
  id bigint generated always as identity primary key,
  recipient_id uuid not null references public.users(id) on delete cascade,
  actor_id uuid references public.users(id) on delete set null,
  type public.notification_type not null,
  status_id uuid not null references public.statuses(id) on delete cascade,
  comment_id uuid references public.post_comments(id) on delete cascade,
  dedupe_key text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index notifications_dedupe_idx
  on public.notifications (recipient_id, dedupe_key)
  where dedupe_key is not null;
create index notifications_recipient_unread_idx
  on public.notifications (recipient_id, created_at desc)
  where read_at is null;
create index notifications_recipient_all_idx
  on public.notifications (recipient_id, created_at desc, id desc);

-- Reuse the existing moderation workflow instead of duplicating comment_reports.
alter table public.support_requests
  add column if not exists comment_id uuid references public.post_comments(id) on delete set null;
create unique index support_requests_open_comment_report_idx
  on public.support_requests (user_id, comment_id)
  where kind = 'report' and state = 'open' and comment_id is not null and user_id is not null;

-- Product-configurable limits. Updating values does not require a structural migration.
create table private.comment_rate_limits (
  singleton boolean primary key default true check (singleton),
  min_interval interval not null check (min_interval >= interval '0 seconds'),
  burst_window interval not null check (burst_window > interval '0 seconds'),
  burst_limit integer not null check (burst_limit >= 0)
);
insert into private.comment_rate_limits (singleton, min_interval, burst_window, burst_limit)
values (true, interval '2 seconds', interval '1 minute', 10)
on conflict (singleton) do nothing;
