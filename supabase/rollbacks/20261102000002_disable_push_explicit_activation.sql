-- Operational rollback only, AFTER rolling back the frontend. Review before production use.
-- Retain additive schema/enum and per-device holds: never silently revive other devices.
begin;
set local lock_timeout='5s';
revoke all on function public.activate_push_subscription(text,text,text,text,text,text) from authenticated;
update private.notification_catalog set push=false where type='push_welcome';
update public.notification_push_outbox set status='cancelled',locked_by=null,locked_at=null,last_error='FEATURE_ROLLBACK'
  where target_subscription_id is not null and status in ('pending','processing');
update public.notification_push_deliveries d set status='cancelled',last_error='FEATURE_ROLLBACK'
  from public.notification_push_outbox o where o.id=d.outbox_id and o.last_error='FEATURE_ROLLBACK' and d.status='pending';
notify pgrst,'reload schema';
commit;
