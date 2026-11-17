-- Root cause: get_my_workout_sheet and list_my_workout_sheets projected an exercise's name,
-- muscle group and type straight from the per-user snapshot columns on public.exercises --
-- captured once when the user added the exercise, never touched again. When the superadmin
-- publishes a corrected name/muscle/category on exercise_catalog, every reader that resolves the
-- exercise through exercise_catalog (the catalog browser, the exercise detail modal via
-- useExerciseCatalogDetail) shows the new value immediately; every reader that only reads
-- public.exercises (fichas, their editor, the execution screen, the personal library list) kept
-- showing what was true at add-time. Same catalog_id/provider/provider_exercise_id references
-- already existed; nothing here changes an id or copies official data into a new column. No
-- mass update, no trigger over personal rows: the fix is a plain LEFT JOIN read at query time,
-- the same join private.sheet_exercise_available and save_workout_sheet already use for
-- availability/category validation (provider+provider_exercise_id, catalog_id as tie-breaker,
-- requires status='published'). A legacy exercise with no catalog match (old ExerciseAPI import,
-- or the match no longer published) simply falls back to its own stored snapshot, exactly as
-- before -- COALESCE, never an association by name similarity.
set local lock_timeout = '5s';

create or replace function public.get_my_workout_sheet(p_sheet_id uuid, p_for_execution boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); s public.workout_sheets; items jsonb;
begin
 select * into s from public.workout_sheets where id = p_sheet_id and user_id = u and deleted_at is null;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
   'available', private.sheet_exercise_available(e.id, u),
   'exercise', jsonb_build_object(
     'id', e.id,
     'name', coalesce(c.name, e.name),
     'muscleGroup', coalesce(c.primary_muscle, e.muscle_group),
     'type', case when c.id is not null then (case when c.category = 'cardio' then 'cardio' else 'strength' end) else e.type end,
     'source', e.source, 'active', e.active,
     'provider', e.provider, 'providerExerciseId', e.provider_exercise_id, 'catalogId', e.catalog_id,
     -- Explicit, read-only signal: the official category changed to/from cardio after this
     -- target was recorded under the previous shape. Never rewritten or blocked here --
     -- save_workout_sheet already enforces the live shape on the next real save; this only lets
     -- the editor explain a confusing SHEET_INVALID_TARGET instead of preserving the old target
     -- silently, keeping the user fully informed.
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
 if p_for_execution and (s.archived_at is not null or jsonb_array_length(items) = 0 or exists(select 1 from jsonb_array_elements(items) x where not (x->>'available')::boolean)) then raise exception 'SHEET_NOT_READY'; end if;
 return to_jsonb(s) || jsonb_build_object('items', items);
end $$;

create or replace function public.list_my_workout_sheets(p_archived boolean default false, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order, id), '[]') into result from (
 select s.id, s.name, s.goal, s.weekdays, s.archived_at, s.revision, s.sort_order,
 coalesce(i.exercise_count, 0) as exercise_count,
 (select array_agg(distinct coalesce(c.primary_muscle, e.muscle_group))
   from public.workout_sheet_exercises i2
   join public.exercises e on e.id = i2.exercise_id
   left join public.exercise_catalog c on c.provider = e.provider and c.provider_exercise_id = e.provider_exercise_id
     and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
   where i2.sheet_id = s.id) as muscle_groups,
 coalesce(i.available, false) as available
 from public.workout_sheets s
 left join lateral (
   select count(*) exercise_count, bool_and(private.sheet_exercise_available(x.exercise_id, u)) available
   from public.workout_sheet_exercises x where x.sheet_id = s.id
 ) i on true
 where s.user_id = u and s.deleted_at is null and (s.archived_at is not null) = p_archived
 order by s.sort_order, s.id limit 40 offset greatest(0, least(coalesce(p_offset, 0), 100000))
 ) q; return result;
end $$;
