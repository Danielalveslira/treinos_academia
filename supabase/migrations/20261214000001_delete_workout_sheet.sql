-- Exclusão física e definitiva de uma ficha própria. workouts preserva sheet_id=null via
-- FK ON DELETE SET NULL (sheet_id) já existente (20261123000001_workout_sheet_attribution),
-- que nunca toca user_id/demais colunas; enforce_workout_immutable_fields() já permite
-- exatamente essa transição quando a ficha-pai deixou de existir. workout_sheet_exercises
-- e workout_sheet_completions somem via ON DELETE CASCADE já declarado em suas migrations
-- de origem. Nenhuma lógica extra de notificações é necessária: private.planned_sheets_for_day
-- (20261210000001) lê workout_sheets ao vivo no momento do despacho.
set local lock_timeout = '5s';

create function public.delete_workout_sheet(p_sheet_id uuid, p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  u uuid := private.sheet_actor();
  s public.workout_sheets;
begin
  -- Mesma serialização por conta das demais RPCs de ficha (create/duplicate/archive).
  perform 1 from public.users where id = u for update;
  select * into s from public.workout_sheets where id = p_sheet_id and user_id = u for update;
  if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
  if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
  delete from public.workout_sheets where id = s.id;
  return jsonb_build_object('id', s.id, 'deleted', true);
end $$;
revoke all on function public.delete_workout_sheet(uuid, bigint) from public, anon, authenticated;
grant execute on function public.delete_workout_sheet(uuid, bigint) to authenticated;
