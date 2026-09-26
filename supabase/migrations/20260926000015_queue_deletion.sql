-- Equivalent to deleteAccountPermanently/deleteCommunityPermanently (Cloud Functions)
-- and deletion-service.js's queue(): only superadmin, idempotent (an existing job is a
-- no-op), flips the target's status immediately, then enqueues the durable job that the
-- (not yet built) worker drains. The old maintenance/adminV1 gate is intentionally
-- dropped — it guarded a Firestore data migration that has no equivalent here.
create or replace function public.queue_deletion(p_kind text, p_target_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_kind not in ('account', 'community', 'status') then
    raise exception 'INVALID_KIND';
  end if;
  if p_kind = 'account' and p_target_id = v_admin_id then
    raise exception 'CANNOT_DELETE_SELF';
  end if;

  if exists (select 1 from public.deletion_jobs where kind = p_kind and target_id = p_target_id) then
    return;
  end if;

  if p_kind = 'account' then
    select role into v_target_role from public.users where id = p_target_id;
    if v_target_role is null then
      raise exception 'NOT_FOUND';
    end if;
    if v_target_role = 'superadmin' then
      raise exception 'CANNOT_DELETE_ADMIN';
    end if;
    update public.users set account_status = 'deleting' where id = p_target_id;
  elsif p_kind = 'community' then
    if not exists (select 1 from public.communities where id = p_target_id) then
      raise exception 'NOT_FOUND';
    end if;
    update public.communities set is_active = false, deletion_status = 'pending' where id = p_target_id;
  end if;

  insert into public.deletion_jobs (kind, target_id, requested_by, state, stage)
  values (p_kind, p_target_id, v_admin_id, 'pending', 0);
end;
$$;

-- Equivalent to listDeletionJobs (superadmin-only panel view).
create or replace function public.list_deletion_jobs() returns setof public.deletion_jobs
  language sql stable security definer set search_path = public as $$
    select * from public.deletion_jobs
    where public.is_superadmin()
    order by updated_at asc
    limit 50
$$;
