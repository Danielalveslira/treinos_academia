-- Cada seleção confirmada pelo editor precisa de um caminho novo. Reutilizar uma
-- alocação após falha de rede poderia confirmar bytes de uma seleção anterior.
create or replace function public.allocate_profile_avatar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_recent_count integer;
  v_media_id uuid;
  v_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'PERMISSION_DENIED'; end if;
  select count(*) into v_recent_count from public.profile_avatar_media
    where owner_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then raise exception 'RATE_LIMITED'; end if;
  v_media_id := gen_random_uuid();
  v_path := v_uid::text || '/' || v_media_id::text || '.webp';
  insert into public.profile_avatar_media (id, owner_id, storage_path, state)
    values (v_media_id, v_uid, v_path, 'allocated');
  return jsonb_build_object('mediaId', v_media_id, 'path', v_path);
end;
$$;
