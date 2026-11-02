-- Resumo exclusivo de Progresso; não altera o contrato de list_progress_days.
create or replace function public.get_my_progress_sheet_summary(p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366 then
    raise exception 'INVALID_RANGE';
  end if;

  with activity as (
    select w.sheet_id, w.date, count(*)::int records,
      count(*) filter (where w.exercise_completed or w.type = 'cardio'
        or (w.type = 'strength' and w.sets >= coalesce(x.target_sets, 3)))::int completed_records
    from public.workouts w
    left join public.workout_sheet_exercises x
      on x.sheet_id = w.sheet_id and x.exercise_id = w.exercise_id and x.user_id = actor
    where w.user_id = actor and w.date between p_start and p_end
    group by w.sheet_id, w.date
  ), sheet_activity as (
    select a.sheet_id, s.name, count(*)::int trained_days,
      sum(a.records)::int exercise_records,
      sum(a.completed_records)::int completed_exercises
    from activity a join public.workout_sheets s
      on s.id = a.sheet_id and s.user_id = actor
    where a.sheet_id is not null
    group by a.sheet_id, s.name
  ), completion as (
    select c.sheet_id, count(*)::int completed_days
    from public.workout_sheet_completions c
    where c.user_id = actor and c.business_day between p_start and p_end
    group by c.sheet_id
  ), per_sheet as (
    select s.sheet_id, s.name, s.trained_days, s.exercise_records,
      s.completed_exercises, coalesce(c.completed_days, 0) completed_days
    from sheet_activity s left join completion c on c.sheet_id = s.sheet_id
  )
  select jsonb_build_object(
    'trainedOccurrences', coalesce(sum(trained_days), 0),
    'completedOccurrences', coalesce(sum(completed_days), 0),
    'distinctSheets', count(*),
    'exerciseRecords', (select coalesce(sum(records), 0) from activity),
    'completedExercises', (select coalesce(sum(completed_records), 0) from activity),
    'sheets', coalesce(jsonb_agg(jsonb_build_object(
      'id', sheet_id, 'name', name, 'trainedDays', trained_days,
      'completedDays', completed_days, 'exerciseRecords', exercise_records,
      'completedExercises', completed_exercises
    ) order by trained_days desc, name, sheet_id), '[]'::jsonb)
  ) into result from per_sheet;
  return result;
end $$;
revoke all on function public.get_my_progress_sheet_summary(date,date) from public, anon, authenticated;
grant execute on function public.get_my_progress_sheet_summary(date,date) to authenticated;

-- Uma validação em servidor para a escrita atômica existente, sem tocar no corpo da RPC.
create or replace function private.validate_body_check_in_payload()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.date at time zone 'America/Sao_Paulo')::date > (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'INVALID_DATE';
  end if;
  if new.weight_kg is not null and (new.weight_kg <= 0 or new.weight_kg > 400)
    or new.body_fat_percent is not null and (new.body_fat_percent <= 0 or new.body_fat_percent > 70)
    or new.abdomen_cm is not null and (new.abdomen_cm <= 0 or new.abdomen_cm > 300)
    or new.waist_cm is not null and (new.waist_cm <= 0 or new.waist_cm > 200)
    or new.hip_cm is not null and (new.hip_cm <= 0 or new.hip_cm > 200)
    or new.chest_cm is not null and (new.chest_cm <= 0 or new.chest_cm > 300)
    or new.arm_cm is not null and (new.arm_cm <= 0 or new.arm_cm > 200)
    or new.thigh_cm is not null and (new.thigh_cm <= 0 or new.thigh_cm > 200)
    or new.calf_cm is not null and (new.calf_cm <= 0 or new.calf_cm > 200)
    or new.lean_mass_kg is not null and (new.lean_mass_kg <= 0 or new.lean_mass_kg > 300)
    or new.fat_mass_kg is not null and (new.fat_mass_kg <= 0 or new.fat_mass_kg > 300) then
    raise exception 'INVALID_MEASUREMENT';
  end if;
  return new;
end $$;
create trigger validate_body_check_in_before_insert before insert on public.body_measurements
for each row execute function private.validate_body_check_in_payload();

alter table public.body_measurements add constraint body_measurements_has_value
check (num_nonnulls(weight_kg, body_fat_percent, abdomen_cm, waist_cm, hip_cm,
  chest_cm, arm_cm, thigh_cm, calf_cm, lean_mass_kg, fat_mass_kg) > 0) not valid;
