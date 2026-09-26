-- Server-side aggregate for workoutsService.getWorkoutStatistics. Deliberately not
-- security definer: RLS on workouts already restricts rows to the caller's own, so
-- this just saves a round trip of raw rows for a count()/sum().
create or replace function public.get_workout_statistics(p_user_id uuid, p_day date default null)
  returns table (entries bigint, sets numeric)
  language sql stable as $$
    select count(*), coalesce(sum(w.sets), 0)
    from public.workouts w
    where w.user_id = p_user_id
      and (p_day is null or w.date = p_day)
$$;

-- Equivalent to publicProfilesService.refreshPublicStatistics(userId): recomputes the
-- caller's own public stats snapshot on demand (manual "atualizar estatísticas" button).
create or replace function public.refresh_public_statistics() returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_entries bigint;
  v_sets numeric;
begin
  select count(*), coalesce(sum(sets), 0) into v_entries, v_sets
    from public.workouts where user_id = auth.uid();

  insert into public.public_profile_statistics (user_id, entries, sets, updated_at)
    values (auth.uid(), v_entries, v_sets, now())
    on conflict (user_id) do update set
      entries = excluded.entries, sets = excluded.sets, updated_at = now();
end;
$$;
