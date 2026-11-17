-- Operational groups follow the same catalog taxonomy used by the personal library.
-- Specific muscles remain on the catalog detail; personal snapshots and history stay intact.
set local lock_timeout = '5s';
create function private.catalog_personal_muscle_group(p_category text, p_primary text) returns text
language sql immutable security definer set search_path = '' as $$
  select case when p_category = 'cardio' then 'Cardio' else
    case lower(p_primary)
      when 'abdominais' then 'Abdômen'
      when 'abdutores' then 'Pernas'
      when 'adutores' then 'Pernas'
      when 'antebracos' then 'Antebraços'
      when 'biceps' then 'Bíceps'
      when 'dorsais' then 'Costas'
      when 'gluteos' then 'Glúteos'
      when 'inferior-das-costas' then 'Costas'
      when 'isquiotibiais' then 'Pernas'
      when 'meio-das-costas' then 'Costas'
      when 'ombros' then 'Ombros'
      when 'panturrilhas' then 'Panturrilha'
      when 'peito' then 'Peito'
      when 'pescoco' then 'Pescoço'
      when 'quadriceps' then 'Pernas'
      when 'trapezio' then 'Costas'
      when 'triceps' then 'Tríceps'
      when 'chest' then 'Peito'
      when 'back' then 'Costas'
      when 'shoulders' then 'Ombros'
      when 'legs' then 'Pernas'
      when 'arms' then 'Bíceps'
      when 'core' then 'Abdômen'
      when 'glutes' then 'Glúteos'
      when 'calves' then 'Panturrilha'
      else 'Outros'
    end end
$$;
revoke all on function private.catalog_personal_muscle_group(text,text)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_workout_sheet(p_sheet_id uuid, p_for_execution boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); s public.workout_sheets; items jsonb;
begin
 select * into s from public.workout_sheets where id = p_sheet_id and user_id = u and deleted_at is null;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
   'available', e.active and e.source = 'catalog'
     and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null,
   'exercise', jsonb_build_object(
     'id', e.id,
     'name', coalesce(c.name, e.name),
     'muscleGroup', case when c.id is not null then private.catalog_personal_muscle_group(c.category, c.primary_muscle) else e.muscle_group end,
     'type', case when c.id is not null then (case when c.category = 'cardio' then 'cardio' else 'strength' end) else e.type end,
     'source', e.source, 'active', e.active,
     'provider', e.provider, 'providerExerciseId', e.provider_exercise_id, 'catalogId', e.catalog_id,
     -- Explicit, read-only signal: the official category changed to/from cardio after this
     -- target was recorded under the previous shape. The stored target stays untouched;
     -- execution is blocked below until the editor resolves the incompatibility.
     'typeMismatch', c.id is not null and (
       (c.category = 'cardio' and (i.target_sets is not null or i.reps_min is not null or i.reps_max is not null))
       or (c.category <> 'cardio' and (i.target_duration_minutes is not null or i.target_distance_km is not null))
     )
   )) order by i.sort_order, i.id), '[]') into items
 from public.workout_sheet_exercises i
 join public.exercises e on e.id = i.exercise_id and e.user_id = u
 left join public.exercise_catalog c on c.provider = e.provider and c.provider_exercise_id = e.provider_exercise_id
   and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
 where i.sheet_id = s.id;
 if p_for_execution and (s.archived_at is not null or jsonb_array_length(items) = 0 or exists(select 1 from jsonb_array_elements(items) x where not (x->>'available')::boolean or coalesce((x->'exercise'->>'typeMismatch')::boolean, false))) then raise exception 'SHEET_NOT_READY'; end if;
 return to_jsonb(s) || jsonb_build_object('items', items);
end $$;

-- One aggregate per sheet supplies both the live muscle groups and the readiness flag.
-- The already joined catalog row also detects incompatible targets, without a function
-- lookup for each individual exercise in the list.
create or replace function public.list_my_workout_sheets(p_archived boolean default false, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order, id), '[]') into result from (
 select s.id, s.name, s.goal, s.weekdays, s.archived_at, s.revision, s.sort_order,
   coalesce(i.exercise_count, 0) as exercise_count, i.muscle_groups,
   coalesce(i.available, false) as available
 from public.workout_sheets s
 left join lateral (
   select count(*) exercise_count,
     array_agg(distinct case when c.id is not null then private.catalog_personal_muscle_group(c.category, c.primary_muscle) else e.muscle_group end) muscle_groups,
     bool_and(e.active and e.source = 'catalog'
       and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null
       and not (c.category = 'cardio' and
         (x.target_sets is not null or x.reps_min is not null or x.reps_max is not null))
       and not (c.category <> 'cardio' and
         (x.target_duration_minutes is not null or x.target_distance_km is not null))) available
   from public.workout_sheet_exercises x
   join public.exercises e on e.id = x.exercise_id and e.user_id = u
   left join public.exercise_catalog c on c.provider = e.provider
     and c.provider_exercise_id = e.provider_exercise_id
     and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
   where x.sheet_id = s.id
 ) i on true
 where s.user_id = u and s.deleted_at is null and (s.archived_at is not null) = p_archived
 order by s.sort_order, s.id limit 40 offset greatest(0, least(coalesce(p_offset, 0), 100000))
 ) q; return result;
end $$;


-- Home and the exercise picker use the same readiness decision as the sheet list.
create or replace function public.get_my_sheet_insights() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); today date:=private.sp_today(); result jsonb;
begin
  with activity as materialized (
    select s.id sheet_id,a.date last_date,a.created_at last_registered_at,m.month_days
    from public.workout_sheets s
    left join lateral (
      select w.date,w.created_at from public.workouts w
      where w.user_id=u and w.sheet_id=s.id and w.date<=today
      order by w.date desc,w.created_at desc limit 1
    ) a on true
    left join lateral (
      select count(distinct w.date)::int month_days from public.workouts w
      where w.user_id=u and w.sheet_id=s.id
      and w.date>=date_trunc('month',today)::date and w.date<=today
    ) m on true where s.user_id=u and s.deleted_at is null
  ), summaries as materialized (
    select s.id,s.name,s.goal,s.weekdays,s.sort_order,s.archived_at,
      coalesce(i.exercise_count,0) exercise_count,coalesce(i.available,false) available,
      a.last_date,a.last_registered_at,coalesce(a.month_days,0) month_days,
      exists(select 1 from public.workout_sheet_completions c
        where c.user_id=u and c.sheet_id=s.id and c.business_day=today) completed_today
    from public.workout_sheets s left join activity a on a.sheet_id=s.id
    left join lateral (
      select count(*) exercise_count,
        bool_and(e.active and e.source = 'catalog'
          and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null
          and not (c.category = 'cardio' and
            (x.target_sets is not null or x.reps_min is not null or x.reps_max is not null))
          and not (c.category <> 'cardio' and
            (x.target_duration_minutes is not null or x.target_distance_km is not null))) available
      from public.workout_sheet_exercises x
      join public.exercises e on e.id = x.exercise_id and e.user_id = u
      left join public.exercise_catalog c on c.provider = e.provider
        and c.provider_exercise_id = e.provider_exercise_id
        and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
      where x.sheet_id = s.id
    ) i on true where s.user_id=u and s.deleted_at is null
  ), selected as (
    (select * from summaries where archived_at is null order by sort_order,id limit 40)
    union
    (select * from summaries where last_date is not null order by last_date desc,last_registered_at desc,sort_order,id limit 1)
    union
    (select * from summaries where month_days>0 order by month_days desc,last_date desc,last_registered_at desc,sort_order,id limit 1)
  ) select jsonb_build_object('today',today,'sheets',coalesce(jsonb_agg(to_jsonb(selected) order by sort_order,id),'[]'))
    into result from selected;
  return result;
end $$;
