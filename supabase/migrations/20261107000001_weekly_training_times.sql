-- Keep the existing private JSONB plan and RPC. ISO keys 1..7 represent Monday..Sunday.
-- Presence of weeklyTimes, including {}, takes precedence over the legacy global time.
create or replace function public.set_training_preferences(payload jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_days jsonb;
  v_enabled boolean;
  v_legacy text;
  v_timezone text;
  v_effective_from date;
  v_times jsonb;
  v_current jsonb;
  v_result jsonb;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_key text;
  v_value jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_app_access() then raise exception 'FORBIDDEN'; end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'INVALID_TRAINING_PREFERENCES';
  end if;
  v_days := payload->'plannedTrainingDays';
  if jsonb_typeof(v_days) is distinct from 'array'
     or jsonb_array_length(v_days) > 7
     or exists (select 1 from jsonb_array_elements(v_days) item
       where jsonb_typeof(item) <> 'string' or item #>> '{}' <> all(v_names))
     or (select count(*) from jsonb_array_elements_text(v_days)) <>
        (select count(distinct value) from jsonb_array_elements_text(v_days)) then
    raise exception 'INVALID_TRAINING_DAYS';
  end if;
  if jsonb_typeof(payload->'reminderEnabled') is distinct from 'boolean' then
    raise exception 'INVALID_REMINDER';
  end if;
  v_enabled := (payload->>'reminderEnabled')::boolean;
  v_legacy := nullif(payload->>'reminderTime', '');
  if v_legacy is not null and v_legacy !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_REMINDER_TIME';
  end if;
  v_timezone := nullif(trim(payload->>'timezone'), '');
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  begin
    v_effective_from := (payload->>'effectiveFrom')::date;
  exception when others then
    raise exception 'INVALID_EFFECTIVE_DATE';
  end;
  if v_effective_from is null then raise exception 'INVALID_EFFECTIVE_DATE'; end if;

  select training_preferences into v_current from public.users where id = auth.uid() for update;
  if payload ? 'weeklyTimes' then
    v_times := payload->'weeklyTimes';
    if jsonb_typeof(v_times) is distinct from 'object' then
      raise exception 'INVALID_WEEKLY_TIMES';
    end if;
  else
    -- Older clients may still submit a global time. Preserve customized weekly values;
    -- use the legacy time only to initialize newly selected days.
    v_times := case when jsonb_typeof(v_current->'weeklyTimes') = 'object'
      then v_current->'weeklyTimes' else '{}'::jsonb end;
    if v_enabled and v_legacy is null and v_times = '{}'::jsonb then
      raise exception 'INVALID_REMINDER_TIME';
    end if;
    for i in 1..7 loop
      if v_days ? v_names[i] and not v_times ? i::text and v_legacy is not null then
        v_times := v_times || jsonb_build_object(i::text, v_legacy);
      end if;
    end loop;
  end if;
  -- Removing a training day also removes its clock preference.
  for v_key, v_value in select key, value from jsonb_each(v_times) loop
    if v_key !~ '^[1-7]$' or not v_days ? v_names[case when v_key ~ '^[1-7]$' then v_key::int else 1 end]
       or jsonb_typeof(v_value) <> 'string'
       or v_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      if payload ? 'weeklyTimes' then raise exception 'INVALID_WEEKLY_TIME'; end if;
      v_times := v_times - v_key;
    end if;
  end loop;
  v_result := jsonb_build_object(
    'plannedTrainingDays', v_days, 'reminderEnabled', v_enabled,
    'reminderTime', coalesce(v_current->'reminderTime', to_jsonb(v_legacy)),
    'weeklyTimes', v_times, 'timezone', v_timezone,
    'effectiveFrom', to_char(v_effective_from, 'YYYY-MM-DD'), 'updatedAt', to_jsonb(now())
  );
  update public.users set training_preferences = v_result where id = auth.uid();
  return v_result;
end;
$$;
revoke all on function public.set_training_preferences(jsonb) from public, anon;
grant execute on function public.set_training_preferences(jsonb) to authenticated;

create or replace function private.training_time_for_day(p_plan jsonb, p_day date)
returns time language plpgsql stable set search_path = '' as $$
declare
  v_text text;
  v_key text := extract(isodow from p_day)::int::text;
begin
  if jsonb_typeof(p_plan->'weeklyTimes') = 'object' then
    v_text := p_plan->'weeklyTimes'->>v_key;
  else
    v_text := p_plan->>'reminderTime';
  end if;
  if v_text !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then return null; end if;
  return v_text::time;
end;
$$;
revoke all on function private.training_time_for_day(jsonb,date) from public, anon, authenticated;

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
  if coalesce((v_plan->>'reminderEnabled')::boolean, false) is not true then return; end if;
  v_timezone := v_plan->>'timezone';
  if not exists (select 1 from pg_timezone_names where name = v_timezone) then return; end if;
  for i in 0..8 loop
    v_day := (p_after at time zone v_timezone)::date + i;
    if v_day < coalesce((v_plan->>'effectiveFrom')::date, v_day) then continue; end if;
    if not coalesce((v_plan->'plannedTrainingDays') ? v_names[extract(isodow from v_day)::int], false) then continue; end if;
    v_time := private.training_time_for_day(v_plan, v_day);
    if v_time is null then continue; end if;
    if exists (select 1 from public.workouts where user_id = p_user_id and date = v_day) then continue; end if;
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

create or replace function private.refresh_workout_reminders() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[] := array['plannedTrainingDays', 'reminderEnabled', 'reminderTime', 'weeklyTimes', 'timezone', 'effectiveFrom'];
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

-- Backfill only selected weekdays. The trigger safely replaces pending jobs with the
-- same local clock time. Rows without a valid legacy time get an empty object.
update public.users u set training_preferences = u.training_preferences ||
  jsonb_build_object('weeklyTimes', coalesce((
    select jsonb_object_agg(i::text, u.training_preferences->>'reminderTime')
    from generate_series(1, 7) i
    where u.training_preferences->'plannedTrainingDays' ?
      (array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'])[i]
      and u.training_preferences->>'reminderTime' ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  ), '{}'::jsonb))
where jsonb_typeof(u.training_preferences->'weeklyTimes') is distinct from 'object';
