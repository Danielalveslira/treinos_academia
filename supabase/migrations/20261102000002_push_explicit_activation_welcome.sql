-- Explicit activation only. Background registration remains unable to enable preferences.
-- No external network call here: the existing cron/worker owns delivery.
set local lock_timeout = '5s';

alter table public.push_notification_preferences
  add column if not exists explicit_devices_only boolean not null default false;
alter table public.push_subscriptions
  add column if not exists activation_required boolean not null default false,
  add column if not exists explicit_activation_at timestamptz,
  add column if not exists welcome_requested_at timestamptz;
alter table public.notification_push_outbox
  add column if not exists target_subscription_id uuid references public.push_subscriptions(id) on delete cascade,
  add column if not exists target_activation_at timestamptz,
  add column if not exists expires_at timestamptz;
create index if not exists notification_push_outbox_target_idx
  on public.notification_push_outbox(target_subscription_id) where target_subscription_id is not null;

alter table public.notifications drop constraint if exists notifications_status_required_chk;
alter table public.notifications add constraint notifications_status_required_chk
  check (status_id is not null or type::text like 'admin\_%'
    or type::text in ('economy_credit', 'economy_debit', 'moderation_notice', 'report_resolved',
      'workout_reminder_before', 'workout_reminder_start', 'push_welcome'));
insert into private.notification_catalog(type, category, push, urgency, ttl_seconds)
  values ('push_welcome', 'account', true, 'high', 600)
  on conflict (type) do update set category=excluded.category, push=excluded.push,
    urgency=excluded.urgency, ttl_seconds=excluded.ttl_seconds;

-- Same gates as app access, evaluated for a recipient by the service-role claim (no auth.uid there).
create or replace function private.push_activation_access(p_uid uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.users u where u.id=p_uid and u.account_status='active'
    and (u.role='superadmin' or public.email_verified_ok(u.id))
    and (not exists(select 1 from public.legal_policy where id and published)
      or exists(select 1 from public.legal_policy p where p.id and p.published
        and u.legal_acceptance_version=p.version and u.legal_acceptance_digest=p.digest))
    and not exists(select 1 from public.account_restrictions r where r.user_id=u.id
      and not (r.action='temporary_suspension' and r.until<=now()))
  )
$$;
revoke all on function private.push_activation_access(uuid) from public,anon,authenticated;

create or replace function private.write_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null, p_explicit boolean default false
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || v_uid::text, 0));
  if not private.is_push_endpoint_allowed(p_endpoint)
     or char_length(coalesce(p_p256dh, '')) not between 20 and 512
     or char_length(coalesce(p_auth, '')) not between 8 and 256 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  if not exists (select 1 from public.users where id = v_uid and account_status not in ('disabled','deleting')) then
    raise exception 'ACCOUNT_UNAVAILABLE';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-endpoint:' || p_endpoint, 0));
  if not p_explicit and (exists(select 1 from public.push_subscriptions where endpoint=p_endpoint
    and user_id=v_uid and activation_required) or (exists(select 1 from public.push_notification_preferences where user_id=v_uid and explicit_devices_only)
      and not exists(select 1 from public.push_subscriptions where user_id=v_uid and endpoint=p_endpoint and revoked_at is null and not activation_required))) then raise exception 'PUSH_ACTIVATION_REQUIRED'; end if;
  -- Só cria a preferência padrão; nunca religa uma preferência desligada (o sync periódico
  -- do app chama esta função).
  insert into public.push_notification_preferences (user_id, enabled)
  values (v_uid, true) on conflict (user_id) do nothing;

  update public.notification_push_deliveries d
  set status = 'cancelled', last_error = 'SUBSCRIPTION_REASSIGNED'
  from public.push_subscriptions s
  where d.subscription_id = s.id and s.endpoint = p_endpoint and s.user_id <> v_uid and d.status = 'pending';

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label, platform)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500), left(p_device_label, 100), left(p_platform, 80))
  on conflict (endpoint) do update set
    activation_required = case when push_subscriptions.user_id<>excluded.user_id then false else push_subscriptions.activation_required end,
    explicit_activation_at = case when push_subscriptions.user_id<>excluded.user_id then null else push_subscriptions.explicit_activation_at end,
    user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, device_label = excluded.device_label, platform = excluded.platform,
    revoked_at = null, failure_count = 0, last_failure_at = null, last_seen_at = now(), updated_at = now()
  returning id into v_id;

  -- Teto de 20 dispositivos ativos por conta: os menos recentes são revogados.
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where id in (
    select id from public.push_subscriptions where user_id = v_uid and revoked_at is null
    order by last_seen_at desc, id offset 20
  );
  return v_id;
end;
$$;

-- The old public signature remains compatible and can never select the explicit bypass.
revoke all on function private.write_push_subscription(text,text,text,text,text,text,boolean) from public,anon,authenticated;
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null
) returns uuid
language sql security definer set search_path='' as $$
  select private.write_push_subscription(p_endpoint,p_p256dh,p_auth,p_user_agent,p_device_label,p_platform,false)
$$;

-- Revogar subscriptions não altera a preferência: ela só muda por escolha explícita.
create or replace function public.unregister_push_subscription(p_endpoint text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || v_uid::text, 0));
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where user_id = v_uid and revoked_at is null and (p_endpoint is null or endpoint = p_endpoint);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- `thisDevice` diz se o endpoint informado pertence à conta atual e está ativo (a UI não
-- pode inferir o estado do dispositivo a partir da contagem de todos os dispositivos).
drop function if exists public.get_my_push_status();
create or replace function public.get_my_push_status(p_endpoint text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'preferenceExists', exists(select 1 from public.push_notification_preferences where user_id=(select auth.uid())),
    'registrationAllowed', not exists(select 1 from public.push_subscriptions where endpoint=p_endpoint and user_id=(select auth.uid()) and activation_required)
      and (not exists(select 1 from public.push_notification_preferences where user_id=(select auth.uid()) and explicit_devices_only)
        or exists(select 1 from public.push_subscriptions where endpoint=p_endpoint and user_id=(select auth.uid()) and revoked_at is null and not activation_required)),
    'enabled', coalesce((select enabled from public.push_notification_preferences where user_id = (select auth.uid())), false),
    'activeSubscriptions', (select count(*) from public.push_subscriptions where user_id = (select auth.uid()) and revoked_at is null),
    'thisDevice', p_endpoint is not null and exists (
      select 1 from public.push_subscriptions
      where user_id = (select auth.uid()) and endpoint = p_endpoint and revoked_at is null and not activation_required),
    'categories', coalesce((select categories from public.push_notification_preferences where user_id = (select auth.uid())), '{}'::jsonb)
  )
$$;
revoke execute on function public.get_my_push_status(text) from public, anon;
grant execute on function public.get_my_push_status(text) to authenticated;


-- Only this RPC accepts the explicit opt-in. No caller-selected recipient/content/target URL.
create or replace function public.activate_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid(); v_id uuid; v_pref boolean; v_sub public.push_subscriptions;
  v_now timestamptz; v_episode boolean; v_welcome text := 'not_requested'; v_notification bigint;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('push:' || v_uid::text, 0));
  if not private.push_activation_access(v_uid) then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  if not private.is_push_endpoint_allowed(p_endpoint)
    or char_length(coalesce(p_p256dh,'')) not between 20 and 512
    or char_length(coalesce(p_auth,'')) not between 8 and 256 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('push-endpoint:' || p_endpoint, 0));
  -- A known live endpoint of another account cannot be appropriated by this opt-in RPC.
  select * into v_sub from public.push_subscriptions where endpoint=p_endpoint for update;
  if found and v_sub.user_id<>v_uid and v_sub.revoked_at is null then
    raise exception 'PUSH_ENDPOINT_IN_USE';
  end if;
  select enabled into v_pref from public.push_notification_preferences where user_id=v_uid for update;
  v_now := clock_timestamp();
  v_episode := v_sub.id is null or v_sub.user_id<>v_uid or v_sub.revoked_at is not null
    or v_sub.activation_required or v_sub.explicit_activation_at is null or v_pref is distinct from true;
  if v_pref is false then
    -- Enabling the account switch must NOT awaken its other devices. These endpoints require
    -- their own explicit activation; old/background register is blocked by activation_required.
    update public.push_subscriptions set activation_required=true, revoked_at=coalesce(revoked_at,v_now), updated_at=v_now
      where user_id=v_uid and endpoint<>p_endpoint;
    update public.push_notification_preferences set explicit_devices_only=true where user_id=v_uid;
    update public.notification_push_deliveries d set status='cancelled', last_error='EXPLICIT_ACTIVATION_REQUIRED'
      from public.push_subscriptions ps where ps.id=d.subscription_id and ps.user_id=v_uid
      and ps.activation_required and d.status='pending';
  end if;
  insert into public.push_notification_preferences(user_id,enabled) values(v_uid,true)
    on conflict(user_id) do update set enabled=true, updated_at=v_now
    where not push_notification_preferences.enabled;
  -- Clear the hold only on the explicitly chosen device; reuse limits, keys and labels validation.
  update public.push_subscriptions set activation_required=false where endpoint=p_endpoint and user_id=v_uid;
  v_id := private.write_push_subscription(p_endpoint,p_p256dh,p_auth,p_user_agent,p_device_label,p_platform,true);
  if v_episode then
    update public.push_subscriptions set explicit_activation_at=v_now where id=v_id;
    update public.notification_push_outbox set status='cancelled', locked_at=null, locked_by=null,
      last_error='ACTIVATION_SUPERSEDED'
      where target_subscription_id=v_id and status in ('pending','processing');
  end if;
  select * into v_sub from public.push_subscriptions where id=v_id;
  -- Queue errors are a savepoint: never roll back a confirmed valid activation.
  begin
    if not exists(select 1 from private.notification_catalog where type='push_welcome' and push) then
      v_welcome := 'unavailable';
    elsif not exists(select 1 from public.push_notification_preferences where user_id=v_uid
      and enabled and private.push_category_enabled(categories,'account')) then
      v_welcome := 'category_disabled';
    elsif v_sub.welcome_requested_at >= v_sub.explicit_activation_at then
      v_welcome := 'already_requested';
    elsif v_sub.welcome_requested_at > v_now - interval '24 hours' then
      v_welcome := 'cooldown';
    elsif exists(select 1 from private.push_state where recipient_id=v_uid
      and ((key='wa:hour' and window_start=date_trunc('hour',v_now) and hits>=5)
        or (key='wa:day' and window_start=date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC' and hits>=10))) then
      v_welcome := 'rate_limited';
    else
      insert into public.notifications(recipient_id,type,dedupe_key,action_url,metadata,read_at,archived_at)
        values(v_uid,'push_welcome','push-welcome:' || v_id::text || ':' || v_sub.explicit_activation_at::text,
          '/',jsonb_build_object('expiresAt',v_now+interval '10 minutes'),v_now,v_now)
        returning id into v_notification;
      -- Override generic fan-out before transaction commit; ensure a job even if the enqueue
      -- trigger declined. Existing category gate was checked above; no critical bypass.
      insert into public.notification_push_outbox(notification_id,user_id,category,
        target_subscription_id,target_activation_at,expires_at)
        values(v_notification,v_uid,'account',v_id,v_sub.explicit_activation_at,v_now+interval '10 minutes')
        on conflict(notification_id,user_id) do update set target_subscription_id=excluded.target_subscription_id,
          target_activation_at=excluded.target_activation_at, expires_at=excluded.expires_at;
      insert into private.push_state as state(recipient_id,key,window_start,hits,last_at)
        values(v_uid,'wa:hour',date_trunc('hour',v_now),1,v_now),
          (v_uid,'wa:day',date_trunc('day',v_now at time zone 'UTC') at time zone 'UTC',1,v_now)
        on conflict(recipient_id,key) do update set
          hits=case when state.window_start=excluded.window_start then state.hits+1 else 1 end,
          window_start=excluded.window_start,last_at=excluded.last_at;
      update public.push_subscriptions set welcome_requested_at=v_now where id=v_id;
      v_welcome := 'queued';
    end if;
  exception when others then
    v_welcome := 'unavailable'; -- fixed result, never expose errors/endpoints/keys
  end;
  return jsonb_build_object('status',public.get_my_push_status(p_endpoint),'welcome',v_welcome);
end;
$$;
revoke all on function public.activate_push_subscription(text,text,text,text,text,text) from public,anon;
grant execute on function public.activate_push_subscription(text,text,text,text,text,text) to authenticated;

create or replace function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text, urgency text, ttl_seconds integer,
  variant integer, group_count integer, ack_token text
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

  with expired as (
    update public.notification_push_outbox o set status='cancelled', locked_at=null, locked_by=null,
      last_error='WELCOME_EXPIRED_OR_UNAVAILABLE'
    where o.status='processing' and o.locked_by=p_worker_id
      and (o.expires_at<=clock_timestamp() or (o.target_subscription_id is not null and not exists (
        select 1 from public.push_subscriptions s where s.id=o.target_subscription_id
          and s.user_id=o.user_id and s.revoked_at is null and not s.activation_required
          and s.explicit_activation_at=o.target_activation_at)))
    returning o.id
  ) update public.notification_push_deliveries d set status='cancelled', last_error='WELCOME_EXPIRED_OR_UNAVAILABLE'
    from expired e where d.outbox_id=e.id and d.status='pending';

  with ineligible as (
    update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
      last_error = 'RECIPIENT_NOT_ELIGIBLE'
    where o.status = 'processing' and o.locked_by = p_worker_id and not exists (
      select 1 from public.users u
      join public.push_notification_preferences p on p.user_id = u.id and p.enabled
      where u.id = o.user_id and u.account_status not in ('disabled', 'deleting')
        and (o.critical or private.push_category_enabled(p.categories, o.category))
        and (o.target_subscription_id is null or private.push_activation_access(o.user_id)))
    returning o.id
  )
  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'RECIPIENT_NOT_ELIGIBLE'
  from ineligible i where d.outbox_id = i.id and d.status = 'pending';

  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'SUBSCRIPTION_UNAVAILABLE'
  from public.notification_push_outbox o
  where d.outbox_id = o.id and o.status = 'processing' and o.locked_by = p_worker_id and d.status = 'pending'
    and not exists (
      select 1 from public.push_subscriptions s
      where s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null
        and (o.target_subscription_id is null or s.id=o.target_subscription_id));

  insert into public.notification_push_deliveries (outbox_id, notification_id, subscription_id)
    select o.id, o.notification_id, s.id from public.notification_push_outbox o
    join public.push_subscriptions s on s.user_id = o.user_id and s.revoked_at is null
    where o.status = 'processing' and o.locked_by = p_worker_id
      and (o.target_subscription_id is null or s.id=o.target_subscription_id)
      and (o.target_subscription_id is not null or not exists(select 1 from public.notifications wn where wn.id=o.notification_id and wn.type='push_welcome'))
    on conflict on constraint notification_push_delivery_subscription_key do nothing;

  update public.notification_push_outbox o set
    status = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then 'sent'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed', 'expired')) then 'failed'
      else 'cancelled' end,
    sent_at = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent')
      then coalesce(o.sent_at, now()) else o.sent_at end,
    last_error = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed', 'expired')) then 'DELIVERY_FAILURE'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then null
      else 'NO_ACTIVE_SUBSCRIPTIONS' end,
    locked_at = null, locked_by = null
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending');

  update public.notification_push_outbox o set status = 'pending', locked_at = null, locked_by = null,
    next_attempt_at = (select min(d.next_attempt_at) from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending')
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now());

  return query
  with base as (
    select o.id as x_job, d.id as x_delivery, o.notification_id as x_notification, s.id as x_subscription,
      s.endpoint as x_endpoint, s.p256dh as x_p256dh, s.auth as x_auth,
      n.type::text as x_type, p.username as x_actor,
      private.safe_push_target_url(case
        when n.comment_id is not null and n.status_id is not null and st.community_id is not null
          then '/comunidades/' || st.community_id::text || '/publicacoes/' || n.status_id::text || '/comentarios/' || n.comment_id::text
        else n.action_url end) as x_url,
      n.metadata as x_metadata, n.priority as x_priority,
      coalesce(cat.urgency, 'normal') as x_urgency, coalesce(cat.ttl_seconds, 86400) as x_ttl,
      o.variant as x_variant, o.coalesced_count as x_group
    from public.notification_push_outbox o
    join public.notifications n on n.id = o.notification_id
    left join public.statuses st on st.id = n.status_id
    left join private.notification_catalog cat on cat.type = n.type::text
    left join public.public_profiles p on p.user_id = n.actor_id
    join public.notification_push_deliveries d on d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now()
    join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null
    where (o.target_subscription_id is null or s.id=o.target_subscription_id)
      and (o.target_subscription_id is not null or n.type<>'push_welcome')
      and o.status = 'processing' and o.locked_by = p_worker_id
  ),
  stamped as (
    update public.notification_push_deliveries d set
      ack_token_hash = sha256(convert_to(t.tok, 'utf8')),
      claimed_at = clock_timestamp(),
      worker_started_at = null, provider_accepted_at = null,
      sw_received_at = null, show_resolved_at = null, show_failed_at = null, show_failure = null, clicked_at = null
    from (select b.x_delivery as did, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as tok from base b) t
    where d.id = t.did
    returning d.id as sid, t.tok as stok
  )
  select b.x_job, b.x_delivery, b.x_notification, b.x_subscription, b.x_endpoint, b.x_p256dh, b.x_auth,
    b.x_type, b.x_actor, b.x_url, b.x_metadata, b.x_priority, b.x_urgency, b.x_ttl, b.x_variant, b.x_group,
    st2.stok
  from base b join stamped st2 on st2.sid = b.x_delivery;
end;
$$;
revoke execute on function public.claim_push_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text, integer) to service_role;


notify pgrst, 'reload schema';
