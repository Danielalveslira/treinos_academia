-- Community "statuses" (ephemeral posts, ~24h TTL) and their sub-resources

create table public.statuses (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete cascade,
  author_id uuid not null references public.users(id),
  author_username text,
  author_is_superadmin boolean not null default false,
  type text not null check (type in ('text', 'poll', 'workout', 'achievement', 'photo')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  text text check (char_length(text) between 1 and 500),
  poll_question text,
  poll_options jsonb,
  workout_title text,
  workout_date timestamptz,
  workout_location text,
  achievement_day text,
  achievement_text text,
  achievement_entries integer,
  achievement_sets numeric,
  photo_path text,
  photo_caption text check (char_length(photo_caption) <= 280),
  constraint statuses_content_shape check (
    (type = 'text' and text is not null and poll_question is null and workout_title is null and achievement_day is null and photo_path is null)
    or (type = 'poll' and poll_question is not null and jsonb_array_length(poll_options) between 2 and 6)
    or (type = 'workout' and workout_title is not null and workout_date is not null and workout_location is not null)
    or (type = 'achievement' and achievement_day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and (coalesce(achievement_entries, 0) > 0 or char_length(coalesce(achievement_text, '')) > 0))
    or (type = 'photo' and photo_path = 'statusPhotos/' || community_id::text || '/' || id::text || '.webp')
  )
);
create index statuses_type_expires_idx on public.statuses(type, expires_at);
create index statuses_community_expires_idx on public.statuses(community_id, expires_at desc);

create table public.status_votes (
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  option_id text not null,
  created_at timestamptz not null default now(),
  primary key (status_id, user_id)
);
create index status_votes_user_idx on public.status_votes(user_id);

create table public.status_participants (
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (status_id, user_id)
);
create index status_participants_user_idx on public.status_participants(user_id);
