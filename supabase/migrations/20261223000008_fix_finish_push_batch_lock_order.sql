-- public.finish_push_batch(text,jsonb) deadlocked under real concurrency (6 workers draining a
-- shared outbox where many notifications fan out to the same few devices -- see
-- supabase/functions/process-push-outbox/concurrency.test.js). Root cause: the push_subscriptions
-- UPDATE joined notification_push_deliveries/notification_push_outbox and let Postgres pick
-- whatever row-lock order its scan happened to produce. Two workers whose batches both touched,
-- say, subscriptions S1 and S2 could lock them in opposite order (worker A: S1 then S2; worker B:
-- S2 then S1), deadlocking. claim_push_jobs() already guarantees workers never share an outbox/
-- delivery row (SKIP LOCKED), so that pair was never the problem; push_subscriptions is the only
-- table a batch can share with another worker's batch, because one device can have several
-- pending notifications claimed by different workers at once.
--
-- Fix: lock every affected subscription row through a single CTE, in ascending id order, before
-- the UPDATE touches any of them -- the standard way to make a multi-row UPDATE's lock order
-- deterministic across all concurrent callers. As long as every caller locks shared rows in the
-- same order, a circular wait (the definition of a deadlock) cannot form.
--
-- This also fixes a latent correctness bug the lack of GROUP BY let through: when a single batch
-- has more than one delivery for the same subscription (exactly the fan-out scenario above), the
-- previous UPDATE...FROM had no defined way to pick among the matching delivery rows, so Postgres
-- used an arbitrary one -- failure_count/revoked_at/last_failure_at could end up reflecting a
-- delivery that was not representative of the whole batch for that device. Aggregating with
-- bool_or() across every delivery in the batch for that subscription removes the ambiguity: a
-- device is treated as reachable (failure_count reset to 0, no revocation, last_failure_at
-- untouched) if ANY delivery in this batch for it sent successfully, and as failing otherwise --
-- matching the single-delivery behavior exactly when there is in fact only one.
set local lock_timeout = '5s';

create or replace function public.finish_push_batch(p_worker_id text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_delay interval;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 500 then raise exception 'INVALID_RESULTS'; end if;
  for r in select * from jsonb_to_recordset(p_results) as x(
    delivery_id uuid, outcome text, http_status integer, error text,
    worker_started_at text, provider_accepted_at text)
  loop
    if r.delivery_id is null then raise exception 'INVALID_RESULTS'; end if;
    if r.outcome is null or r.outcome not in ('sent','expired','transient','permanent') then raise exception 'INVALID_OUTCOME'; end if;
    select case d.attempt_count when 0 then interval '1 minute' when 1 then interval '5 minutes'
      when 2 then interval '15 minutes' else interval '1 hour' end into v_delay
    from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
    where d.id = r.delivery_id and o.locked_by = p_worker_id and o.status = 'processing';
    update public.notification_push_deliveries d set
      attempt_count = d.attempt_count + 1,
      status = case when r.outcome = 'sent' then 'sent' when r.outcome = 'expired' then 'expired'
        when r.outcome = 'permanent' or d.attempt_count + 1 >= 6 then 'failed' else 'pending' end,
      next_attempt_at = case when r.outcome = 'transient' and d.attempt_count + 1 < 6 then now() + v_delay else d.next_attempt_at end,
      last_http_status = case when r.http_status between 100 and 599 then r.http_status end,
      last_error = left(r.error, 500),
      sent_at = case when r.outcome = 'sent' then now() else d.sent_at end,
      worker_started_at = private.push_clock(r.worker_started_at),
      provider_accepted_at = case when r.outcome = 'sent' then private.push_clock(r.provider_accepted_at) end
    from public.notification_push_outbox o
    where d.id = r.delivery_id and o.id = d.outbox_id and o.locked_by = p_worker_id and o.status = 'processing'
      and d.status = 'pending';
  end loop;

  -- Lock every affected subscription in a fixed order (ascending id) before writing to any of
  -- them, and aggregate every delivery this batch has for that subscription instead of letting
  -- an unordered join pick one arbitrarily.
  with affected as (
    select d.subscription_id,
      bool_or(d.status = 'expired') as any_expired,
      bool_or(d.status = 'sent') as any_sent
    from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
    where o.locked_by = p_worker_id and d.id in (
      select (x->>'delivery_id')::uuid from jsonb_array_elements(p_results) x
    )
    group by d.subscription_id
    order by d.subscription_id
  ), locked as materialized (
    select s.id from public.push_subscriptions s
    where s.id in (select subscription_id from affected)
    order by s.id
    for update
  )
  update public.push_subscriptions s set
    revoked_at = case when a.any_expired then now() else s.revoked_at end,
    failure_count = case when a.any_sent then 0 else s.failure_count + 1 end,
    last_failure_at = case when a.any_sent then s.last_failure_at else now() end,
    updated_at = now()
  from affected a
  where s.id = a.subscription_id and s.id in (select id from locked);

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
revoke all on function public.finish_push_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_push_batch(text, jsonb) to service_role;
