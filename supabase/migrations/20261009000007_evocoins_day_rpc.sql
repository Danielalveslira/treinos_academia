-- EvoCoins por participação — 7/7: leitura do dia para a UI.
--
-- O cliente nunca calcula quanto ganhou: lê estes três números do servidor. Não expõe regras,
-- valores nem tetos por ação (só o total do dia). 1 leitura por PK; sem polling.
create or replace function public.get_my_evocoin_day() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return private.evocoins_day_snapshot(v_uid) || jsonb_build_object('day', private.sp_today());
end;
$$;

revoke execute on function public.get_my_evocoin_day() from public, anon;
grant execute on function public.get_my_evocoin_day() to authenticated;
