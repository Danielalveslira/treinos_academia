-- Operational rollback: this migration only adds an "available" field to an existing, widely used
-- RPC (revoking EXECUTE would break "Minhas fichas" entirely, far beyond what needs reverting).
-- Restores list_my_workout_sheets() to the exact body from 20261215000001 (no availability field).
begin;
create or replace function public.list_my_workout_sheets(p_archived boolean default false,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order,id),'[]') into result from (
 select s.id,s.name,s.goal,s.weekdays,s.archived_at,s.revision,s.sort_order,
 (select count(*) from public.workout_sheet_exercises i where i.sheet_id=s.id) as exercise_count,
 (select array_agg(distinct e.muscle_group) from public.workout_sheet_exercises i join public.exercises e on e.id=i.exercise_id where i.sheet_id=s.id) as muscle_groups
 from public.workout_sheets s where s.user_id=u and s.deleted_at is null and (s.archived_at is not null)=p_archived
 order by s.sort_order,s.id limit 40 offset greatest(0,least(coalesce(p_offset,0),100000))
 ) q; return result;
end $$;
commit;
