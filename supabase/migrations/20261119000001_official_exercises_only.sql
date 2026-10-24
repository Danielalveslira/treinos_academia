-- Fase 3: only official exercises can be added; existing rows and history are untouched.
set local lock_timeout = '5s';

create or replace function public._guard_personal_exercise_write() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- RLS still applies to callers. This narrow exemption supports trusted imports/test fixtures
  -- with NO end-user JWT; a PostgREST authenticated caller cannot choose its database role.
  if auth.uid() is null and current_setting('role', true) in ('none','postgres','supabase_admin','service_role') then return new; end if;
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if new.user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.source is distinct from 'catalog' then
      raise exception 'CUSTOM_EXERCISES_DISABLED' using errcode = 'P0001';
    end if;
  elsif (to_jsonb(new) - array['note','active','order','updated_at'])
        is distinct from (to_jsonb(old) - array['note','active','order','updated_at']) then
    raise exception 'EXERCISE_IDENTITY_IMMUTABLE' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public._guard_personal_exercise_write() from public, anon, authenticated;
create trigger exercises_guard_personal_write before insert or update on public.exercises
for each row execute function public._guard_personal_exercise_write();

-- Keep exercises_all RLS (ownership + has_app_access, which checks the active session),
-- the unique (user, provider, external id) index, FK RESTRICT for workouts, and existing triggers.
create or replace function public._validate_catalog_exercise_reference() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_catalog public.exercise_catalog;
begin
  select * into v_catalog from public.exercise_catalog
    where provider = new.provider and provider_exercise_id = new.provider_exercise_id for share;

  if v_catalog.id is null or v_catalog.status <> 'published' then
    raise exception 'catalog_exercise_unavailable' using errcode = 'P0001';
  end if;
  if new.catalog_id is not null and new.catalog_id <> v_catalog.id then
    raise exception 'catalog_exercise_unavailable' using errcode = 'P0001';
  end if;
  -- INSERT snapshots come from the official row, never the supplied metadata.
  -- UPDATE is restricted by exercises_guard_personal_write below.
  new.catalog_id := v_catalog.id;
  if tg_op = 'INSERT' then
    new.name := v_catalog.name;
    new.type := case when v_catalog.category = 'cardio' then 'cardio' else 'strength' end;
    new.equipment := v_catalog.equipment;
    new.muscle_group := case when v_catalog.category = 'cardio' then 'Cardio' else
      case lower(v_catalog.primary_muscle)
        when 'peito' then 'Peito' when 'chest' then 'Peito'
        when 'dorsais' then 'Costas' when 'inferior-das-costas' then 'Costas'
        when 'meio-das-costas' then 'Costas' when 'trapezio' then 'Costas' when 'back' then 'Costas'
        when 'abdutores' then 'Pernas' when 'adutores' then 'Pernas' when 'isquiotibiais' then 'Pernas'
        when 'quadriceps' then 'Pernas' when 'legs' then 'Pernas'
        when 'ombros' then 'Ombros' when 'shoulders' then 'Ombros'
        when 'biceps' then 'Bíceps' when 'arms' then 'Bíceps'
        when 'triceps' then 'Tríceps' when 'abdominais' then 'Abdômen' when 'core' then 'Abdômen'
        when 'gluteos' then 'Glúteos' when 'glutes' then 'Glúteos'
        when 'panturrilhas' then 'Panturrilha' when 'calves' then 'Panturrilha'
        when 'antebracos' then 'Antebraços' when 'pescoco' then 'Pescoço'
        else 'Outros' end end;
  end if;
  return new;
end;
$$;


revoke all on function public._validate_catalog_exercise_reference() from public, anon, authenticated;

create or replace function public._validate_workout_exercise_published() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex public.exercises;
  v_by_id public.exercise_catalog;
  v_by_provider public.exercise_catalog;
  v_status text;
begin
  select * into v_ex from public.exercises where id = new.exercise_id;
  if v_ex.id is null then return new; end if; -- FK validates existence.
  if v_ex.user_id <> new.user_id then
    raise exception 'EXERCISE_NOT_FOUND' using errcode = '23503';
  end if;
  -- Historical edits keep their original exercise, including legacy/withdrawn items.
  if tg_op = 'UPDATE' and new.exercise_id is not distinct from old.exercise_id then return new; end if;
  if v_ex.source <> 'catalog' then
    -- Only a trusted, unauthenticated database maintenance connection can seed historical data.
    if auth.uid() is null and current_setting('role', true) in ('none','postgres','supabase_admin','service_role') then return new; end if;
    raise exception 'LEGACY_EXERCISE_READ_ONLY' using errcode = 'P0001';
  end if;

  if v_ex.catalog_id is not null then
    select * into v_by_id from public.exercise_catalog where id = v_ex.catalog_id for share;
  end if;
  if v_ex.provider is not null and v_ex.provider_exercise_id is not null then
    select * into v_by_provider from public.exercise_catalog
      where provider = v_ex.provider and provider_exercise_id = v_ex.provider_exercise_id for share;
  end if;

  -- catalog_id é o atalho preferido, mas só confiamos nele se concordar com provider+id quando
  -- ambos resolvem. Discordância = referência inconsistente = trata como indisponível.
  if v_by_id.id is not null and v_by_provider.id is not null and v_by_id.id <> v_by_provider.id then
    raise exception 'catalog_exercise_not_published' using errcode = 'P0001';
  end if;

  v_status := coalesce(v_by_id.status, v_by_provider.status);
  -- An unresolved official reference cannot start a new session.
  if v_status is distinct from 'published' then
    raise exception 'catalog_exercise_not_published' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public._validate_workout_exercise_published() from public, anon, authenticated;

create or replace function public.sync_workout_mutations(p_mutations jsonb, p_expected_user uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_max_batch constant integer := 50;
  v_uid uuid := auth.uid();
  v_item jsonb;
  v_index integer;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_failed_entities uuid[] := '{}';
  v_entity uuid;
begin
  if auth.uid() is not null and not private.current_session_active() then raise exception 'SESSION_REVOKED'; end if;
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_expected_user is not null and p_expected_user <> v_uid then raise exception 'USER_MISMATCH'; end if;
  -- has_app_access() devolve NULL (não false) quando os termos não foram aceitos: sempre coalesce.
  if not coalesce(public.has_app_access(), false) then raise exception 'APP_ACCESS_DENIED'; end if;
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'array' then raise exception 'INVALID_BATCH'; end if;
  if jsonb_array_length(p_mutations) > c_max_batch then raise exception 'BATCH_TOO_LARGE'; end if;
  if pg_column_size(p_mutations) > 262144 then raise exception 'BATCH_TOO_LARGE'; end if;

  for v_item, v_index in
    select value, (ordinality - 1)::integer from jsonb_array_elements(p_mutations) with ordinality
  loop
    v_entity := null;
    if jsonb_typeof(v_item) = 'object' and coalesce(v_item->>'entity_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_entity := (v_item->>'entity_id')::uuid;
    end if;
    if v_entity is not null and v_entity = any (v_failed_entities) then
      v_result := jsonb_build_object('mutation_id', v_item->'mutation_id', 'entity_id', v_entity,
        'status', 'rejected', 'code', 'DEPENDENCY_FAILED');
    else
      begin
        if v_item->>'operation' = 'exercise.create' then
          v_result := jsonb_build_object('mutation_id', v_item->'mutation_id', 'entity_id', v_entity,
            'status', 'rejected', 'code', 'CUSTOM_EXERCISES_DISABLED');
        else
          v_result := private.apply_workout_mutation(v_uid, v_item);
        end if;
      exception
        when check_violation or data_exception or not_null_violation then
          v_result := jsonb_build_object('mutation_id', v_item->'mutation_id', 'entity_id', v_entity,
            'status', 'rejected', 'code', 'INVALID_PAYLOAD');
        when foreign_key_violation then
          v_result := jsonb_build_object('mutation_id', v_item->'mutation_id', 'entity_id', v_entity,
            'status', 'rejected', 'code', 'EXERCISE_NOT_FOUND');
        when others then
          v_result := jsonb_build_object('mutation_id', v_item->'mutation_id', 'entity_id', v_entity,
            'status', 'rejected',
            'code', case when sqlerrm in (
              'TYPE_IMMUTABLE', 'CREATED_AT_IMMUTABLE', 'LEGACY_EXERCISE_READ_ONLY',
              'catalog_exercise_not_published', 'catalog_exercise_unavailable'
            ) then sqlerrm else 'INTERNAL' end);
      end;
    end if;
    if v_result->>'status' in ('rejected', 'conflict') and v_entity is not null
       and v_result->>'code' <> 'DEPENDENCY_FAILED' then
      v_failed_entities := v_failed_entities || v_entity;
    end if;
    v_results := v_results || jsonb_build_array(jsonb_build_object('index', v_index) || v_result);
  end loop;
  return jsonb_build_object('results', v_results);
end;
$$;
revoke all on function public.sync_workout_mutations(jsonb, uuid) from public, anon;
grant execute on function public.sync_workout_mutations(jsonb, uuid) to authenticated;

