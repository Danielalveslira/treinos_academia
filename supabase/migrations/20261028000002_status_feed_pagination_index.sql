-- Full keyset order avoids sorting large communities, including timestamp ties.
set local lock_timeout='5s';
create index statuses_community_feed_cursor_idx on public.statuses(community_id,created_at desc,id desc);

-- Serialize identity reuse with *every* delete path, including cascades. A waiting
-- insert gets a fresh trigger-query snapshot after the deletion commits its outbox.
create or replace function private.guard_status_photo_reuse() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_key text;
begin
  if new.photo_path is not null then
    v_key:=regexp_replace(new.photo_path,'^statusPhotos/','');
    perform pg_advisory_xact_lock(hashtextextended('status-photo:'||v_key,0));
    if exists(select 1 from public.storage_cleanup_tasks t where t.bucket='status-photos'
      and (t.object_key=v_key or t.reference=new.photo_path)) then
      raise exception 'PHOTO_ID_ALREADY_DELETED';
    end if;
  end if;
  return new;
end;
$$;
create function private.lock_status_photo_delete() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if old.photo_path is not null then
    perform pg_advisory_xact_lock(hashtextextended('status-photo:'||regexp_replace(old.photo_path,'^statusPhotos/',''),0));
  end if;
  return old;
end;
$$;
revoke all on function private.lock_status_photo_delete() from public,anon,authenticated,service_role;
create trigger statuses_lock_photo_delete before delete on public.statuses
for each row execute function private.lock_status_photo_delete();
