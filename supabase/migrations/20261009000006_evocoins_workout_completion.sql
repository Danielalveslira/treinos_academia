-- EvoCoins por participação — 6/7: marcador seguro de "treino concluído".
--
-- Hoje cada exercício é uma linha em workouts, inserida direto pelo app, e não existia nenhum
-- evento de conclusão. workouts.date vem do cliente e NÃO serve de prova. O marcador mínimo:
--   1. workouts.created_at passa a ser sempre o relógio do servidor para inserts de cliente
--      (hoje o cliente poderia enviá-lo). Já era imutável em UPDATE;
--   2. complete_workout_session() é o evento de conclusão: roda no servidor, usa só created_at
--      (relógio do servidor) para decidir o que é "de hoje" e paga no máximo uma vez por dia.
-- O conteúdo do treino continua autodeclarado -- o que se garante é: carimbo do servidor, esforço
-- mínimo registrado hoje, uma recompensa/dia e o teto global. Limiar de esforço só no servidor.

create or replace function private.workouts_server_created_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Cliente (auth.uid() presente) nunca decide created_at. Seeds/import (service role, sem
  -- sessão de usuário) continuam podendo informar o próprio carimbo.
  if (select auth.uid()) is not null then
    new.created_at := now();
  end if;
  return new;
end;
$$;
revoke all on function private.workouts_server_created_at() from public, anon, authenticated;

create trigger workouts_server_created_at before insert on public.workouts
  for each row execute function private.workouts_server_created_at();

-- Pontos de esforço do dia: série de força = 1 por exercício registrado; cardio >= 15 min = 3
-- (cardio curto = 1). São necessários 3 pontos. Conta só o que foi registrado HOJE pelo relógio do
-- servidor E é datado de hoje (data do cliente só como filtro de coerência, nunca como prova:
-- registrar treinos antigos hoje não paga).
create or replace function public.complete_workout_session() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := private.sp_today();
  v_points integer;
  v_award jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  -- has_app_access() devolve NULL (não false) quando os termos não foram aceitos: sempre coalesce.
  if not coalesce(public.has_app_access(), false) then raise exception 'APP_ACCESS_DENIED'; end if;

  select coalesce(sum(case when w.type = 'cardio' and w.duration_minutes >= 15 then 3 else 1 end), 0)
    into v_points
    from public.workouts w
    where w.user_id = v_uid
      and w.date = v_day
      and w.created_at >= (v_day::timestamp at time zone 'America/Sao_Paulo')
      and w.created_at < ((v_day + 1)::timestamp at time zone 'America/Sao_Paulo');

  if v_points < 3 then
    return jsonb_build_object('awardedCoins', 0, 'reason', 'not_enough_activity')
      || private.evocoins_day_snapshot(v_uid);
  end if;

  v_award := private.award_evocoins(v_uid, 'workout_completed', 'workout:' || v_day::text, 'workout_day', v_day::text);
  return v_award;
end;
$$;

revoke execute on function public.complete_workout_session() from public, anon;
grant execute on function public.complete_workout_session() to authenticated;
