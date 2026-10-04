-- Web Push is a delivery channel for the existing notifications table.
create table public.push_notification_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  enabled boolean not null default true,
  categories jsonb not null default '{"social":true,"communities":true,"workouts":true,"account":true,"administrative":true}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint push_preferences_categories_object check (jsonb_typeof(categories) = 'object')
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  device_label text,
  platform text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0),
  last_failure_at timestamptz,
  constraint push_subscription_endpoint_length check (char_length(endpoint) between 10 and 4096),
  constraint push_subscription_key_lengths check (char_length(p256dh) between 20 and 512 and char_length(auth) between 8 and 256)
);
create index push_subscriptions_active_user_idx on public.push_subscriptions (user_id, id) where revoked_at is null;

create table public.notification_push_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_id bigint not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  category text not null check (category in ('social','communities','workouts','account','administrative')),
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','cancelled')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, user_id)
);
create index notification_push_outbox_ready_idx on public.notification_push_outbox (next_attempt_at, created_at) where status = 'pending';

create table public.notification_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_push_outbox(id) on delete cascade,
  notification_id bigint not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed','expired')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_http_status integer,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_push_delivery_subscription_key unique (notification_id, subscription_id)
);
create index notification_push_deliveries_ready_idx on public.notification_push_deliveries (outbox_id, next_attempt_at) where status = 'pending';

create table public.push_broadcast_audit (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  created_by uuid not null references public.users(id) on delete restrict,
  title text not null,
  target_url text,
  target_count integer not null check (target_count >= 0),
  created_at timestamptz not null default now()
);

alter table public.push_notification_preferences enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_push_outbox enable row level security;
alter table public.notification_push_deliveries enable row level security;
alter table public.push_broadcast_audit enable row level security;
revoke all on table public.push_notification_preferences, public.push_subscriptions,
  public.notification_push_outbox, public.notification_push_deliveries, public.push_broadcast_audit
  from public, anon, authenticated;
grant select, insert, update, delete on table public.push_notification_preferences, public.push_subscriptions,
  public.notification_push_outbox, public.notification_push_deliveries, public.push_broadcast_audit to service_role;

create or replace function private.safe_push_target_url(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_url is not null and char_length(p_url) <= 300 and left(p_url, 1) = '/'
      and left(p_url, 2) <> '//' and p_url !~ '[[:cntrl:]]' then p_url
    else '/'
  end
$$;

create or replace function private.notification_push_category(p_type public.notification_type) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_type::text in ('post_reply','comment_reply','comment_mention','comment_like') then 'social'
    when p_type::text like 'admin\_%' then 'administrative'
    else null
  end
$$;

create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 4096
     or char_length(coalesce(p_p256dh, '')) not between 20 and 512
     or char_length(coalesce(p_auth, '')) not between 8 and 256 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  if not exists (select 1 from public.users where id = v_uid and account_status not in ('disabled','deleting')) then
    raise exception 'ACCOUNT_UNAVAILABLE';
  end if;
  insert into public.push_notification_preferences (user_id, enabled)
  values (v_uid, true) on conflict (user_id) do update set enabled = true, updated_at = now();
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label, platform)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500), left(p_device_label, 100), left(p_platform, 80))
  on conflict (endpoint) do update set
    user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, device_label = excluded.device_label, platform = excluded.platform,
    revoked_at = null, failure_count = 0, last_failure_at = null, last_seen_at = now(), updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.unregister_push_subscription(p_endpoint text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where user_id = v_uid and revoked_at is null and (p_endpoint is null or endpoint = p_endpoint);
  get diagnostics v_count = row_count;
  if p_endpoint is null then
    update public.push_notification_preferences set enabled = false, updated_at = now() where user_id = v_uid;
  end if;
  return v_count;
end;
$$;

create or replace function public.get_my_push_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((select enabled from public.push_notification_preferences where user_id = auth.uid()), false),
    'activeSubscriptions', (select count(*) from public.push_subscriptions where user_id = auth.uid() and revoked_at is null),
    'categories', coalesce((select categories from public.push_notification_preferences where user_id = auth.uid()), '{}'::jsonb)
  )
$$;

revoke execute on function public.register_push_subscription(text,text,text,text,text,text), public.unregister_push_subscription(text),
  public.get_my_push_status() from public, anon;
grant execute on function public.register_push_subscription(text,text,text,text,text,text), public.unregister_push_subscription(text),
  public.get_my_push_status() to authenticated;

create or replace function public.create_push_broadcast(
  p_idempotency_key uuid, p_title text, p_body text, p_target_url text default '/', p_confirmed boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_count integer; v_existing public.push_broadcast_audit; v_broadcast_id uuid;
begin
  if v_uid is null or not coalesce(public.is_superadmin(), false) then raise exception 'PERMISSION_DENIED'; end if;
  if not p_confirmed then raise exception 'CONFIRMATION_REQUIRED'; end if;
  if p_idempotency_key is null or char_length(btrim(coalesce(p_title, ''))) not between 1 and 120
     or char_length(btrim(coalesce(p_body, ''))) not between 1 and 240 then raise exception 'INVALID_ARGUMENT'; end if;
  select * into v_existing from public.push_broadcast_audit where idempotency_key = p_idempotency_key;
  if v_existing.id is not null then return jsonb_build_object('broadcastId', v_existing.id, 'targetCount', v_existing.target_count, 'duplicate', true); end if;
  if exists (select 1 from public.push_broadcast_audit where created_by = v_uid and created_at > now() - interval '5 minutes') then
    raise exception 'BROADCAST_RATE_LIMITED';
  end if;
  select count(*) into v_count from public.users where account_status not in ('disabled','deleting');
  if v_count > 10000 then raise exception 'BROADCAST_TARGET_LIMIT'; end if;
  insert into public.push_broadcast_audit (idempotency_key, created_by, title, target_url, target_count)
  values (p_idempotency_key, v_uid, btrim(p_title), private.safe_push_target_url(p_target_url), v_count)
  returning id into v_broadcast_id;
  insert into public.notifications (recipient_id, actor_id, type, priority, action_url, metadata, dedupe_key)
  select u.id, v_uid, 'admin_broadcast'::public.notification_type, 'high', private.safe_push_target_url(p_target_url),
    jsonb_build_object('title', btrim(p_title), 'body', btrim(p_body)), 'push-broadcast:' || p_idempotency_key::text
  from public.users u where u.account_status not in ('disabled','deleting')
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  return jsonb_build_object('broadcastId', v_broadcast_id, 'targetCount', v_count, 'duplicate', false);
end;
$$;
revoke execute on function public.create_push_broadcast(uuid,text,text,text,boolean) from public, anon;
grant execute on function public.create_push_broadcast(uuid,text,text,text,boolean) to authenticated;

create or replace function private.enqueue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_category text := private.notification_push_category(new.type);
begin
  if v_category is null then return new; end if;
  if exists (
    select 1 from public.users u
    join public.push_notification_preferences p on p.user_id = u.id and p.enabled
    where u.id = new.recipient_id and u.account_status not in ('disabled','deleting')
      and coalesce((p.categories ->> v_category)::boolean, true)
      and exists (select 1 from public.push_subscriptions s where s.user_id = u.id and s.revoked_at is null)
  ) then
    insert into public.notification_push_outbox (notification_id, user_id, category)
    values (new.id, new.recipient_id, v_category) on conflict (notification_id, user_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger notifications_enqueue_push after insert on public.notifications
for each row execute function private.enqueue_notification_push();

create or replace function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id is null or char_length(p_worker_id) > 100 then raise exception 'INVALID_WORKER'; end if;
  update public.notification_push_outbox set status = 'pending', locked_at = null, locked_by = null
    where status = 'processing' and locked_at < now() - interval '10 minutes';
  with picked as (
    select o.id from public.notification_push_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.created_at
    for update skip locked limit least(greatest(p_limit, 1), 100)
  )
  update public.notification_push_outbox o set status = 'processing', locked_at = now(), locked_by = p_worker_id,
      attempt_count = o.attempt_count + 1
  from picked where o.id = picked.id;

  insert into public.notification_push_deliveries (outbox_id, notification_id, subscription_id)
    select o.id, o.notification_id, s.id from public.notification_push_outbox o
    join public.push_subscriptions s on s.user_id = o.user_id and s.revoked_at is null
    where o.status = 'processing' and o.locked_by = p_worker_id
    on conflict on constraint notification_push_delivery_subscription_key do nothing;

  update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
    last_error = 'NO_ACTIVE_SUBSCRIPTIONS'
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('pending','sent'));

  return query
  select o.id, d.id, o.notification_id, s.id, s.endpoint, s.p256dh, s.auth,
    n.type::text, p.username,
    private.safe_push_target_url(case
      when n.comment_id is not null and n.status_id is not null and st.community_id is not null
        then '/comunidades/' || st.community_id::text || '/publicacoes/' || n.status_id::text || '/comentarios/' || n.comment_id::text
      else n.action_url end),
    n.metadata, n.priority
  from public.notification_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.statuses st on st.id = n.status_id
  left join public.public_profiles p on p.user_id = n.actor_id
  join public.notification_push_deliveries d on d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now()
  join public.push_subscriptions s on s.id = d.subscription_id and s.revoked_at is null
  where o.status = 'processing' and o.locked_by = p_worker_id;
end;
$$;

create or replace function public.finish_push_batch(p_worker_id text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_delay interval;
begin
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) > 500 then raise exception 'INVALID_RESULTS'; end if;
  for r in select * from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, http_status integer, error text)
  loop
    if r.outcome not in ('sent','expired','transient','permanent') then raise exception 'INVALID_OUTCOME'; end if;
    select case d.attempt_count when 0 then interval '1 minute' when 1 then interval '5 minutes'
      when 2 then interval '15 minutes' else interval '1 hour' end into v_delay
    from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
    where d.id = r.delivery_id and o.locked_by = p_worker_id and o.status = 'processing';
    update public.notification_push_deliveries d set
      attempt_count = d.attempt_count + 1,
      status = case when r.outcome = 'sent' then 'sent' when r.outcome = 'expired' then 'expired'
        when r.outcome = 'permanent' or d.attempt_count + 1 >= 6 then 'failed' else 'pending' end,
      next_attempt_at = case when r.outcome = 'transient' and d.attempt_count + 1 < 6 then now() + v_delay else d.next_attempt_at end,
      last_http_status = r.http_status, last_error = left(r.error, 500),
      sent_at = case when r.outcome = 'sent' then now() else d.sent_at end
    from public.notification_push_outbox o
    where d.id = r.delivery_id and o.id = d.outbox_id and o.locked_by = p_worker_id and o.status = 'processing';
  end loop;

  update public.push_subscriptions s set
    revoked_at = case when d.status = 'expired' then now() else s.revoked_at end,
    failure_count = case when d.status = 'sent' then 0 else s.failure_count + 1 end,
    last_failure_at = case when d.status = 'sent' then s.last_failure_at else now() end,
    updated_at = now()
  from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
  where s.id = d.subscription_id and o.locked_by = p_worker_id and d.id in (
    select (x->>'delivery_id')::uuid from jsonb_array_elements(p_results) x
  );

  update public.notification_push_outbox o set
    status = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending') then 'pending'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then 'sent'
      else 'failed' end,
    next_attempt_at = coalesce((select min(d.next_attempt_at) from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending'), o.next_attempt_at),
    sent_at = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent')
      and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending') then now() else o.sent_at end,
    last_error = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed','expired')) then 'DELIVERY_FAILURE' else null end,
    locked_at = null, locked_by = null
  where o.locked_by = p_worker_id and o.status = 'processing';
end;
$$;

revoke execute on function public.claim_push_jobs(text,integer), public.finish_push_batch(text,jsonb) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text,integer), public.finish_push_batch(text,jsonb) to service_role;

-- Retention: preserve delivery evidence for 90 days and revoked endpoints for 180 days.
create or replace function private.cleanup_push_history() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_push_outbox where status in ('sent','failed','cancelled') and created_at < now() - interval '90 days';
  delete from public.push_subscriptions where revoked_at < now() - interval '180 days';
end;
$$;
revoke execute on function private.cleanup_push_history() from public, anon, authenticated;
select cron.schedule('cleanup-push-history', '17 4 * * *', $$select private.cleanup_push_history()$$);

select cron.schedule(
  'process-push-outbox', '* * * * *',
  $$select net.http_post(
    url := 'https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/process-push-outbox',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3cmpvanJqZ296ZGZwZGRra3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzA3MjYsImV4cCI6MjEwNjAwNjcyNn0.CKODsrNrIpijKaiJGk9tQbTvuw24EuctjFouaLWMPRg',
      'Content-Type', 'application/json'
    )
  )$$
);
