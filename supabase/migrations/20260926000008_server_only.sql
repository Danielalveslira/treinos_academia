-- Tables written exclusively by service_role (Edge Functions/RPCs), never directly by clients.

create table public.deletion_jobs (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('account', 'community', 'status')),
  target_id uuid not null,
  requested_by uuid references public.users(id),
  state text not null default 'pending' check (state in ('pending', 'complete')),
  stage smallint not null default 0,
  lease_token uuid,
  lease_until timestamptz not null default to_timestamp(0),
  last_error text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expire_at timestamptz,
  unique (kind, target_id)
);
create index deletion_jobs_state_updated_idx on public.deletion_jobs(state, updated_at);

create table public.support_limits (
  user_id uuid primary key references public.users(id) on delete cascade,
  last_request_at timestamptz not null
);

-- Enqueue a cleanup job whenever a status or community is hard-deleted, mirroring the
-- Firestore onDocumentDeleted triggers (cleanupDeletedStatus / cleanupDeletedCommunity).
create or replace function public.queue_deletion_on_delete() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'statuses' then
    insert into public.deletion_jobs (kind, target_id, photo_path)
    values ('status', old.id, old.photo_path)
    on conflict (kind, target_id) do nothing;
  elsif tg_table_name = 'communities' then
    insert into public.deletion_jobs (kind, target_id)
    values ('community', old.id)
    on conflict (kind, target_id) do nothing;
  end if;
  return old;
end;
$$;

create trigger statuses_queue_cleanup
  after delete on public.statuses
  for each row execute function public.queue_deletion_on_delete();

create trigger communities_queue_cleanup
  after delete on public.communities
  for each row execute function public.queue_deletion_on_delete();
