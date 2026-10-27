-- Additive, authenticated aggregate. No per-sheet browser reads or global catalogue.
-- Rollback: roll back the caller first; this read-only function may remain installed.
create function public.get_my_sheet_insights_for_exercise(p_exercise_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.sheet_actor();
  insights jsonb := public.get_my_sheet_insights();
  matches jsonb;
begin
  select coalesce(jsonb_agg(s.sheet order by s.position), '[]'::jsonb) into matches
  from jsonb_array_elements(insights->'sheets') with ordinality s(sheet,position)
  where (s.sheet->>'archived_at') is null
    and (s.sheet->>'available')::boolean
    and (s.sheet->>'exercise_count')::int > 0
    and exists (
      select 1 from public.workout_sheet_exercises x
      join public.workout_sheets w on w.id=x.sheet_id
      where w.user_id=u and w.id=(s.sheet->>'id')::uuid
        and x.exercise_id=p_exercise_id
    );
  return jsonb_build_object('today',insights->'today','sheets',matches);
end $$;
revoke all on function public.get_my_sheet_insights_for_exercise(uuid) from public,anon,authenticated;
grant execute on function public.get_my_sheet_insights_for_exercise(uuid) to authenticated;
