-- Communities and membership

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 300),
  image_url text,
  is_active boolean not null default true,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  post_access text not null default 'everyone' check (post_access in ('everyone', 'admins')),
  member_count integer not null default 0 check (member_count >= 0),
  deletion_status text check (deletion_status in ('pending'))
);
create index communities_active_name_idx on public.communities(is_active, name);

create table public.community_members (
  community_id uuid not null references public.communities(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (community_id, user_id)
);
create index community_members_user_joined_idx on public.community_members(user_id, joined_at desc);

-- Keep communities.member_count denormalized in sync with membership rows.
create or replace function public.bump_member_count() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.communities set member_count = member_count + 1 where id = new.community_id;
  elsif tg_op = 'DELETE' then
    update public.communities set member_count = greatest(member_count - 1, 0) where id = old.community_id;
  end if;
  return null;
end;
$$;

create trigger community_members_bump_count
  after insert or delete on public.community_members
  for each row execute function public.bump_member_count();
