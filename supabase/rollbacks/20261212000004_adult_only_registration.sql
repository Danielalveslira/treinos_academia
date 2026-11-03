-- Rollback de 20261212000004: restaura set_birth_info pré-restrição 18+.
-- Não modifica ou exclui contas, datas de nascimento ou evidências.
-- CUIDADO: volta a permitir registrar datas de menores; aceitar termos ainda
-- depende da idade mínima 18+ (20261212000001), que não deve ser revertida
-- sem decisão expressa.
create or replace function public.set_birth_info(payload jsonb) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if payload ? 'sexo' then
    if coalesce(payload->>'sexo', '') not in ('masculino', 'feminino', 'nao_informar') then
      raise exception 'INVALID_SEXO';
    end if;
    update public.users set sexo = payload->>'sexo' where id = auth.uid();
  end if;
  if payload ? 'dataNascimento' then
    update public.users set data_nascimento = case
      when coalesce(payload->>'dataNascimento', '') = '' then null
      else (payload->>'dataNascimento')::date
    end where id = auth.uid();
  end if;
end $$;

revoke all on function public.set_birth_info(jsonb) from public, anon;
grant execute on function public.set_birth_info(jsonb) to authenticated;
