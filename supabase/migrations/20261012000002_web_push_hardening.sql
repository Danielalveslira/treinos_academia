-- ATENCAO: este arquivo reproduz EXATAMENTE o que foi aplicado em producao com a versao
-- 20261012000002 (recuperado de supabase_migrations.schema_migrations). Ele nunca tinha sido
-- versionado no git, e outra migration com o mesmo numero deixou de rodar. O endurecimento
-- complementar vive em 20261012000004_web_push_converge.sql.

-- Web Push hardening: closes gaps found reviewing 20261012000001.
--  1) targetUrl: backslash makes `/\host` resolve as `//host` in browsers (open redirect).
--  2) The worker must re-check eligibility at claim time (account blocked, push/category disabled
--     after the job was queued), not only when it is enqueued.
--  3) Blocking an account (disabled/deleting) revokes its subscriptions and cancels queued jobs.
--  4) Re-registering an already active subscription (app-open sync) must not flip the user's
--     enabled preference back on.

create or replace function private.safe_push_target_url(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_url is not null and char_length(p_url) <= 300 and left(p_url, 1) = '/'
      and left(p_url, 2) <> '//' and strpos(p_url, chr(92)) = 0 and p_url !~ '[[:cntrl:]]' then p_url
    else '/'
  end
$$;

create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid; v_active boolean;
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
  select exists (
    select 1 from public.push_subscriptions where endpoint = p_endpoint and user_id = v_uid and revoked_at is null
  ) into v_active;
  if v_active then
    insert into public.push_notification_preferences (user_id, enabled)
    values (v_uid, true) on conflict (user_id) do nothing;
  else
    insert into public.push_notification_preferences (user_id, enabled)
    values (v_uid, true) on conflict (user_id) do update set enabled = true, updated_at = now();
  end if;
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

  -- Eligibility is re-evaluated at send time: the user may have been blocked or turned Push
  -- (or this category) off after the job was queued.
  update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
    last_error = 'RECIPIENT_NOT_ELIGIBLE'
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (
      select 1 from public.users u
      join public.push_notification_preferences pr on pr.user_id = u.id and pr.enabled
      where u.id = o.user_id and u.account_status not in ('disabled','deleting')
        and coalesce((pr.categories ->> o.category)::boolean, true)
    );

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

create or replace function private.revoke_push_on_account_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where user_id = new.id and revoked_at is null;
  update public.notification_push_outbox set status = 'cancelled', locked_at = null, locked_by = null,
    last_error = 'ACCOUNT_UNAVAILABLE'
  where user_id = new.id and status = 'pending';
  return new;
end;
$$;

revoke execute on function private.revoke_push_on_account_block() from public, anon, authenticated;

create trigger users_revoke_push_on_account_block after update of account_status on public.users
for each row
when (new.account_status in ('disabled','deleting') and old.account_status is distinct from new.account_status)
execute function private.revoke_push_on_account_block();
