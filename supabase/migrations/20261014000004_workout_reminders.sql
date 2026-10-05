-- Weekly plans have no workout ID: a local date and reminder kind identify an occurrence.
alter table public.notifications drop constraint if exists notifications_status_required_chk;
alter table public.notifications add constraint notifications_status_required_chk
  check (status_id is not null or type::text like 'admin\_%'
    or type::text in ('economy_credit', 'economy_debit', 'moderation_notice', 'report_resolved',
      'workout_reminder_before', 'workout_reminder_start'));

insert into private.notification_catalog (type, category, push, urgency, ttl_seconds) values
  ('workout_reminder_before', 'workouts', true, 'normal', 3600),
  ('workout_reminder_start', 'workouts', true, 'high', 900)
on conflict (type) do update set category = excluded.category, push = excluded.push,
  urgency = excluded.urgency, ttl_seconds = excluded.ttl_seconds;

-- The existing Push claim path and plan cancellation both use this terminal state.
alter table public.notification_push_deliveries
  drop constraint if exists notification_push_deliveries_status_check;
alter table public.notification_push_deliveries
  add constraint notification_push_deliveries_status_check
  check (status in ('pending', 'sent', 'failed', 'expired', 'cancelled'));

create table if not exists public.workout_reminder_jobs (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  planned_date date not null,
  kind text not null check (kind in ('before', 'start')),
  scheduled_at timestamptz not null,
  timezone text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'cancelled', 'skipped')),
  notification_id bigint references public.notifications(id) on delete set null,
  processed_at timestamptz,
  unique (user_id, planned_date, kind, scheduled_at)
);
create index if not exists workout_reminder_jobs_due_idx on public.workout_reminder_jobs (scheduled_at, id)
  where status = 'pending';
create index if not exists workout_reminder_jobs_user_pending_idx on public.workout_reminder_jobs (user_id, planned_date)
  where status = 'pending';
alter table public.workout_reminder_jobs enable row level security;
revoke all on public.workout_reminder_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.workout_reminder_jobs to service_role;

create or replace function private.schedule_next_workout_reminder(
  p_user_id uuid, p_kind text, p_after timestamptz default now()
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_plan jsonb;
  v_timezone text;
  v_day date;
  v_at timestamptz;
  v_time time;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
begin
  if p_kind not in ('before', 'start') then return; end if;
  select training_preferences into v_plan from public.users
    where id = p_user_id and account_status not in ('disabled','deleting');
  if coalesce((v_plan->>'reminderEnabled')::boolean, false) is not true
    or v_plan->>'reminderTime' is null then return; end if;
  v_timezone := v_plan->>'timezone';
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then return; end if;
  v_time := (v_plan->>'reminderTime')::time;
  for i in 0..8 loop
    v_day := (p_after at time zone v_timezone)::date + i;
    if v_day < coalesce((v_plan->>'effectiveFrom')::date, v_day) then continue; end if;
    if not coalesce((v_plan->'plannedTrainingDays') ? v_names[extract(isodow from v_day)::int], false) then continue; end if;
    if exists (select 1 from public.workouts
      where user_id = p_user_id and date = v_day) then continue; end if;
    v_at := (v_day::timestamp + v_time) at time zone v_timezone;
    if p_kind = 'before' then v_at := v_at - interval '1 hour'; end if;
    if v_at <= p_after then continue; end if;
    insert into public.workout_reminder_jobs (user_id, planned_date, kind, scheduled_at, timezone)
      values (p_user_id, v_day, p_kind, v_at, v_timezone)
    on conflict (user_id, planned_date, kind, scheduled_at) do update
      set scheduled_at = excluded.scheduled_at, timezone = excluded.timezone,
          status = 'pending', processed_at = null, notification_id = null
      where public.workout_reminder_jobs.status <> 'sent';
    return;
  end loop;
end;
$$;
revoke all on function private.schedule_next_workout_reminder(uuid,text,timestamptz)
  from public, anon, authenticated;

-- Cancel only undelivered Push. A reminder already sent stays in the Central as history; one whose
-- Push was still queued is archived too, so a stale "hora do treino" never lingers in the bell.
create or replace function private.cancel_workout_reminder_push(p_user_id uuid, p_day date default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'WORKOUT_PLAN_CHANGED'
  from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where d.outbox_id = o.id and o.user_id = p_user_id and d.status = 'pending'
    and n.type::text in ('workout_reminder_before','workout_reminder_start')
    and (p_day is null or n.metadata->>'plannedDate' = p_day::text);
  with cancelled as (
    update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
      last_error = 'WORKOUT_PLAN_CHANGED'
    from public.notifications n where o.notification_id = n.id and o.user_id = p_user_id
      and o.status = 'pending'
      and n.type::text in ('workout_reminder_before','workout_reminder_start')
      and (p_day is null or n.metadata->>'plannedDate' = p_day::text)
    returning o.notification_id
  )
  update public.notifications n set archived_at = coalesce(n.archived_at, now())
  from cancelled c where n.id = c.notification_id and n.read_at is null;
end;
$$;
revoke all on function private.cancel_workout_reminder_push(uuid,date) from public, anon, authenticated;

-- Only fields that affect the schedule reschedule it: saving the same plan again (the RPC always
-- bumps `updatedAt`) must not cancel reminders that are already correct.
create or replace function private.refresh_workout_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['plannedTrainingDays', 'reminderEnabled', 'reminderTime', 'timezone', 'effectiveFrom'];
begin
  if (select jsonb_object_agg(k, old.training_preferences -> k) from unnest(v_keys) k)
     is not distinct from (select jsonb_object_agg(k, new.training_preferences -> k) from unnest(v_keys) k) then
    return new;
  end if;
  update public.workout_reminder_jobs set status = 'cancelled', processed_at = now()
    where user_id = new.id and status = 'pending';
  perform private.cancel_workout_reminder_push(new.id);
  perform private.schedule_next_workout_reminder(new.id, 'before');
  perform private.schedule_next_workout_reminder(new.id, 'start');
  return new;
end;
$$;
revoke all on function private.refresh_workout_reminders() from public, anon, authenticated;
drop trigger if exists users_refresh_workout_reminders on public.users;
create trigger users_refresh_workout_reminders after update of training_preferences on public.users
  for each row when (old.training_preferences is distinct from new.training_preferences)
  execute function private.refresh_workout_reminders();

create or replace function private.cancel_started_workout_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.workout_reminder_jobs set status = 'cancelled', processed_at = now()
    where user_id = new.user_id and planned_date = new.date and status = 'pending';
  perform private.cancel_workout_reminder_push(new.user_id, new.date);
  return new;
end;
$$;
revoke all on function private.cancel_started_workout_reminders() from public, anon, authenticated;
drop trigger if exists workouts_cancel_reminders on public.workouts;
create trigger workouts_cancel_reminders after insert on public.workouts
  for each row execute function private.cancel_started_workout_reminders();
drop trigger if exists workouts_updated_cancel_reminders on public.workouts;
create trigger workouts_updated_cancel_reminders after update of date on public.workouts
  for each row when (old.date is distinct from new.date)
  execute function private.cancel_started_workout_reminders();

create or replace function private.dispatch_due_workout_reminders(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_job public.workout_reminder_jobs;
  v_plan jsonb;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_id bigint;
  v_count integer := 0;
  v_variant integer;
begin
  for v_job in select * from public.workout_reminder_jobs
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at, id limit least(greatest(p_limit, 1), 100) for update skip locked
  loop
    select training_preferences into v_plan from public.users
      where id = v_job.user_id and account_status not in ('disabled','deleting');
    if v_plan is null or coalesce((v_plan->>'reminderEnabled')::boolean, false) is not true
      or v_plan->>'timezone' is distinct from v_job.timezone
      or v_job.planned_date < coalesce((v_plan->>'effectiveFrom')::date, v_job.planned_date)
      or not coalesce((v_plan->'plannedTrainingDays') ? v_names[extract(isodow from v_job.planned_date)::int], false)
      or v_job.scheduled_at < now() - interval '15 minutes'
      or exists (select 1 from public.workouts w where w.user_id = v_job.user_id and w.date = v_job.planned_date)
    then
      update public.workout_reminder_jobs set status = 'skipped', processed_at = now() where id = v_job.id;
    else
      v_id := null;
      -- A data avança a variante: dias consecutivos e semanas seguintes não repetem a frase.
      v_variant := mod((v_job.planned_date - date '2000-01-01')::bigint
        + hashtext(v_job.user_id::text)::bigint + 2147483648
        + case when v_job.kind = 'start' then 3 else 0 end, 6)::int;
      insert into public.notifications (recipient_id, type, priority, entity_type, action_url, metadata, dedupe_key)
      values (v_job.user_id,
        (case when v_job.kind = 'before' then 'workout_reminder_before' else 'workout_reminder_start' end)::public.notification_type,
        'normal', 'weekly_training_plan', '/novo-treino?planejado=' || v_job.planned_date::text,
        jsonb_build_object('plannedDate', v_job.planned_date, 'reminderKind', v_job.kind, 'variant', v_variant),
        'workout-reminder:' || v_job.planned_date::text || ':' || v_job.kind || ':' || extract(epoch from v_job.scheduled_at)::bigint::text)
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from public.notifications
          where recipient_id = v_job.user_id and dedupe_key = 'workout-reminder:' || v_job.planned_date::text || ':' || v_job.kind || ':' || extract(epoch from v_job.scheduled_at)::bigint::text;
      end if;
      update public.workout_reminder_jobs set status = 'sent', processed_at = now(), notification_id = v_id
        where id = v_job.id;
      if v_id is not null then v_count := v_count + 1; end if;
    end if;
    perform private.schedule_next_workout_reminder(v_job.user_id, v_job.kind, greatest(now(), v_job.scheduled_at) + interval '1 second');
  end loop;
  return v_count;
end;
$$;
revoke all on function private.dispatch_due_workout_reminders(integer) from public, anon, authenticated;
grant execute on function private.dispatch_due_workout_reminders(integer) to service_role;

-- Existing plans are seeded once; subsequent changes and dispatch keep two future rows per user.
select private.schedule_next_workout_reminder(id, 'before') from public.users
  where training_preferences->>'reminderEnabled' = 'true';
select private.schedule_next_workout_reminder(id, 'start') from public.users
  where training_preferences->>'reminderEnabled' = 'true';

select cron.schedule('dispatch-workout-reminders', '* * * * *',
  $$select private.dispatch_due_workout_reminders(100)$$);
select cron.schedule('cleanup-workout-reminders', '23 4 * * *',
  $$delete from public.workout_reminder_jobs
      where status <> 'pending' and processed_at < now() - interval '90 days'$$);
