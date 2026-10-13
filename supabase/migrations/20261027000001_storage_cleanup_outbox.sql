-- AUD-04 only. Capture from OLD in the deletion transaction, including cascades.
-- No changes to run_deletion_job, financial review, Auth or AUD-05.
set local lock_timeout = '5s';
create table public.storage_cleanup_tasks (
  id uuid primary key default gen_random_uuid(),
  bucket text not null check (bucket in ('status-photos', 'profile-avatars')),
  reference text not null,
  object_key text,
  source_id uuid not null,
  state text not null default 'pending' check (state in ('pending', 'leased', 'complete', 'failed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (bucket, reference),
  check (object_key is null or object_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$')
);
alter table public.storage_cleanup_tasks enable row level security;
revoke all on public.storage_cleanup_tasks from public, anon, authenticated, service_role;
grant select on public.storage_cleanup_tasks to service_role;
create index storage_cleanup_due on public.storage_cleanup_tasks (next_attempt_at, created_at) where state = 'pending';
create index storage_cleanup_leases on public.storage_cleanup_tasks (lease_until) where state = 'leased';

create function public.capture_deleted_photo_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_bucket text;
  v_reference text;
  v_expected text;
  v_key text;
begin
  if tg_table_name = 'statuses' then
    v_bucket := 'status-photos';
    v_reference := old.photo_path;
    v_expected := old.community_id::text || '/' || old.id::text || '.webp';
    if v_reference in (v_expected, 'statusPhotos/' || v_expected) then v_key := v_expected; end if;
  else
    v_bucket := 'profile-avatars';
    v_reference := old.storage_path;
    v_expected := old.owner_id::text || '/' || old.id::text || '.webp';
    if v_reference = v_expected then v_key := v_expected; end if;
  end if;
  if v_reference is not null then
    insert into public.storage_cleanup_tasks (bucket, reference, object_key, source_id, state, last_error)
    values (v_bucket, v_reference, v_key, old.id,
      case when v_key is null then 'failed' else 'pending' end,
      case when v_key is null then 'INVALID_REFERENCE' end)
    on conflict (bucket, reference) do nothing;
  end if;
  return old;
end;
$$;
revoke all on function public.capture_deleted_photo_cleanup() from public, anon, authenticated, service_role;
create trigger statuses_storage_cleanup after delete on public.statuses
for each row execute function public.capture_deleted_photo_cleanup();
create trigger avatar_storage_cleanup after delete on public.profile_avatar_media
for each row execute function public.capture_deleted_photo_cleanup();

create function public.claim_storage_cleanup_tasks() returns setof public.storage_cleanup_tasks
language plpgsql security definer set search_path = '' as $$
begin
  -- A crash on the final attempt must not leave a permanently invisible lease.
  update public.storage_cleanup_tasks set state = 'failed', last_error = 'ATTEMPTS_EXHAUSTED',
    lease_token = null, lease_until = null
  where state = 'leased' and lease_until <= now() and attempts >= 8;
  return query
  with due as (
    select id from public.storage_cleanup_tasks
    where attempts < 8 and ((state = 'pending' and next_attempt_at <= now())
      or (state = 'leased' and lease_until <= now()))
    order by next_attempt_at, created_at limit 20 for update skip locked
  )
  update public.storage_cleanup_tasks t set state = 'leased', attempts = t.attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
  from due where t.id = due.id returning t.*;
end;
$$;

create function public.finish_storage_cleanup_task(p_id uuid, p_token uuid, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.storage_cleanup_tasks set
    state = case when p_error is null then 'complete'
      when attempts >= 8 or p_error = 'INVALID_REFERENCE' then 'failed' else 'pending' end,
    completed_at = case when p_error is null then now() end,
    last_error = case when p_error is null then null when p_error = 'INVALID_REFERENCE' then p_error else 'STORAGE_RETRY' end,
    next_attempt_at = now() + make_interval(secs => least(3600, (30 * power(2, attempts - 1))::integer)),
    lease_token = null, lease_until = null
  where id = p_id and state = 'leased' and lease_token = p_token and lease_until > now();
  return found;
end;
$$;
revoke all on function public.claim_storage_cleanup_tasks() from public, anon, authenticated;
revoke all on function public.finish_storage_cleanup_task(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup_tasks() to service_role;
grant execute on function public.finish_storage_cleanup_task(uuid, uuid, text) to service_role;
notify pgrst, 'reload schema';
