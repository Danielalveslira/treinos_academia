-- P1 fix (auditoria 2026-11-10): em WorkoutSheetsPage ("Minhas fichas"), o botão "Iniciar"
-- aparecia habilitado sempre que exercise_count > 0 -- list_my_workout_sheets() nunca devolvia a
-- disponibilidade real dos itens. TreinarPage e WorkoutSheetDetailPage já resolvem isso hoje (via
-- get_my_sheet_insights()/get_my_workout_sheet(), que calculam a mesma agregação), mas a listagem
-- principal ficava para trás: usuário clicava "Iniciar" numa ficha com exercício retirado do
-- catálogo e só descobria o bloqueio na tela seguinte.
--
-- Correção: list_my_workout_sheets() devolve "available" com a mesma agregação (bool_and por
-- item, coalescida para false numa ficha vazia) já usada em get_my_sheet_insights(). A validação
-- autoritativa de início continua inteiramente em get_my_workout_sheet(p_for_execution=>true) --
-- este campo é só para a lista decidir que ação mostrar, nunca para autorizar o treino.
set local lock_timeout = '5s';

create or replace function public.list_my_workout_sheets(p_archived boolean default false,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order,id),'[]') into result from (
 select s.id,s.name,s.goal,s.weekdays,s.archived_at,s.revision,s.sort_order,
 coalesce(i.exercise_count,0) as exercise_count,
 (select array_agg(distinct e.muscle_group) from public.workout_sheet_exercises i2 join public.exercises e on e.id=i2.exercise_id where i2.sheet_id=s.id) as muscle_groups,
 coalesce(i.available,false) as available
 from public.workout_sheets s
 left join lateral (
   select count(*) exercise_count,bool_and(private.sheet_exercise_available(x.exercise_id,u)) available
   from public.workout_sheet_exercises x where x.sheet_id=s.id
 ) i on true
 where s.user_id=u and s.deleted_at is null and (s.archived_at is not null)=p_archived
 order by s.sort_order,s.id limit 40 offset greatest(0,least(coalesce(p_offset,0),100000))
 ) q; return result;
end $$;
