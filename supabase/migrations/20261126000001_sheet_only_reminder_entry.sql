-- Forward-only: change only new reminder destinations; existing notifications remain valid.
-- Rollback: restore the previous function definition; never update/delete jobs or notifications.
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
      v_variant := ((v_job.planned_date - date '2000-01-01')::bigint + (abs(hashtext(v_job.user_id::text)) % 997))::int;
      insert into public.notifications (recipient_id, type, priority, entity_type, action_url, metadata, dedupe_key)
      values (v_job.user_id,
        (case when v_job.kind = 'before' then 'workout_reminder_before' else 'workout_reminder_start' end)::public.notification_type,
        'normal', 'weekly_training_plan', '/treinar?planejado=' || v_job.planned_date::text,
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
