-- Notification list with the minimum navigation context and no N+1 profile reads.

create or replace view public.comment_notification_items
with (security_invoker = true) as
select
  n.id,
  n.recipient_id,
  n.actor_id,
  n.type,
  n.status_id,
  n.comment_id,
  n.read_at,
  n.created_at,
  s.community_id,
  p.username as actor_username
from public.notifications n
join public.statuses s on s.id = n.status_id
left join public.public_profiles p on p.user_id = n.actor_id;

grant select on table public.comment_notification_items to authenticated;
