-- Descanso padrão entre séries, escolhido pelo próprio usuário (cronômetro de descanso do registro de séries).
--
-- Por que uma coluna e não uma chave em training_preferences: set_training_preferences RECONSTRÓI o JSON
-- inteiro só com as chaves do plano semanal a cada gravação — uma chave extra seria apagada sempre que o
-- plano fosse salvo. Mesmo molde de greeting_voice (20261024000001): coluna em public.users, lida junto com a
-- linha que a autenticação já carrega (ensure_user_profile devolve a linha inteira; o canal Realtime do
-- perfil também), portanto nenhuma consulta nova e sincronização entre aparelhos sem código extra.
--
--   default_rest_seconds  null = sem preferência (o cliente usa o padrão do sistema, 90s);
--                         0 = descanso desativado; 1–900 = segundos. Mesma faixa de
--                         workout_sheet_exercises.rest_seconds.
--
-- Fichas não são alteradas: rest_seconds nulo (nunca houve default no banco nem no editor) passa a significar
-- "usar o padrão do usuário"; qualquer valor gravado (inclusive 0) continua sendo escolha explícita.
-- Escrita só pela RPC abaixo; o UPDATE direto em public.users continua revogado (20261001000001) e o SELECT
-- continua restrito ao próprio usuário (policy users_select). RLS/grants existentes não mudam.

alter table public.users
  add column if not exists default_rest_seconds smallint;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.users'::regclass and conname = 'users_default_rest_seconds_check'
  ) then
    alter table public.users
      add constraint users_default_rest_seconds_check
      check (default_rest_seconds is null or default_rest_seconds between 0 and 900);
  end if;
end $$;

-- Define a preferência (0–900, inteiro). Repetir o valor atual não escreve nada (sem evento Realtime à toa).
create or replace function public.set_default_rest_seconds(p_seconds integer) returns integer
  language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'FORBIDDEN'; end if;
  if p_seconds is null or p_seconds < 0 or p_seconds > 900 then
    raise exception 'INVALID_REST_SECONDS';
  end if;

  update public.users
     set default_rest_seconds = p_seconds
   where id = v_uid
     and default_rest_seconds is distinct from p_seconds;

  return p_seconds;
end;
$$;

revoke all on function public.set_default_rest_seconds(integer) from public, anon;
grant execute on function public.set_default_rest_seconds(integer) to authenticated;
