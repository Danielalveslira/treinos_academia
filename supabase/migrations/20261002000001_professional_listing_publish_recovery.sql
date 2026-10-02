-- Recuperação idempotente do publish em duas fases da Vitrine.
--
-- Uma interrupção entre prepare e a Edge Function pode deixar o rascunho em
-- `publishing`. O mesmo operation_id agora pode retomar imediatamente; uma nova
-- operação continua podendo assumir uma trava stale após dois minutos. Finalize e
-- abort permanecem protegidos pelo operation_id, então retries tardios nunca afetam
-- uma tentativa mais nova.

create or replace function public._to_json_draft(d public.professional_listing_drafts) returns jsonb
  language sql immutable as $$
  select jsonb_build_object(
    'listingId', d.listing_id, 'ownerId', d.owner_id, 'kind', d.kind, 'reviewState', d.review_state,
    'version', d.version, 'displayName', d.display_name, 'categoryKey', d.category_key,
    'modalityKeys', d.modality_keys, 'specialties', d.specialties, 'bio', d.bio, 'city', d.city,
    'cityKey', d.city_key, 'uf', d.uf, 'serviceMode', d.service_mode, 'contacts', d.contacts,
    'linkedCommunityId', d.linked_community_id, 'linkedCommunityName', d.linked_community_name,
    'useProfileAvatar', d.use_profile_avatar, 'basedOnPublishedVersion', d.based_on_published_version,
    'rejectionSummary', d.rejection_summary,
    'publishingOperationId', d.publishing_operation_id,
    'publishingStartedAt', d.publishing_started_at,
    'publishOperationId', d.publish_operation_id,
    'createdAt', d.created_at, 'updatedAt', d.updated_at
  )
$$;

create or replace function public.prepare_professional_listing_publish(
  p_listing_id uuid, p_operation_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
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

create or replace function public.finalize_professional_listing_publish(
  p_listing_id uuid, p_operation_id text, p_avatar_path text, p_avatar_source_media_id uuid
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_media public.profile_avatar_media;
  v_public_contacts jsonb;
  v_version integer;
begin
  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id for update;

  -- Duas chamadas concorrentes, ou retry após resposta perdida: a primeira já
  -- finalizou esta operação. Retornar o mesmo sucesso é idempotente e não regrava mídia.
  if v_listing.lifecycle_state = 'published' and v_draft.publish_operation_id = p_operation_id then
    return jsonb_build_object(
      'listingId', p_listing_id,
      'state', 'published',
      'version', v_listing.published_version,
      'repeated', true
    );
  end if;

  if v_listing is null or v_listing.lifecycle_state in ('suspended', 'deleting')
     or v_draft.review_state <> 'publishing' or v_draft.publishing_operation_id <> p_operation_id then
    raise exception 'PUBLISH_STATE_CHANGED';
  end if;

  if (p_avatar_source_media_id is null) <> (p_avatar_path is null) then
    raise exception 'AVATAR_AUTHORIZATION_CHANGED';
  end if;
  if p_avatar_source_media_id is not null then
    select * into v_media from public.profile_avatar_media where id = p_avatar_source_media_id;
    if v_draft.use_profile_avatar is not true or v_media.owner_id <> v_listing.owner_id
       or v_media.storage_path <> p_avatar_path or v_media.state not in ('active', 'superseded') then
      raise exception 'AVATAR_AUTHORIZATION_CHANGED';
    end if;
  end if;

  if v_draft.linked_community_id is not null
     and not exists (
       select 1 from public.communities
       where id = v_draft.linked_community_id and owner_id = v_listing.owner_id and is_active
     )
  then
    raise exception 'INVALID_LINKED_COMMUNITY';
  end if;

  v_public_contacts := (
    select coalesce(jsonb_agg(jsonb_build_object('type', key, 'url', value)), '[]'::jsonb)
    from jsonb_each_text(v_draft.contacts) where value is not null and value <> ''
  );
  v_version := v_draft.version;

  insert into public.published_professional_listings (
    listing_id, kind, display_name, sort_key, category_key, modality_keys, specialties,
    bio, city, city_key, uf, service_mode, public_contacts, linked_community_id,
    linked_community_name, avatar_path, avatar_source_media_id, published_version
  ) values (
    p_listing_id, v_draft.kind, v_draft.display_name, public._normalize_search_value(v_draft.display_name),
    v_draft.category_key, v_draft.modality_keys, v_draft.specialties, v_draft.bio, v_draft.city,
    v_draft.city_key, v_draft.uf, v_draft.service_mode, v_public_contacts, v_draft.linked_community_id,
    v_draft.linked_community_name, p_avatar_path, p_avatar_source_media_id, v_version
  )
  on conflict (listing_id) do update set
    kind = excluded.kind, display_name = excluded.display_name, sort_key = excluded.sort_key,
    category_key = excluded.category_key, modality_keys = excluded.modality_keys,
    specialties = excluded.specialties, bio = excluded.bio, city = excluded.city, city_key = excluded.city_key,
    uf = excluded.uf, service_mode = excluded.service_mode, public_contacts = excluded.public_contacts,
    linked_community_id = excluded.linked_community_id, linked_community_name = excluded.linked_community_name,
    avatar_path = excluded.avatar_path, avatar_source_media_id = excluded.avatar_source_media_id,
    published_version = excluded.published_version, updated_at = now();

  update public.professional_listings set
    lifecycle_state = 'published', published_version = v_version, updated_at = now()
    where id = p_listing_id;
  update public.professional_listing_drafts set
    review_state = 'draft', based_on_published_version = v_version, rejection_summary = null,
    publish_operation_id = p_operation_id, publishing_operation_id = null, publishing_started_at = null,
    updated_at = now()
    where listing_id = p_listing_id;

  return jsonb_build_object(
    'listingId', p_listing_id,
    'state', 'published',
    'version', v_version,
    'repeated', false
  );
end;
$$;

revoke execute on function public.finalize_professional_listing_publish(uuid, text, text, uuid)
  from public, anon, authenticated;
