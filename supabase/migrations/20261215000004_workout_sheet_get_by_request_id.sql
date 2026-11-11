-- P0 fix (continuação da auditoria, 2026-11-10): WorkoutSheetEditorPage recupera uma ficha em
-- conflito via getWorkoutSheet(sheet.id) -- mas para uma ficha ainda em CRIAÇÃO, sheet.id nunca
-- existe no estado local (o formulário não navegou ainda; só chegou a confirmação seria o que
-- define o id). Um SHEET_VERSION_CONFLICT vindo de create_workout_sheet() (ver 20261215000002:
-- uma retentativa cujo recibo diverge da revisão real, porque outra aba editou no meio) não tinha
-- como ser recuperado -- getWorkoutSheet(undefined) nunca acha a ficha certa.
--
-- RPC mínima: resolve a ficha pelo create_request_id, com a MESMA autorização/posse/sessão de
-- sheet_actor() e delega inteiramente para get_my_workout_sheet() (mesmo formato, mesma regra de
-- "ficha excluída = SHEET_NOT_FOUND") -- nenhuma lógica de leitura duplicada, nenhuma exposição
-- de dado além do que a ficha normal já expõe ao dono.
set local lock_timeout = '5s';

create function public.get_my_workout_sheet_by_request_id(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); s public.workout_sheets;
begin
  if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
  select * into s from public.workout_sheets
    where user_id = u and create_request_id = p_request_id and deleted_at is null;
  if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
  return public.get_my_workout_sheet(s.id);
end $$;
revoke all on function public.get_my_workout_sheet_by_request_id(uuid) from public, anon, authenticated;
grant execute on function public.get_my_workout_sheet_by_request_id(uuid) to authenticated;
