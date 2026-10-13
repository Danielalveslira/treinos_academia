-- Apply only after installing and validating 20261028000001 in the release pipeline.
-- The first batch runs automatically as part of activation, then cron drains the backlog.
set local lock_timeout='5s';
do $$
begin
  if not exists(select 1 from pg_trigger where tgrelid='public.statuses'::regclass
    and tgname='statuses_storage_cleanup' and tgenabled='O')
    or not exists(select 1 from pg_trigger where tgrelid='public.statuses'::regclass
    and tgname='statuses_lock_photo_delete' and tgenabled='O')
    or not exists(select 1 from pg_class where oid='public.statuses_community_feed_cursor_idx'::regclass) then
    raise exception 'EXPIRATION_RELEASE_INCOMPLETE';
  end if;
  -- Fail closed if new/unreviewed FK dependencies were introduced before activation.
  if exists(select 1 from pg_constraint where confrelid='public.statuses'::regclass and (
    conrelid not in ('public.status_votes'::regclass,'public.status_participants'::regclass,
      'public.support_requests'::regclass,'public.status_economy_votes'::regclass,
      'public.status_economy_reward_daily'::regclass,'public.notifications'::regclass,
      'public.post_comments'::regclass,'public.status_expiration_queue'::regclass)
    or confdeltype not in ('c','n'))) then
    raise exception 'UNREVIEWED_STATUS_DEPENDENCY';
  end if;
  if has_function_privilege('authenticated','public.process_expired_statuses(integer)','execute')
    or has_function_privilege('anon','public.process_expired_statuses(integer)','execute')
    or has_function_privilege('service_role','public.process_expired_statuses(integer)','execute') then
    raise exception 'EXPIRATION_EXECUTION_NOT_INTERNAL';
  end if;
end;
$$;
update public.status_expiration_control set enabled=true where id;
select public.process_expired_statuses(50);
