-- Cadastro adulto: não altera documentos históricos, contas ou evidências.
-- Complementa a validação de 18 anos em accept_legal_documents (20261212000001):
-- data de nascimento precisa ser 18+ também em cadastro incompleto e API direta.
-- Regras (dia civil de America/Sao_Paulo, mesma aritmética de age()/calculateAge):
--  * nascida exatamente há 18 anos: aceita; um dia mais nova: MINIMUM_AGE;
--  * texto fora de AAAA-MM-DD, nulo ou vazio: BIRTHDATE_REQUIRED; data inexistente ou > 120 anos:
--    INVALID_BIRTHDATE (a data nunca é apagada por esta RPC);
--  * depois de concluído o perfil (username gravado), a data registrada não pode ser trocada por
--    API direta (BIRTHDATE_LOCKED) -- evita que uma conta preexistente de menor se declare adulta
--    depois para liberar compras. Repetir o mesmo valor é idempotente. Nenhum fluxo do app altera
--    a data após o cadastro; correção passa pelo atendimento.
-- Limite conhecido: supabase.auth.signUp cria a identidade antes desta validação. A identidade sem
-- data 18+ não passa por accept_legal_documents e, portanto, não obtém has_app_access().
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function public.set_birth_info(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_birth date;
  v_current date;
  v_username text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not private.current_session_active() then
    raise exception 'APP_ACCESS_DENIED' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'INVALID_REQUEST';
  end if;

  if payload ? 'dataNascimento' then
    if jsonb_typeof(payload->'dataNascimento') is distinct from 'string'
       or (payload->>'dataNascimento') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'BIRTHDATE_REQUIRED';
    end if;
    begin
      v_birth := (payload->>'dataNascimento')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'INVALID_BIRTHDATE';
    end;
    if v_birth > (v_today - interval '18 years')::date then
      raise exception 'MINIMUM_AGE' using errcode = '22023';
    end if;
    if v_birth < (v_today - interval '120 years')::date then
      raise exception 'INVALID_BIRTHDATE';
    end if;
    -- Serializa chamadas concorrentes do mesmo usuário antes de comparar com o valor atual.
    select data_nascimento, username into v_current, v_username
      from public.users where id = v_uid for update;
    if v_current is not null and v_username is not null and v_current <> v_birth then
      raise exception 'BIRTHDATE_LOCKED' using errcode = '42501';
    end if;
  end if;

  if payload ? 'sexo' then
    if coalesce(payload->>'sexo', '') not in ('masculino', 'feminino', 'nao_informar') then
      raise exception 'INVALID_SEXO';
    end if;
    update public.users set sexo = payload->>'sexo' where id = v_uid;
  end if;
  if payload ? 'dataNascimento' then
    update public.users set data_nascimento = v_birth where id = v_uid;
  end if;
end $$;

revoke all on function public.set_birth_info(jsonb) from public, anon;
grant execute on function public.set_birth_info(jsonb) to authenticated;
