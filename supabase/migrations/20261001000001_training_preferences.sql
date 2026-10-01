-- Plano semanal privado do próprio usuário. A Home já carrega public.users durante a
-- autenticação, então este JSON não cria uma consulta adicional nem é publicado em
-- public_profiles.
alter table public.users
  add column if not exists training_preferences jsonb not null default jsonb_build_object(
    'plannedTrainingDays', '[]'::jsonb,
    'reminderEnabled', false,
    'reminderTime', null,
    'timezone', 'America/Sao_Paulo',
    'effectiveFrom', null,
    'updatedAt', null
  );

create or replace function public.set_training_preferences(payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_days jsonb;
  v_reminder_enabled boolean;
  v_reminder_time text;
  v_timezone text;
  v_effective_from date;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not public.has_app_access() then raise exception 'FORBIDDEN'; end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'INVALID_TRAINING_PREFERENCES';
  end if;

  v_days := payload->'plannedTrainingDays';
  if jsonb_typeof(v_days) is distinct from 'array'
     or jsonb_array_length(v_days) > 7
     or exists (
       select 1 from jsonb_array_elements(v_days) item
       where jsonb_typeof(item) <> 'string'
          or trim(both '"' from item::text) not in
             ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')
     )
     or (select count(*) from jsonb_array_elements_text(v_days)) <>
        (select count(distinct value) from jsonb_array_elements_text(v_days)) then
    raise exception 'INVALID_TRAINING_DAYS';
  end if;

  if jsonb_typeof(payload->'reminderEnabled') is distinct from 'boolean' then
    raise exception 'INVALID_REMINDER';
  end if;
  v_reminder_enabled := (payload->>'reminderEnabled')::boolean;
  v_reminder_time := nullif(payload->>'reminderTime', '');
  if v_reminder_enabled and (v_reminder_time is null or v_reminder_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception 'INVALID_REMINDER_TIME';
  end if;

  v_timezone := nullif(trim(payload->>'timezone'), '');
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;

  begin
    v_effective_from := (payload->>'effectiveFrom')::date;
  exception when others then
    raise exception 'INVALID_EFFECTIVE_DATE';
  end;
  if v_effective_from is null then raise exception 'INVALID_EFFECTIVE_DATE'; end if;

  v_result := jsonb_build_object(
    'plannedTrainingDays', v_days,
    'reminderEnabled', v_reminder_enabled,
    'reminderTime', case when v_reminder_enabled then v_reminder_time else null end,
    'timezone', v_timezone,
    'effectiveFrom', to_char(v_effective_from, 'YYYY-MM-DD'),
    'updatedAt', to_jsonb(now())
  );

  update public.users set training_preferences = v_result where id = auth.uid();
  return v_result;
end;
$$;

-- Todas as alterações de perfil do cliente já usam RPCs SECURITY DEFINER. Remover o
-- privilégio de UPDATE direto impede contornar a validação deste campo via PostgREST.
revoke update on table public.users from anon, authenticated;
revoke all on function public.set_training_preferences(jsonb) from public;
grant execute on function public.set_training_preferences(jsonb) to authenticated;
