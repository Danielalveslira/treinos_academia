-- Porta progressService.js pra Supabase. O original (listProgressDays) só LÊ
-- users/{uid}/progressDaily/{dateKey}, um resumo diário mantido por um trigger
-- (onWorkoutWritten -> rebuildProgressDay, functions/progress-daily-service.js) que
-- recalcula o dia inteiro a cada escrita em workouts -- porque o Firestore não agrega
-- em tempo de consulta. Postgres agrega, então a tabela denormalizada e o trigger somem:
-- esta RPC calcula os mesmos campos (mesmas fórmulas de progress-daily-core.js, incl.
-- Epley pra estimated1RMKg) direto de public.workouts, por período, sem estado
-- intermediário pra manter sincronizado.
--
-- has_app_access() (não só auth.uid() is null) porque workouts_all/exercises_all já
-- bloqueiam até leitura via RLS nesse mesmo caso (termos não aceitos, restrição ativa,
-- conta desabilitada) -- esta função é security definer e ignora RLS internamente, então
-- precisa repetir a mesma checagem pra não abrir uma leitura que a tabela em si negaria.
create or replace function public.list_progress_days(p_start date, p_end date) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_app_access() then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'INVALID_RANGE'; end if;

  with w as (
    select id, date, exercise_id, type, duration_minutes, distance_km, set_details
    from public.workouts
    where user_id = v_uid and date between p_start and p_end
  ),
  flat_sets as (
    select w.date, w.exercise_id,
           (elem->>'weight')::numeric as weight, (elem->>'reps')::numeric as reps
    from w
    cross join lateral jsonb_array_elements(coalesce(w.set_details, '[]'::jsonb)) elem
    where w.type = 'strength'
  ),
  -- Réplica por-set do que summarizeDailyWorkouts acumula por exercício: volume/sets/
  -- reps somados, e o "melhor set" (maior peso; empate quebrado por mais reps -- mesma
  -- regra de current.maxWeightKg/repsAtMaxWeight no original) via array_agg ordenado.
  ex_sets as (
    select date, exercise_id,
      sum(weight * reps) as strength_volume_kg,
      count(*) as strength_sets,
      sum(reps) as strength_reps,
      max(weight) as max_weight_kg,
      (array_agg(reps order by weight desc, reps desc))[1] as reps_at_max_weight,
      max(weight * reps) as best_set_volume_kg,
      max(case when weight > 0 and reps between 1 and 12 then weight * (1 + reps / 30.0) else 0 end) as estimated_1rm_kg
    from flat_sets
    group by date, exercise_id
  ),
  ex_workouts as (
    select date, exercise_id,
      count(*) as workout_count,
      sum(duration_minutes) filter (where type = 'cardio') as cardio_minutes,
      sum(distance_km) filter (where type = 'cardio') as cardio_distance_km
    from w
    group by date, exercise_id
  ),
  exercise_stats as (
    select
      ew.date, ew.exercise_id, ew.workout_count,
      coalesce(es.strength_volume_kg, 0) as strength_volume_kg,
      coalesce(es.strength_sets, 0) as strength_sets,
      coalesce(es.strength_reps, 0) as strength_reps,
      coalesce(es.max_weight_kg, 0) as max_weight_kg,
      coalesce(es.reps_at_max_weight, 0) as reps_at_max_weight,
      coalesce(es.best_set_volume_kg, 0) as best_set_volume_kg,
      coalesce(es.estimated_1rm_kg, 0) as estimated_1rm_kg,
      coalesce(ew.cardio_minutes, 0) as cardio_minutes,
      coalesce(ew.cardio_distance_km, 0) as cardio_distance_km
    from ex_workouts ew
    left join ex_sets es on es.date = ew.date and es.exercise_id = ew.exercise_id
  ),
  day_summary as (
    select date,
      sum(workout_count) as workout_count,
      sum(strength_volume_kg) as strength_volume_kg,
      sum(strength_sets) as strength_sets,
      sum(strength_reps) as strength_reps,
      sum(cardio_minutes) as cardio_minutes,
      sum(cardio_distance_km) as cardio_distance_km
    from exercise_stats
    group by date
  ),
  day_exercise_stats as (
    select date, jsonb_agg(jsonb_build_object(
      'exerciseId', exercise_id,
      'workoutCount', workout_count,
      'strengthVolumeKg', strength_volume_kg,
      'strengthSets', strength_sets,
      'strengthReps', strength_reps,
      'maxWeightKg', max_weight_kg,
      'repsAtMaxWeight', reps_at_max_weight,
      'bestSetVolumeKg', best_set_volume_kg,
      'estimated1RMKg', estimated_1rm_kg,
      'cardioMinutes', cardio_minutes,
      'cardioDistanceKm', cardio_distance_km
    ) order by exercise_id) as stats
    from exercise_stats
    group by date
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', to_char(d.date, 'YYYY-MM-DD'),
    'dateKey', to_char(d.date, 'YYYY-MM-DD'),
    'workoutCount', d.workout_count,
    'strengthVolumeKg', d.strength_volume_kg,
    'strengthSets', d.strength_sets,
    'strengthReps', d.strength_reps,
    'cardioMinutes', d.cardio_minutes,
    'cardioDistanceKm', d.cardio_distance_km,
    'active', d.workout_count > 0,
    'exerciseStats', coalesce(des.stats, '[]'::jsonb)
  ) order by d.date), '[]'::jsonb)
  into v_result
  from day_summary d
  left join day_exercise_stats des on des.date = d.date;

  return v_result;
end;
$$;
