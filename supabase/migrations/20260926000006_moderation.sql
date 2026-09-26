-- Support requests, moderation decisions, and the restrictions they enforce.
-- support_requests <-> moderation_decisions has a circular FK, so moderation_decisions
-- is created after support_requests and the decision_id FKs are added afterwards.

create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  kind text not null check (kind in ('report', 'appeal', 'privacy')),
  message text not null check (char_length(trim(message)) between 10 and 3000),
  status_id uuid references public.statuses(id),
  community_id uuid references public.communities(id),
  decision_id uuid,
  content_snapshot jsonb,
  state text not null default 'open' check (state in ('open', 'closed')),
  created_at timestamptz not null default now(),
  response text,
  decided_at timestamptz
);
create index support_requests_user_created_idx on public.support_requests(user_id, created_at desc);
create index support_requests_state_created_idx on public.support_requests(state, created_at desc);

create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id),
  admin_id uuid not null references public.users(id),
  target_user_id uuid references public.users(id),
  action text not null check (action in ('no_action', 'warning', 'remove_content', 'temporary_suspension', 'community_ban', 'system_ban', 'restore')),
  community_id uuid references public.communities(id),
  rule text not null check (char_length(trim(rule)) between 5 and 3000),
  reason text not null check (char_length(trim(reason)) between 5 and 3000),
  evidence text not null check (char_length(trim(evidence)) between 5 and 3000),
  until timestamptz,
  created_at timestamptz not null default now()
);

alter table public.support_requests
  add constraint support_requests_decision_fk foreign key (decision_id) references public.moderation_decisions(id);

create table public.community_restrictions (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  decision_id uuid references public.moderation_decisions(id),
  created_at timestamptz not null default now(),
  primary key (community_id, user_id)
);

create table public.account_restrictions (
  user_id uuid primary key references public.users(id) on delete cascade,
  action text not null check (action in ('temporary_suspension', 'system_ban')),
  until timestamptz,
  decision_id uuid references public.moderation_decisions(id)
);
