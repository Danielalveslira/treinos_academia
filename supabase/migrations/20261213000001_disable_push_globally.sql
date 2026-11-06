-- O botão geral desliga Push da conta, mantendo as notificações internas.
set local lock_timeout = '5s';
create or replace function public.disable_my_push() returns void
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || v_uid::text, 0));
  insert into public.push_notification_preferences(user_id, enabled, explicit_devices_only)
    values (v_uid, false, true)
    on conflict(user_id) do update set enabled=false, explicit_devices_only=true, updated_at=now();
  update public.push_subscriptions set revoked_at=coalesce(revoked_at, now()),
    activation_required=true, updated_at=now() where user_id=v_uid;
  update public.notification_push_outbox set status='cancelled', locked_at=null,
    locked_by=null, last_error='PUSH_DISABLED'
    where user_id=v_uid and status='pending';
  update public.notification_push_deliveries set status='cancelled', last_error='PUSH_DISABLED'
    where subscription_id in (select id from public.push_subscriptions where user_id=v_uid)
      and status='pending';
end;
$$;
revoke all on function public.disable_my_push() from public, anon;
grant execute on function public.disable_my_push() to authenticated;
