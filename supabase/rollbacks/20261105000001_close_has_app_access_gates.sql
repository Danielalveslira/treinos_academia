-- Rollback operacional de 20261105000001_close_has_app_access_gates.sql.
-- Restaura exatamente os corpos/policies anteriores a essa migration (mesmas assinaturas,
-- tipos de retorno e grants -- nada foi revogado/concedido pela migration original, então
-- nada precisa ser revertido aqui além dos corpos). Revisar antes de uso: isso reabre os
-- 8 gates do P18 e o search_path de P20 (cast_vote/create_promotion volta a 'public' sem
-- pg_temp). Nunca aplicar sem motivo operacional claro.
--
-- Corpos regenerados a partir do catálogo real (pg_get_functiondef sobre um container com
-- as 137 migrations anteriores aplicadas, sem a F1/F1.2) em vez de transcritos de memória --
-- ver docs/releases/F1_2_CORRECAO_ONBOARDING.md. Isso corrigiu 4 comentários inline que uma
-- transcrição anterior (F1.1) havia perdido (sem diferença de lógica): em
-- create_professional_listing (bloco exception), save_professional_listing_draft (2
-- comentários) e prepare_professional_listing_publish (3 comentários), e um em cast_vote
-- (comentário do advisory lock) -- confirmados aqui também.
--
-- F1.2 também introduziu private.has_account_standing() (não existe antes da F1/F1.2) --
-- removida abaixo, antes de qualquer corpo que a referencie.
begin;
set local lock_timeout = '5s';

drop function if exists private.has_account_standing();

create or replace function public.set_username(p_username text) returns text
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_username text := lower(trim(p_username));
  v_previous text;
  v_bio text;
  v_share boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME';
  end if;

  select username, bio, share_statistics into v_previous, v_bio, v_share
    from public.users where id = auth.uid();

  if v_previous is distinct from v_username then
    insert into public.usernames (username, user_id) values (v_username, auth.uid())
      on conflict (username) do nothing;
    if not exists (select 1 from public.usernames where username = v_username and user_id = auth.uid()) then
      raise exception 'USERNAME_TAKEN';
    end if;
  end if;

  update public.users set username = v_username where id = auth.uid();
  insert into public.public_profiles (user_id, username, bio, share_statistics)
    values (auth.uid(), v_username, v_bio, coalesce(v_share, false))
    on conflict (user_id) do update set username = excluded.username;

  if v_previous is not null and v_previous is distinct from v_username then
    delete from public.usernames where username = v_previous and user_id = auth.uid();
  end if;

  return v_username;
end;
$$;

create or replace function public.update_user_profile(payload jsonb) returns public.users
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_username text;
  v_previous_username text;
  v_entries bigint;
  v_sets numeric;
  v_user public.users;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  select username into v_previous_username from public.users where id = auth.uid();

  if payload ? 'bio' then
    if char_length(trim(coalesce(payload->>'bio', ''))) > 300 then
      raise exception 'BIO_TOO_LONG';
    end if;
    update public.users set bio = nullif(trim(coalesce(payload->>'bio', '')), '') where id = auth.uid();
  end if;

  if payload ? 'username' then
    v_username := lower(trim(payload->>'username'));
    if v_username !~ '^[a-z0-9_]{3,20}$' then
      raise exception 'INVALID_USERNAME';
    end if;
    if v_previous_username is distinct from v_username then
      insert into public.usernames (username, user_id) values (v_username, auth.uid())
        on conflict (username) do nothing;
      if not exists (select 1 from public.usernames where username = v_username and user_id = auth.uid()) then
        raise exception 'USERNAME_TAKEN';
      end if;
    end if;
    update public.users set username = v_username where id = auth.uid();
  end if;

  if payload ? 'shareStatistics' then
    if jsonb_typeof(payload->'shareStatistics') <> 'boolean' then
      raise exception 'INVALID_PRIVACY';
    end if;
    update public.users set share_statistics = (payload->>'shareStatistics')::boolean where id = auth.uid();
  end if;

  if payload ? 'heightCm' then
    if coalesce(payload->>'heightCm', '') = '' then
      update public.users set height_cm = null where id = auth.uid();
    else
      if (payload->>'heightCm')::numeric not between 50 and 250 then
        raise exception 'INVALID_HEIGHT';
      end if;
      update public.users set height_cm = (payload->>'heightCm')::smallint where id = auth.uid();
    end if;
  end if;

  select * into v_user from public.users where id = auth.uid();

  insert into public.public_profiles (user_id, username, bio, share_statistics)
    values (auth.uid(), v_user.username, v_user.bio, v_user.share_statistics)
    on conflict (user_id) do update set
      username = excluded.username, bio = excluded.bio, share_statistics = excluded.share_statistics;

  if v_user.share_statistics then
    select count(*), coalesce(sum(sets), 0) into v_entries, v_sets
      from public.workouts where user_id = auth.uid();
    insert into public.public_profile_statistics (user_id, entries, sets, updated_at)
      values (auth.uid(), v_entries, v_sets, now())
      on conflict (user_id) do update set entries = excluded.entries, sets = excluded.sets, updated_at = now();
  else
    delete from public.public_profile_statistics where user_id = auth.uid();
  end if;

  if v_username is not null and v_previous_username is not null and v_previous_username is distinct from v_username then
    delete from public.usernames where username = v_previous_username and user_id = auth.uid();
  end if;

  return v_user;
end;
$$;

create or replace function public.create_professional_listing(p_kind text) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.professional_listings;
  v_usage_profile text;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_kind not in ('professional', 'space') then raise exception 'INVALID_ARGUMENT'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_existing from public.professional_listings where owner_id = v_uid;
  if v_existing.id is not null then
    if v_existing.kind <> p_kind then raise exception 'ALREADY_EXISTS'; end if;
    return jsonb_build_object('listingId', v_existing.id, 'created', false);
  end if;

  select usage_profile into v_usage_profile from public.users where id = v_uid;
  if v_usage_profile not in ('professional', 'establishment_owner') then
    raise exception 'NOT_ELIGIBLE';
  end if;

  v_new_id := gen_random_uuid();
  insert into public.professional_listings (id, owner_id, kind) values (v_new_id, v_uid, p_kind);
  insert into public.professional_listing_drafts (listing_id, owner_id, kind) values (v_new_id, v_uid, p_kind);

  return jsonb_build_object('listingId', v_new_id, 'created', true);
exception when unique_violation then
  -- Corrida: duas chamadas concorrentes tentando criar a primeira vitrine da mesma
  -- conta -- a outra já commitou, só reler e devolver como replay.
  select * into v_existing from public.professional_listings where owner_id = v_uid;
  if v_existing.kind <> p_kind then raise exception 'ALREADY_EXISTS'; end if;
  return jsonb_build_object('listingId', v_existing.id, 'created', false);
end;
$$;

create or replace function public.save_professional_listing_draft(p_listing_id uuid, p_draft jsonb) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_published public.published_professional_listings;
  v_display_name text;
  v_bio text;
  v_city text;
  v_uf text;
  v_service_mode text;
  v_category_key text;
  v_kind text;
  v_modality_keys text[];
  v_specialties text[];
  v_whatsapp text;
  v_instagram text;
  v_website text;
  v_linked_community_id uuid;
  v_linked_community_name text;
  v_use_profile_avatar boolean;
  v_version integer;
  v_revoked_avatar_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;

  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id for update;
  if v_draft.review_state = 'publishing'
     and v_draft.publishing_started_at > now() - interval '2 minutes' then
    raise exception 'PUBLISH_IN_PROGRESS';
  end if;

  v_kind := p_draft->>'kind';
  if v_kind is distinct from v_listing.kind then raise exception 'KIND_IMMUTABLE'; end if;

  v_display_name := nullif(trim(coalesce(p_draft->>'displayName', '')), '');
  v_bio := nullif(trim(coalesce(p_draft->>'bio', '')), '');
  v_city := nullif(trim(coalesce(p_draft->>'city', '')), '');
  v_uf := p_draft->>'uf';
  v_service_mode := p_draft->>'serviceMode';
  v_category_key := p_draft->>'categoryKey';

  if v_display_name is null or char_length(v_display_name) > 80 then
    raise exception 'INVALID_DISPLAY_NAME';
  end if;
  if v_category_key not in (
    'personal_trainer','coach','fisioterapia','nutricao','academia','box','studio','assessoria','outros'
  ) then
    raise exception 'INVALID_CATEGORY';
  end if;

  select coalesce(array_agg(distinct value), '{}')
    into v_modality_keys
    from jsonb_array_elements_text(coalesce(p_draft->'modalityKeys', '[]'::jsonb)) value
    where value in (
      'musculacao','corrida','cross_training','funcional','ciclismo','natacao',
      'lutas','yoga','pilates','triatlo','danca','outros'
    );
  if array_length(v_modality_keys, 1) is null or array_length(v_modality_keys, 1) > 5 then
    raise exception 'INVALID_MODALITIES';
  end if;

  -- cleanText (professional-listing-core.js) DESCARTA (não trunca) item acima de 60
  -- chars -- por isso o filtro de tamanho aqui, não um left().
  select coalesce(array_agg(distinct trim(value)), '{}')
    into v_specialties
    from jsonb_array_elements_text(coalesce(p_draft->'specialties', '[]'::jsonb)) value
    where char_length(trim(value)) between 1 and 60;
  if array_length(v_specialties, 1) > 10 then raise exception 'TOO_MANY_SPECIALTIES'; end if;

  if v_bio is null or char_length(v_bio) > 1500 then raise exception 'INVALID_BIO'; end if;
  if v_city is null or char_length(v_city) > 80 then raise exception 'INVALID_CITY'; end if;
  if v_uf not in (
    'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR',
    'PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
  ) then
    raise exception 'INVALID_UF';
  end if;
  if v_service_mode not in ('in_person', 'online', 'hybrid') then raise exception 'INVALID_SERVICE_MODE'; end if;

  -- Contatos: só https, sem usuário/senha na URL; instagram/whatsapp com formato
  -- próprio -- mesmas regras de cleanUrl (professional-listing-core.js).
  v_whatsapp := nullif(trim(coalesce(p_draft->'contacts'->>'whatsapp', '')), '');
  if v_whatsapp is not null and v_whatsapp !~ '^https://wa\.me/[1-9][0-9]{7,14}$' then
    raise exception 'INVALID_CONTACTS';
  end if;
  v_instagram := nullif(trim(coalesce(p_draft->'contacts'->>'instagram', '')), '');
  if v_instagram is not null and v_instagram !~ '^https://(www\.)?instagram\.com/[A-Za-z0-9._-]+/?$' then
    raise exception 'INVALID_CONTACTS';
  end if;
  v_website := nullif(trim(coalesce(p_draft->'contacts'->>'website', '')), '');
  if v_website is not null and (char_length(v_website) > 300 or v_website !~ '^https://[^@]+$') then
    raise exception 'INVALID_CONTACTS';
  end if;

  v_linked_community_id := nullif(p_draft->>'linkedCommunityId', '')::uuid;
  if v_linked_community_id is not null then
    select name into v_linked_community_name from public.communities
      where id = v_linked_community_id and owner_id = v_uid and is_active;
    if v_linked_community_name is null then raise exception 'INVALID_LINKED_COMMUNITY'; end if;
  end if;

  v_use_profile_avatar := v_kind = 'professional' and coalesce((p_draft->>'useProfileAvatar')::boolean, false);
  v_version := coalesce(v_draft.version, 0) + 1;

  update public.professional_listing_drafts set
    display_name = v_display_name, category_key = v_category_key, modality_keys = v_modality_keys,
    specialties = v_specialties, bio = v_bio, city = v_city, city_key = public._normalize_search_value(v_city),
    uf = v_uf, service_mode = v_service_mode,
    contacts = jsonb_build_object('whatsapp', v_whatsapp, 'instagram', v_instagram, 'website', v_website),
    linked_community_id = v_linked_community_id, linked_community_name = v_linked_community_name,
    use_profile_avatar = v_use_profile_avatar, review_state = 'draft', version = v_version,
    based_on_published_version = v_listing.published_version, rejection_summary = null, updated_at = now()
    where listing_id = p_listing_id;

  update public.professional_listings set
    lifecycle_state = case when v_listing.lifecycle_state = 'published' then 'published' else 'draft' end,
    linked_community_id = v_linked_community_id, updated_at = now()
    where id = p_listing_id;

  select * into v_published from public.published_professional_listings where listing_id = p_listing_id;
  if v_published.listing_id is not null and v_published.avatar_path is not null and not v_use_profile_avatar then
    v_revoked_avatar_path := v_published.avatar_path;
    update public.published_professional_listings set
      avatar_path = null, avatar_source_media_id = null, updated_at = now()
      where listing_id = p_listing_id;
  end if;

  return jsonb_build_object('listingId', p_listing_id, 'version', v_version, 'revokedAvatarPath', v_revoked_avatar_path);
end;
$$;

create or replace function public.prepare_professional_listing_publish(
  p_listing_id uuid, p_operation_id text
) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_avatar_media_id uuid;
  v_avatar_path text;
  v_avatar_wanted boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_operation_id is null or length(p_operation_id) = 0 then raise exception 'INVALID_ARGUMENT'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;

  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id for update;

  -- Resposta perdida depois de um finalize real: a mesma operação já venceu. Não
  -- chama a Fase 2 novamente e nunca duplica a projeção ou o avatar referenciado.
  if v_listing.lifecycle_state = 'published' and v_draft.publish_operation_id = p_operation_id then
    return jsonb_build_object(
      'repeated', true,
      'resumed', false,
      'version', v_listing.published_version
    );
  end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;
  if v_draft.listing_id is null or coalesce(v_draft.version, 0) = 0 then raise exception 'DRAFT_INCOMPLETE'; end if;

  v_avatar_wanted := v_draft.kind = 'professional' and v_draft.use_profile_avatar is true;
  if v_avatar_wanted then
    select avatar_media_id, avatar_path into v_avatar_media_id, v_avatar_path
      from public.users where id = v_uid;
    v_avatar_wanted := v_avatar_media_id is not null and v_avatar_path is not null;
  end if;

  if v_draft.review_state = 'publishing' then
    -- Retry da mesma intenção: renova a curta trava e deixa a Edge Function retomar
    -- imediatamente, inclusive após reload da página.
    if v_draft.publishing_operation_id = p_operation_id then
      update public.professional_listing_drafts set
        publishing_started_at = now(), updated_at = now()
        where listing_id = p_listing_id;

      return jsonb_build_object(
        'repeated', false,
        'resumed', true,
        'version', v_draft.version,
        'avatarMediaId', case when v_avatar_wanted then v_avatar_media_id else null end,
        'avatarPath', case when v_avatar_wanted then v_avatar_path else null end
      );
    end if;

    -- Outra tentativa ainda pode estar finalizando. Depois do prazo, o update abaixo
    -- substitui a operação stale atomicamente. Um abort tardio da operação antiga não
    -- toca a nova porque abort_professional_listing_publish compara operation_id.
    if v_draft.publishing_started_at > now() - interval '2 minutes' then
      raise exception 'PUBLISH_IN_PROGRESS';
    end if;
  end if;

  update public.professional_listing_drafts set
    review_state = 'publishing',
    publishing_operation_id = p_operation_id,
    publishing_started_at = now(),
    updated_at = now()
    where listing_id = p_listing_id;

  return jsonb_build_object(
    'repeated', false,
    'resumed', false,
    'version', v_draft.version,
    'avatarMediaId', case when v_avatar_wanted then v_avatar_media_id else null end,
    'avatarPath', case when v_avatar_wanted then v_avatar_path else null end
  );
end;
$$;

create or replace function public.allocate_profile_avatar() returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_pending record;
  v_recent_count integer;
  v_media_id uuid;
  v_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select id, storage_path into v_pending from public.profile_avatar_media
    where owner_id = v_uid and state = 'allocated' and created_at > now() - interval '1 hour'
    order by created_at desc limit 1;
  if v_pending.id is not null then
    return jsonb_build_object('mediaId', v_pending.id, 'path', v_pending.storage_path);
  end if;

  select count(*) into v_recent_count from public.profile_avatar_media
    where owner_id = v_uid and created_at > now() - interval '1 hour';
  if v_recent_count >= 6 then
    raise exception 'RATE_LIMITED';
  end if;

  v_media_id := gen_random_uuid();
  v_path := v_uid::text || '/' || v_media_id::text || '.webp';
  insert into public.profile_avatar_media (id, owner_id, storage_path, state)
    values (v_media_id, v_uid, v_path, 'allocated');

  return jsonb_build_object('mediaId', v_media_id, 'path', v_path);
end;
$$;

drop policy if exists profile_avatars_insert on storage.objects;
create policy profile_avatars_insert on storage.objects for insert
  with check (
    bucket_id = 'profile-avatars'
    and exists (
      select 1 from public.profile_avatar_media m
      where m.storage_path = storage.objects.name
        and m.owner_id = auth.uid()
        and m.state = 'allocated'
        and m.created_at > now() - interval '1 hour'
    )
  );

drop policy if exists communities_update on public.communities;
create policy communities_update on public.communities for update
  using (public.is_superadmin() or public.is_community_owner(id))
  with check (public.is_superadmin() or public.is_community_owner(id));

drop policy if exists community_covers_insert on storage.objects;
create policy community_covers_insert on storage.objects for insert
  with check (
    bucket_id = 'community-covers'
    and exists (
      select 1 from public.communities c
      where c.id::text || '.webp' = storage.objects.name
        and (public.is_superadmin() or public.is_community_owner(c.id))
    )
  );
drop policy if exists community_covers_update on storage.objects;
create policy community_covers_update on storage.objects for update
  using (
    bucket_id = 'community-covers'
    and exists (
      select 1 from public.communities c
      where c.id::text || '.webp' = storage.objects.name
        and (public.is_superadmin() or public.is_community_owner(c.id))
    )
  );

drop policy if exists statuses_delete on public.statuses;
create policy statuses_delete on public.statuses for delete
  using (author_id = auth.uid() or public.is_superadmin() or public.is_community_owner(community_id));

create or replace function private.can_moderate_status(p_status_id uuid, p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(
    p_uid is not null
    and p_uid = (select auth.uid())
    and exists (
      select 1
      from public.statuses s
      join public.communities c on c.id = s.community_id
      where s.id = p_status_id
        and (coalesce(public.is_superadmin(), false) or c.owner_id = p_uid)
    ),
    false
  )
$$;

drop policy if exists sponsored_ads_select on public.sponsored_ads;
create policy sponsored_ads_select on public.sponsored_ads for select
  using (
    public.is_superadmin()
    or (is_global and auth.uid() is not null)
    or exists (
      select 1 from public.community_members cm
      where cm.user_id = auth.uid() and cm.community_id = any(community_ids)
    )
  );

create or replace function public.create_promotion(
  p_target_type text, p_target_id uuid, p_package_id text, p_request_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.promotions;
  v_status public.statuses;
  v_community public.communities;
  v_is_owner boolean;
  v_community_id uuid;
  v_promoted boolean;
  v_promoted_until timestamptz;
  v_config jsonb;
  v_pkg jsonb;
  v_cash_amount numeric;
  v_duration_days integer;
  v_wallet public.wallets;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target_type not in ('post', 'community') then raise exception 'INVALID_TARGET_TYPE'; end if;
  if p_target_id is null or p_package_id is null or p_request_id is null or length(p_request_id) = 0 then
    raise exception 'INVALID_REQUEST';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_existing from public.promotions where owner_id = v_uid and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.target_type <> p_target_type or v_existing.target_id <> p_target_id or v_existing.package_id <> p_package_id then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('id', v_existing.id, 'replay', true, 'expiresAt', v_existing.expires_at);
  end if;

  if p_target_type = 'post' then
    select * into v_status from public.statuses where id = p_target_id for update;
    if v_status is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_status.author_id = v_uid);
    v_community_id := v_status.community_id;
    v_promoted := v_status.promoted;
    v_promoted_until := v_status.promoted_until;
  else
    select * into v_community from public.communities where id = p_target_id;
    if v_community is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_community.owner_id = v_uid);
    v_community_id := v_community.id;
    v_promoted := v_community.promoted;
    v_promoted_until := v_community.promoted_until;
  end if;

  if not coalesce(v_is_owner, false) then raise exception 'NOT_OWNER'; end if;

  if (select account_status from public.users where id = v_uid) = 'disabled' then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  if not exists (select 1 from public.community_members where community_id = v_community_id and user_id = v_uid) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;

  if p_target_type = 'post' then
    select * into v_community from public.communities where id = v_community_id;
  end if;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind = 'community' and target_id = v_community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  if (p_target_type = 'post' and private.status_promotion_until(v_status) > v_now)
     or (p_target_type = 'community' and v_promoted and v_promoted_until is not null and v_promoted_until > v_now) then
    raise exception 'ALREADY_PROMOTED';
  end if;

  select config into v_config from public.economy_config where id;
  v_pkg := v_config->'promotionPackages'->p_package_id;
  v_cash_amount := (v_pkg->>'cashAmount')::numeric;
  v_duration_days := (v_pkg->>'durationDays')::integer;
  if v_pkg is null or (v_pkg->>'targetType') <> p_target_type
     or v_cash_amount is null or v_cash_amount <= 0 or v_cash_amount > 1000000
     or v_duration_days is null or v_duration_days <= 0 or v_duration_days > 90
     or coalesce((v_pkg->>'active')::boolean, false) <> true
  then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if coalesce(v_wallet.cash_balance, 0) < v_cash_amount then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  v_expires_at := v_now + (v_duration_days || ' days')::interval;
  v_new_id := gen_random_uuid();

  perform public._wallet_debit_cash(v_uid, v_cash_amount);
  perform public._ledger_record(v_uid, 'promote:' || v_new_id::text, 'cash', 'debit', v_cash_amount, 'promotion_purchase', 'promotion', v_new_id::text);

  insert into public.promotions (
    id, owner_id, request_id, target_type, target_id, community_id, package_id,
    cash_amount, duration_days, status, started_at, expires_at
  ) values (
    v_new_id, v_uid, p_request_id, p_target_type, p_target_id, v_community_id, p_package_id,
    v_cash_amount, v_duration_days, 'active', v_now, v_expires_at
  );

  if p_target_type = 'post' then
    update public.statuses set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  else
    update public.communities set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  end if;

  return jsonb_build_object('id', v_new_id, 'replay', false, 'expiresAt', v_expires_at);
end;
$$;

create or replace function public.cast_vote(p_status_id uuid, p_value smallint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status public.statuses;
  v_community public.communities;
  v_existing public.status_economy_votes;
  v_action text;
  v_config jsonb;
  v_cost_coins numeric;
  v_max_votes_per_day integer;
  v_daily public.economy_daily;
  v_day date;
  v_new_reward_state text;
  v_natural_key text;
  v_delta_pos integer := 0;
  v_delta_neg integer := 0;
  v_expires_at timestamptz;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_value is not null and p_value not in (1, -1) then raise exception 'INVALID_VALUE'; end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_status from public.statuses where id = p_status_id for update;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;
  if v_status.type = 'poll' then raise exception 'INELIGIBLE_TYPE_POLL'; end if;
  if v_status.type = 'workout' then raise exception 'INELIGIBLE_TYPE_WORKOUT'; end if;
  if v_status.author_id = v_uid then raise exception 'SELF_VOTE'; end if;

  v_expires_at := private.status_interaction_expiry(v_status);
  if v_expires_at <= now() then raise exception 'EXPIRED'; end if;

  select * into v_community from public.communities where id = v_status.community_id;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind='community' and target_id=v_status.community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;
  if not exists (select 1 from public.community_members where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  -- Serializa retries/cliques concorrentes do MESMO usuário na MESMA publicação: sem isto, duas
  -- chamadas simultâneas sem linha prévia passariam ambas por 'create' (cobrando 2x e somando 2
  -- no contador) e só a inserção cairia no ON CONFLICT. O lock é liberado no fim da transação.
  perform pg_advisory_xact_lock(hashtextextended('cast_vote:' || v_uid::text || ':' || p_status_id::text, 0));

  select * into v_existing from public.status_economy_votes
    where status_id = p_status_id and user_id = v_uid for update;

  if v_existing is null then
    if p_value is null then return jsonb_build_object('action', 'noop'); end if;
    v_action := 'create';
  elsif v_existing.value is not distinct from p_value then
    return jsonb_build_object('action', 'noop');
  elsif p_value is null then
    v_action := 'remove';
  else
    v_action := 'switch';
  end if;

  v_day := (now() at time zone 'America/Sao_Paulo')::date;

  if v_action = 'create' then
    select config into v_config from public.economy_config where id;
    v_cost_coins := (v_config->'voting'->>'costCoins')::numeric;
    v_max_votes_per_day := (v_config->'voting'->>'maxVotesPerUserDay')::integer;
    if v_cost_coins is null or v_cost_coins <= 0 or v_cost_coins > 1000
       or v_max_votes_per_day is null or v_max_votes_per_day <= 0 or v_max_votes_per_day > 1000 then
      v_cost_coins := 3;
      v_max_votes_per_day := 10;
    end if;

    insert into public.economy_daily (user_id, day) values (v_uid, v_day) on conflict (user_id, day) do nothing;
    select * into v_daily from public.economy_daily where user_id = v_uid and day = v_day for update;
    if v_daily.votes_charged >= v_max_votes_per_day then
      raise exception 'RATE_LIMITED';
    end if;

    select coin_balance into v_balance from public.wallets where user_id = v_uid;
    if coalesce(v_balance, 0) < v_cost_coins then
      raise exception 'INSUFFICIENT_COINS';
    end if;

    perform public._wallet_debit_coins(v_uid, v_cost_coins);
    v_natural_key := 'vote:' || p_status_id::text || ':charge';
    perform public._ledger_record(v_uid, v_natural_key, 'coin', 'debit', v_cost_coins, 'vote_charge', 'status_economy_vote', p_status_id::text);
    update public.economy_daily set votes_charged = votes_charged + 1, vote_coins_spent = vote_coins_spent + v_cost_coins, updated_at = now()
      where user_id = v_uid and day = v_day;
  end if;

  if coalesce(v_existing.reward_state, '') in ('processed', 'capped') then
    v_new_reward_state := v_existing.reward_state;
  else
    v_new_reward_state := case when p_value = 1 then 'pending' else 'ineligible' end;
  end if;

  insert into public.status_economy_votes (
    status_id, user_id, author_id, value, charged, first_charged_at, updated_at,
    reward_state, reward_pending_at, reward_day_key
  ) values (
    p_status_id, v_uid, v_status.author_id, p_value, true,
    now(), now(), v_new_reward_state,
    case when v_new_reward_state = 'pending' then now() else null end,
    case when v_new_reward_state = 'pending' then v_day else null end
  )
  on conflict (status_id, user_id) do update set
    value = excluded.value, charged = true, updated_at = now(), reward_state = excluded.reward_state,
    reward_pending_at = excluded.reward_pending_at, reward_day_key = excluded.reward_day_key;

  if v_existing.value = 1 then v_delta_pos := v_delta_pos - 1; end if;
  if v_existing.value = -1 then v_delta_neg := v_delta_neg - 1; end if;
  if p_value = 1 then v_delta_pos := v_delta_pos + 1; end if;
  if p_value = -1 then v_delta_neg := v_delta_neg + 1; end if;
  update public.statuses set
    positive_vote_count = positive_vote_count + v_delta_pos,
    negative_vote_count = negative_vote_count + v_delta_neg
    where id = p_status_id;

  return jsonb_build_object('action', v_action, 'value', p_value);
end;
$$;

notify pgrst, 'reload schema';
commit;
