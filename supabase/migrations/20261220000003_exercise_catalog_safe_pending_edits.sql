-- Public availability is independent of an editorial proposal. No existing row is changed
-- here: affected legacy rows are recovered individually after inspection.
set local lock_timeout = '5s';

alter table public.exercise_catalog
  add column public_content_updated_at timestamptz not null default now();

create or replace function public._bump_exercise_catalog_revision() returns trigger
language plpgsql as $$
begin
  if (new.name, new.primary_muscle, new.muscles, new.equipment, new.category,
      new.difficulty, new.force, new.mechanic, new.instructions, new.safety_notes,
      new.status, new.published_media_refs, new.pending_content)
     is distinct from
     (old.name, old.primary_muscle, old.muscles, old.equipment, old.category,
      old.difficulty, old.force, old.mechanic, old.instructions, old.safety_notes,
      old.status, old.published_media_refs, old.pending_content) then
    new.revision := old.revision + 1;
  end if;
  if (new.name, new.primary_muscle, new.muscles, new.equipment, new.category,
      new.difficulty, new.force, new.mechanic, new.instructions, new.safety_notes,
      new.status, new.published_media_refs)
     is distinct from
     (old.name, old.primary_muscle, old.muscles, old.equipment, old.category,
      old.difficulty, old.force, old.mechanic, old.instructions, old.safety_notes,
      old.status, old.published_media_refs) then
    new.public_content_updated_at := clock_timestamp();
  else
    new.public_content_updated_at := old.public_content_updated_at;
  end if;
  return new;
end;
$$;

create or replace function public.get_exercise_catalog_revision()
returns table (revision text, total_active bigint)
language sql stable security invoker set search_path = public as $$
  select coalesce(to_char(max(ec.public_content_updated_at) at time zone 'utc',
    'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '') || ':' || count(*)::text,
    count(*) from public.exercise_catalog ec where ec.is_active
$$;

-- The complete public projection is the base for every patch. JSON null is kept distinct
-- from an absent key; the latter means preserve the previous value.
create or replace function private.catalog_content_json(p_row public.exercise_catalog)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'name', p_row.name, 'primaryMuscle', p_row.primary_muscle,
    'muscles', p_row.muscles, 'equipment', p_row.equipment,
    'category', p_row.category, 'difficulty', p_row.difficulty,
    'force', p_row.force, 'mechanic', p_row.mechanic,
    'instructions', p_row.instructions, 'safetyNotes', p_row.safety_notes)
$$;
revoke all on function private.catalog_content_json(public.exercise_catalog) from public, anon, authenticated;

create or replace function private.catalog_text_array(p_value jsonb, p_field text)
returns text[] language plpgsql immutable set search_path = public, pg_temp as $$
declare v_result text[];
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return null; end if;
  if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) > 50 then
    raise exception 'INVALID_ARRAY_%', p_field using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_value) item
    where jsonb_typeof(item) <> 'string' or length(trim(item #>> '{}')) not between 1 and 2000) then
    raise exception 'INVALID_ARRAY_%', p_field using errcode = '22023';
  end if;
  select coalesce(array_agg(item #>> '{}' order by ordinality), '{}'::text[])
    into v_result from jsonb_array_elements(p_value) with ordinality as a(item, ordinality);
  return v_result;
end;
$$;
revoke all on function private.catalog_text_array(jsonb, text) from public, anon, authenticated;

create or replace function private.catalog_validate_content_json(p_content jsonb)
returns void language plpgsql set search_path = public, pg_temp as $$
declare v_key text; v_value jsonb; v_max integer;
begin
  if p_content is null or jsonb_typeof(p_content) <> 'object' or pg_column_size(p_content) > 65536 then
    raise exception 'INVALID_CONTENT' using errcode = '22023';
  end if;
  for v_key, v_value in select key, value from jsonb_each(p_content) loop
    if v_key in ('muscles', 'instructions', 'safetyNotes') then
      perform private.catalog_text_array(v_value, v_key);
    elsif v_key in ('name', 'primaryMuscle', 'equipment', 'category', 'difficulty', 'force', 'mechanic') then
      v_max := case when v_key = 'name' then 150 when v_key in ('primaryMuscle','category') then 60 else 120 end;
      if jsonb_typeof(v_value) not in ('string', 'null')
        or (jsonb_typeof(v_value) = 'string' and length(trim(v_value #>> '{}')) not between 1 and v_max) then
        raise exception 'INVALID_FIELD_%', v_key using errcode = '22023';
      end if;
    else
      raise exception 'INVALID_FIELD_%', v_key using errcode = '22023';
    end if;
  end loop;
end;
$$;
revoke all on function private.catalog_validate_content_json(jsonb) from public, anon, authenticated;

create or replace function public.admin_patch_catalog_exercise(
  p_id uuid, p_expected_revision bigint, p_patch jsonb)
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_before public.exercise_catalog;
  v_after public.exercise_catalog; v_content jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_CONTENT' using errcode = '22023';
  end if;
  perform private.catalog_validate_content_json(p_patch);
  select * into v_before from public.exercise_catalog where id = p_id for update;
  if v_before.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_before.revision is distinct from p_expected_revision then
    raise exception 'CATALOG_REVISION_CONFLICT' using errcode = '40001';
  end if;
  if v_before.status = 'withdrawn' then raise exception 'INVALID_STATE' using errcode = '55000'; end if;
  v_content := private.catalog_content_json(v_before) || coalesce(v_before.pending_content, '{}'::jsonb) || p_patch;
  perform private.catalog_validate_content_json(v_content);
  if v_content->>'name' is null then raise exception 'INVALID_FIELD_name' using errcode = '22023'; end if;

  if v_before.status = 'published' then
    update public.exercise_catalog set pending_content = v_content
      where id = p_id returning * into v_after;
  else
    update public.exercise_catalog set
      name = trim(v_content->>'name'), primary_muscle = v_content->>'primaryMuscle',
      muscles = private.catalog_text_array(v_content->'muscles', 'muscles'),
      equipment = v_content->>'equipment', category = v_content->>'category',
      difficulty = v_content->>'difficulty', force = v_content->>'force',
      mechanic = v_content->>'mechanic',
      instructions = private.catalog_text_array(v_content->'instructions', 'instructions'),
      safety_notes = private.catalog_text_array(v_content->'safetyNotes', 'safetyNotes')
      where id = p_id returning * into v_after;
  end if;
  insert into public.admin_audit_log(admin_user_id, action, metadata)
    values (v_uid, 'catalog_exercise_content_updated',
      jsonb_build_object('catalogId', p_id, 'fromRevision', v_before.revision,
        'revision', v_after.revision, 'fields', (select jsonb_agg(key) from jsonb_object_keys(p_patch) key),
        'stagedAsPending', v_before.status = 'published'));
  return v_after;
end;
$$;
revoke all on function public.admin_patch_catalog_exercise(uuid, bigint, jsonb) from public, anon;
grant execute on function public.admin_patch_catalog_exercise(uuid, bigint, jsonb) to authenticated;

-- Compatibility: legacy full replacement remains usable for unpublished drafts. Published
-- rows require revision-aware patching; stale clients cannot silently replace their content.
create or replace function public.admin_update_catalog_exercise_content(
  p_id uuid, p_name text, p_primary_muscle text, p_muscles text[], p_equipment text,
  p_category text, p_difficulty text, p_force text, p_mechanic text,
  p_instructions text[], p_safety_notes text[])
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.exercise_catalog;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_row from public.exercise_catalog where id = p_id;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.published_at is not null then raise exception 'CATALOG_CLIENT_UPDATE_REQUIRED' using errcode = '55000'; end if;
  return public.admin_patch_catalog_exercise(p_id, v_row.revision,
    jsonb_build_object('name', p_name, 'primaryMuscle', p_primary_muscle,
      'muscles', p_muscles, 'equipment', p_equipment, 'category', p_category,
      'difficulty', p_difficulty, 'force', p_force, 'mechanic', p_mechanic,
      'instructions', p_instructions, 'safetyNotes', p_safety_notes));
end;
$$;

create or replace function public.admin_publish_catalog_exercise(p_id uuid, p_expected_revision bigint)
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_before public.exercise_catalog; v_after public.exercise_catalog;
  v_content jsonb; v_muscles text[]; v_instructions text[]; v_safety text[];
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_before from public.exercise_catalog where id = p_id for update;
  if v_before.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_before.revision is distinct from p_expected_revision then
    raise exception 'CATALOG_REVISION_CONFLICT' using errcode = '40001';
  end if;
  if v_before.status not in ('draft', 'in_review', 'published')
    or (v_before.status = 'published' and v_before.pending_content is null) then
    raise exception 'INVALID_STATE' using errcode = '55000';
  end if;
  v_content := private.catalog_content_json(v_before) || coalesce(v_before.pending_content, '{}'::jsonb);
  perform private.catalog_validate_content_json(v_content);
  v_muscles := private.catalog_text_array(v_content->'muscles', 'muscles');
  v_instructions := private.catalog_text_array(v_content->'instructions', 'instructions');
  v_safety := private.catalog_text_array(v_content->'safetyNotes', 'safetyNotes');
  if v_content->>'name' is null or trim(v_content->>'name') = '' then
    raise exception 'NAME_REQUIRED' using errcode = '22023';
  end if;
  if v_content->>'primaryMuscle' is null or trim(v_content->>'primaryMuscle') = '' then
    raise exception 'PRIMARY_MUSCLE_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(array_length(v_muscles, 1), 0) = 0 then
    raise exception 'MUSCLES_REQUIRED' using errcode = '22023';
  end if;
  if v_content->>'category' is null or trim(v_content->>'category') = '' then
    raise exception 'CATEGORY_REQUIRED' using errcode = '22023';
  end if;
  if coalesce(array_length(v_instructions, 1), 0) = 0 then
    raise exception 'INSTRUCTIONS_REQUIRED' using errcode = '22023';
  end if;
  -- Existing legacy publications without a complete visual pair can receive text corrections.
  -- Initial publication still requires real START/END objects. Media changes use their own
  -- validated, atomic visual RPC and do not enter pending_content.
  if v_before.published_at is null and not private._exercise_has_valid_published_visuals(p_id) then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;
  if v_before.published_at is not null and public.catalog_has_complete_images(p_id, v_before.published_media_refs)
    and not private._exercise_has_valid_published_visuals(p_id) then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;
  update public.exercise_catalog set
    name = trim(v_content->>'name'), primary_muscle = v_content->>'primaryMuscle',
    muscles = v_muscles, equipment = v_content->>'equipment', category = v_content->>'category',
    difficulty = v_content->>'difficulty', force = v_content->>'force',
    mechanic = v_content->>'mechanic', instructions = v_instructions,
    safety_notes = v_safety, pending_content = null,
    status = 'published', published_at = now(), published_by = v_uid,
    withdrawn_at = null, withdrawn_by = null, withdrawal_reason = null
    where id = p_id returning * into v_after;
  insert into public.admin_audit_log(admin_user_id, action, metadata)
    values (v_uid, 'catalog_exercise_published',
      jsonb_build_object('catalogId', p_id, 'fromRevision', v_before.revision,
        'revision', v_after.revision, 'wasUpdate', v_before.published_at is not null));
  return v_after;
end;
$$;
revoke all on function public.admin_publish_catalog_exercise(uuid, bigint) from public, anon;
grant execute on function public.admin_publish_catalog_exercise(uuid, bigint) to authenticated;

-- Old one-argument publication may finish an initial draft, never a published update.
create or replace function public.admin_publish_catalog_exercise(p_id uuid)
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.exercise_catalog;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_row from public.exercise_catalog where id = p_id;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status = 'published' then raise exception 'CATALOG_CLIENT_UPDATE_REQUIRED' using errcode = '55000'; end if;
  return public.admin_publish_catalog_exercise(p_id, v_row.revision);
end;
$$;

create or replace function public.admin_discard_catalog_exercise_pending(p_id uuid, p_expected_revision bigint)
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_row public.exercise_catalog;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_row from public.exercise_catalog where id = p_id for update;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.revision is distinct from p_expected_revision then raise exception 'CATALOG_REVISION_CONFLICT' using errcode = '40001'; end if;
  if v_row.status <> 'published' or v_row.pending_content is null then raise exception 'INVALID_STATE' using errcode = '55000'; end if;
  update public.exercise_catalog set pending_content = null where id = p_id returning * into v_row;
  insert into public.admin_audit_log(admin_user_id, action, metadata)
    values (v_uid, 'catalog_exercise_pending_discarded', jsonb_build_object('catalogId', p_id, 'revision', v_row.revision));
  return v_row;
end;
$$;
revoke all on function public.admin_discard_catalog_exercise_pending(uuid, bigint) from public, anon;
grant execute on function public.admin_discard_catalog_exercise_pending(uuid, bigint) to authenticated;

-- Single-record repair for rows stranded by the old trigger. Explicit withdrawals (including
-- withdrawal followed by restore) are excluded by audit history. Never called by migration.
create or replace function public.admin_recover_catalog_pending_publication(p_id uuid, p_expected_revision bigint)
returns public.exercise_catalog language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_row public.exercise_catalog;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_row from public.exercise_catalog where id = p_id for update;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.revision is distinct from p_expected_revision then raise exception 'CATALOG_REVISION_CONFLICT' using errcode = '40001'; end if;
  if v_row.status <> 'in_review' or v_row.is_active or v_row.published_at is null
    or v_row.pending_content is null or v_row.withdrawn_at is not null
    or v_row.primary_muscle is null or coalesce(array_length(v_row.muscles, 1), 0) = 0
    or v_row.category is null or coalesce(array_length(v_row.instructions, 1), 0) = 0
    or exists (select 1 from public.admin_audit_log a
      where a.action = 'catalog_exercise_withdrawn'
        and a.metadata->>'catalogId' = p_id::text and a.created_at >= v_row.published_at) then
    raise exception 'RECOVERY_NOT_ELIGIBLE' using errcode = '55000';
  end if;
  update public.exercise_catalog set status = 'published' where id = p_id returning * into v_row;
  insert into public.admin_audit_log(admin_user_id, action, metadata)
    values (v_uid, 'catalog_exercise_availability_recovered',
      jsonb_build_object('catalogId', p_id, 'revision', v_row.revision,
        'pendingPreserved', true, 'publishedName', v_row.name));
  return v_row;
end;
$$;
revoke all on function public.admin_recover_catalog_pending_publication(uuid, bigint) from public, anon;
grant execute on function public.admin_recover_catalog_pending_publication(uuid, bigint) to authenticated;
