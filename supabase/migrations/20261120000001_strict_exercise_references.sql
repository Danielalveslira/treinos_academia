-- Review follow-up: never let one valid reference hide another invalid reference.
set local lock_timeout = '5s';

create or replace function public._validate_workout_exercise_published() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex public.exercises;
  v_by_id public.exercise_catalog;
  v_by_provider public.exercise_catalog;
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

  -- The provider tuple is always required, even when catalog_id resolves.
  -- An optional catalog_id must independently resolve the very same published row.
  if v_by_provider.id is null or v_by_provider.status is distinct from 'published'
     or (v_ex.catalog_id is not null and (
       v_by_id.id is null or v_by_id.id <> v_by_provider.id
       or v_by_id.status is distinct from 'published'
     )) then
    raise exception 'catalog_exercise_not_published' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public._validate_workout_exercise_published() from public, anon, authenticated;

