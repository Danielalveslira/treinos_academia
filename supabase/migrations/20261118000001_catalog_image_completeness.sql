-- Validate the already loaded published references without per-row storage queries.
create or replace function public.catalog_has_complete_images(p_id uuid, p_refs jsonb)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(
    jsonb_typeof(p_refs->'version') = 'number'
    and (p_refs->>'version') ~ '^[1-9][0-9]*$'
    and not exists (
      select 1 from unnest(array['start', 'end']) role
      where not exists (
        select 1 from jsonb_array_elements(
          case when jsonb_typeof(p_refs->'images') = 'array' then p_refs->'images' else '[]'::jsonb end
        ) image
        where image->>'role' = role
          and image->>'path' = p_id::text || '/v' || (p_refs->>'version') || '/' || role || '.webp'
      )
    ), false);
$$;
revoke all on function public.catalog_has_complete_images(uuid, jsonb) from public, anon;
grant execute on function public.catalog_has_complete_images(uuid, jsonb) to authenticated;

create or replace function public.admin_list_catalog_exercises(
  p_status text default null,
  p_search text default null,
  p_muscle text default null,
  p_limit integer default 20,
  p_offset integer default 0,
  p_only_missing_images boolean default false
) returns table (
  id uuid, provider text, provider_exercise_id text, name text, status text, revision bigint,
  primary_muscle text, muscles text[], equipment text, category text, difficulty text,
  force text, mechanic text, instructions text[], safety_notes text[], pending_content jsonb,
  published_media_refs jsonb, created_by uuid, published_at timestamptz, published_by uuid,
  withdrawn_at timestamptz, withdrawn_by uuid, withdrawal_reason text,
  created_at timestamptz, updated_at timestamptz, total_count bigint
) language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('draft', 'in_review', 'published', 'withdrawn') then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  return query
    select ec.id, ec.provider, ec.provider_exercise_id, ec.name, ec.status, ec.revision,
      ec.primary_muscle, ec.muscles, ec.equipment, ec.category, ec.difficulty, ec.force, ec.mechanic,
      ec.instructions, ec.safety_notes, ec.pending_content, ec.published_media_refs, ec.created_by,
      ec.published_at, ec.published_by, ec.withdrawn_at, ec.withdrawn_by, ec.withdrawal_reason,
      ec.created_at, ec.updated_at, count(*) over() as total_count
    from public.exercise_catalog ec
    where (p_status is null or ec.status = p_status)
      and (p_muscle is null or ec.muscles @> array[p_muscle] or ec.primary_muscle = p_muscle)
      and (p_search is null or p_search = ''
           or ec.name_normalized ilike '%' || public._normalize_search_value(p_search) || '%')
      and (not p_only_missing_images or not public.catalog_has_complete_images(ec.id, ec.published_media_refs))
    order by ec.updated_at desc, ec.id
    limit least(greatest(p_limit, 1), 50)
    offset greatest(p_offset, 0);
end;
$$;
revoke all on function public.admin_list_catalog_exercises(text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.admin_list_catalog_exercises(text, text, text, integer, integer, boolean) to authenticated;
