-- Porta professionalListingsService.js + functions/professional-listing-service.js
-- (create/save/publish/unpublish/suspend/delete) pra Supabase.
--
-- Simplificações habilitadas por Postgres (Firestore não faz):
--   * professionalListingOwnerLocks/{uid} (documento separado só pra checagem rápida de
--     "já tem vitrine?") some -- um unique(owner_id) em professional_listings faz o
--     mesmo papel nativamente.
--   * filterKeys (array combinatório *|modalidade|uf|cidade|atendimento, pra sustentar
--     array-contains no Firestore) some -- a RPC de busca pública filtra com WHERE de
--     verdade (ANY(modality_keys), igualdade opcional por uf/cidade/atendimento), sem
--     precisar pré-computar toda combinação possível.
--
-- publish() -- ATENÇÃO, decisão deliberada: os Termos de Publicação da Vitrine NÃO estão
-- aprovados/ativados hoje em produção (functions/legal/showcase-manifest.json tem
-- "published": false -- publish-showcase-legal.js, script manual, nunca rodou pra essa
-- versão). O original já falha fechado nesse ponto pra QUALQUER tentativa de publicar,
-- então esta migration semeia showcase_legal_policy com published=false (mesmo estado
-- real de hoje) -- portar isso não "ativa" nada que já não estivesse desativado. A
-- prepare_professional_listing_publish abaixo implementa o portão + toda a validação até
-- esse ponto; a segunda fase (copiar o avatar autorizado no Storage, que precisa de uma
-- Edge Function -- Postgres não mexe em bytes de Storage) fica pra quando os termos forem
-- aprovados de verdade -- não dá pra testar essa fase ponta a ponta contra um estado que
-- não existe em produção ainda. finalize_professional_listing_publish/
-- abort_professional_listing_publish já estão prontas pra quando essa Edge Function
-- existir (mesmo formato de profile-avatar-confirm: baixa/copia o arquivo, chama de
-- volta a RPC de finalização).

create table public.professional_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references public.users(id) on delete cascade,
  kind text not null check (kind in ('professional', 'space')),
  lifecycle_state text not null default 'draft'
    check (lifecycle_state in ('draft', 'published', 'archived', 'suspended', 'deleting')),
  published_version integer not null default 0,
  linked_community_id uuid references public.communities(id),
  suspended_reason text check (suspended_reason is null or char_length(suspended_reason) <= 500),
  suspended_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.professional_listings enable row level security;
create policy professional_listings_select on public.professional_listings for select
  using (owner_id = auth.uid() or public.is_superadmin());

create table public.professional_listing_drafts (
  listing_id uuid primary key references public.professional_listings(id) on delete cascade,
  owner_id uuid not null references public.users(id),
  kind text not null check (kind in ('professional', 'space')),
  review_state text not null default 'draft' check (review_state in ('draft', 'publishing')),
  version integer not null default 0,
  display_name text,
  category_key text,
  modality_keys text[] not null default '{}',
  specialties text[] not null default '{}',
  bio text,
  city text,
  city_key text,
  uf text,
  service_mode text,
  contacts jsonb not null default '{}'::jsonb,
  linked_community_id uuid references public.communities(id),
  linked_community_name text,
  use_profile_avatar boolean not null default false,
  based_on_published_version integer not null default 0,
  rejection_summary text,
  publish_operation_id text,
  publishing_operation_id text,
  publishing_started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.professional_listing_drafts enable row level security;
create policy professional_listing_drafts_select on public.professional_listing_drafts for select
  using (owner_id = auth.uid() or public.is_superadmin());

create table public.published_professional_listings (
  listing_id uuid primary key references public.professional_listings(id) on delete cascade,
  kind text not null check (kind in ('professional', 'space')),
  display_name text not null,
  sort_key text not null,
  category_key text not null,
  modality_keys text[] not null default '{}',
  specialties text[] not null default '{}',
  bio text not null,
  city text not null,
  city_key text not null,
  uf text not null,
  service_mode text not null,
  public_contacts jsonb not null default '[]'::jsonb,
  linked_community_id uuid references public.communities(id),
  linked_community_name text,
  avatar_path text,
  avatar_source_media_id uuid references public.profile_avatar_media(id),
  published_version integer not null,
  published_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Busca pública: kind é sempre informado; uf/cidade/atendimento/modalidade são
-- opcionais (tratados como "qualquer" quando omitidos, ver list_published_professional_listings).
create index published_professional_listings_browse_idx
  on public.published_professional_listings(kind, uf, city_key, service_mode, sort_key);
create index published_professional_listings_modality_idx
  on public.published_professional_listings using gin(modality_keys);
alter table public.published_professional_listings enable row level security;
create policy published_professional_listings_select on public.published_professional_listings for select
  using (public.has_app_access());

-- Termos de Publicação da Vitrine -- sistema paralelo ao legal_policy/legal_versions do
-- app (aceite específico pra publicar uma vitrine, não pra usar o app). published=false
-- por padrão -- ver nota no topo do arquivo.
create table public.showcase_legal_policy (
  id boolean primary key default true check (id),
  document_id text,
  version text,
  published boolean not null default false,
  digest text,
  published_at timestamptz
);
insert into public.showcase_legal_policy (id) values (true);
alter table public.showcase_legal_policy enable row level security;
create policy showcase_legal_policy_select on public.showcase_legal_policy for select using (true);

create table public.showcase_legal_versions (
  version text primary key,
  manifest jsonb not null,
  document jsonb not null,
  digest text not null,
  created_at timestamptz not null default now()
);
alter table public.showcase_legal_versions enable row level security;
create policy showcase_legal_versions_select on public.showcase_legal_versions for select using (true);

create table public.showcase_legal_acceptances (
  user_id uuid not null references public.users(id) on delete cascade,
  version text not null,
  -- set null (não cascade): a exclusão da vitrine não pode apagar prova de aceite dos
  -- termos -- é exatamente o tipo de registro que uma auditoria futura pode pedir.
  listing_id uuid references public.professional_listings(id) on delete set null,
  operation_id text,
  document_id text not null,
  digest text not null,
  accepted_at timestamptz not null default now(),
  primary key (user_id, version)
);
alter table public.showcase_legal_acceptances enable row level security;
create policy showcase_legal_acceptances_select on public.showcase_legal_acceptances for select
  using (user_id = auth.uid() or public.is_superadmin());

create extension if not exists unaccent;

-- Equivalente a normalizeSearchValue (professional-listing-core.js): minúsculas, sem
-- acento, espaços colapsados -- usado pra city_key/sort_key.
create or replace function public._normalize_search_value(p_value text) returns text
  language sql immutable as $$
  select trim(regexp_replace(lower(unaccent(coalesce(p_value, ''))), '\s+', ' ', 'g'))
$$;

-- Equivalente a createDraft. O "lock" por documento some -- unique(owner_id) em
-- professional_listings já garante 1 vitrine por conta nativamente.
create or replace function public.create_professional_listing(p_kind text) returns jsonb
  language plpgsql security definer set search_path = public as $$
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

-- Equivalente a saveDraft. Validação replicada de validateListingDraft
-- (professional-listing-core.js) -- mesmas regras, mesmas mensagens.
create or replace function public.save_professional_listing_draft(p_listing_id uuid, p_draft jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
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

-- Fase 1 de publish(): valida titularidade/estado/termos/rascunho, registra aceite (se
-- ainda não houver um pra esta versão) e trava a vitrine em 'publishing'. Ver nota no
-- topo do arquivo -- hoje showcase_legal_policy.published=false, então isto sempre
-- devolve SHOWCASE_TERMS_UNAVAILABLE, fielmente igual à produção atual.
create or replace function public.prepare_professional_listing_publish(
  p_listing_id uuid, p_terms_accepted boolean, p_terms_version text, p_operation_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_policy public.showcase_legal_policy;
  v_archive public.showcase_legal_versions;
  v_previous_acceptance public.showcase_legal_acceptances;
  v_avatar_media_id uuid;
  v_avatar_path text;
  v_avatar_wanted boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_operation_id is null or length(p_operation_id) = 0 then raise exception 'INVALID_ARGUMENT'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_policy from public.showcase_legal_policy where id;
  if coalesce(v_policy.published, false) is not true then raise exception 'SHOWCASE_TERMS_UNAVAILABLE'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;

  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id for update;

  if v_listing.lifecycle_state = 'published' and v_draft.publish_operation_id = p_operation_id then
    return jsonb_build_object('repeated', true, 'version', v_listing.published_version);
  end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;
  if v_draft.review_state = 'publishing' and v_draft.publishing_started_at > now() - interval '2 minutes' then
    raise exception 'PUBLISH_IN_PROGRESS';
  end if;
  if v_draft.listing_id is null or coalesce(v_draft.version, 0) = 0 then raise exception 'DRAFT_INCOMPLETE'; end if;

  select * into v_archive from public.showcase_legal_versions where version = v_policy.version;
  if v_archive.digest is distinct from v_policy.digest then raise exception 'SHOWCASE_TERMS_UNAVAILABLE'; end if;

  select * into v_previous_acceptance from public.showcase_legal_acceptances
    where user_id = v_uid and version = v_policy.version;
  if v_previous_acceptance.user_id is not null then
    if v_previous_acceptance.document_id <> v_policy.document_id or v_previous_acceptance.digest <> v_policy.digest then
      raise exception 'ACCEPTANCE_INCONSISTENT';
    end if;
  else
    if p_terms_accepted is not true or p_terms_version is distinct from v_policy.version then
      raise exception 'TERMS_NOT_ACCEPTED';
    end if;
    insert into public.showcase_legal_acceptances (user_id, version, listing_id, operation_id, document_id, digest)
      values (v_uid, v_policy.version, p_listing_id, p_operation_id, v_policy.document_id, v_policy.digest);
  end if;

  v_avatar_wanted := v_draft.kind = 'professional' and v_draft.use_profile_avatar is true;
  if v_avatar_wanted then
    select avatar_media_id, avatar_path into v_avatar_media_id, v_avatar_path from public.users where id = v_uid;
    v_avatar_wanted := v_avatar_media_id is not null and v_avatar_path is not null;
  end if;

  update public.professional_listing_drafts set
    review_state = 'publishing', publishing_operation_id = p_operation_id, publishing_started_at = now(), updated_at = now()
    where listing_id = p_listing_id;

  return jsonb_build_object(
    'repeated', false, 'version', v_draft.version,
    'avatarMediaId', case when v_avatar_wanted then v_avatar_media_id else null end,
    'avatarPath', case when v_avatar_wanted then v_avatar_path else null end
  );
end;
$$;
-- Sem revoke: chamada diretamente pelo dono autenticado (mesmo padrão de
-- request_cash_purchase) -- é a Edge Function futura de finalize/abort que precisa ser
-- service_role-only, não esta.

-- Fase 2 de publish(), chamada por uma Edge Function futura (ainda não existe -- ver
-- nota no topo) depois de copiar o avatar autorizado (se houver) pra um caminho próprio
-- da vitrine. Revalida tudo de novo (mesma proteção contra corrida do original: o avatar
-- pode ter mudado entre a fase 1 e esta).
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
  if v_listing is null or v_listing.lifecycle_state in ('suspended', 'deleting')
     or v_draft.review_state <> 'publishing' or v_draft.publishing_operation_id <> p_operation_id then
    raise exception 'PUBLISH_STATE_CHANGED';
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

  return jsonb_build_object('listingId', p_listing_id, 'state', 'published', 'version', v_version);
end;
$$;
revoke execute on function public.finalize_professional_listing_publish(uuid, text, text, uuid) from public, anon, authenticated;

-- Desfaz a trava 'publishing' se a Edge Function falhar em qualquer fase (cópia do
-- avatar ou finalize) -- mesmo papel do catch em publish() no original.
create or replace function public.abort_professional_listing_publish(p_listing_id uuid, p_operation_id text) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update public.professional_listing_drafts set
    review_state = 'draft', publishing_operation_id = null, publishing_started_at = null, updated_at = now()
    where listing_id = p_listing_id and publishing_operation_id = p_operation_id;
end;
$$;
revoke execute on function public.abort_professional_listing_publish(uuid, text) from public, anon, authenticated;

-- Equivalente a unpublish(uid). Devolve o avatarPath antigo (se houver) pra quem chamou
-- decidir sobre a limpeza do arquivo -- ver mesma nota de "arquivo fica pra job futuro"
-- do profile_avatar.
create or replace function public.unpublish_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.published_professional_listings where listing_id = p_listing_id;
  update public.professional_listings set lifecycle_state = 'archived', updated_at = now() where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'archived', 'revokedAvatarPath', v_avatar_path);
end;
$$;

-- Equivalente a suspend(adminId). Superadmin only.
create or replace function public.suspend_professional_listing(p_listing_id uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state = 'suspended' then
    return jsonb_build_object('listingId', p_listing_id, 'state', 'suspended', 'revokedAvatarPath', null);
  end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.published_professional_listings where listing_id = p_listing_id;
  update public.professional_listings set
    lifecycle_state = 'suspended', suspended_reason = trim(p_reason), suspended_by = auth.uid(), updated_at = now()
    where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'suspended', 'revokedAvatarPath', v_avatar_path);
end;
$$;

-- Equivalente a deleteListing(uid). O original apaga em duas fases porque precisa
-- limpar Storage (professionalListingMedia/{listingId}/) entre elas -- aqui a RPC só
-- marca 'deleting' e apaga as linhas; a limpeza do Storage (se algum avatar copiado
-- existir) é responsabilidade de quem chama, com o path devolvido abaixo.
create or replace function public.delete_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.professional_listings where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'deleted', true, 'revokedAvatarPath', v_avatar_path);
end;
$$;

-- Serialização camelCase (mesmo padrão de toda RPC deste projeto -- nunca to_jsonb()
-- cru, que vazaria as colunas em snake_case pro cliente).
create or replace function public._to_json_listing(p public.professional_listings) returns jsonb
  language sql immutable as $$
  select jsonb_build_object(
    'id', p.id, 'ownerId', p.owner_id, 'kind', p.kind, 'lifecycleState', p.lifecycle_state,
    'publishedVersion', p.published_version, 'linkedCommunityId', p.linked_community_id,
    'suspendedReason', p.suspended_reason, 'suspendedBy', p.suspended_by,
    'createdAt', p.created_at, 'updatedAt', p.updated_at
  )
$$;

create or replace function public._to_json_draft(d public.professional_listing_drafts) returns jsonb
  language sql immutable as $$
  select jsonb_build_object(
    'listingId', d.listing_id, 'ownerId', d.owner_id, 'kind', d.kind, 'reviewState', d.review_state,
    'version', d.version, 'displayName', d.display_name, 'categoryKey', d.category_key,
    'modalityKeys', d.modality_keys, 'specialties', d.specialties, 'bio', d.bio, 'city', d.city,
    'cityKey', d.city_key, 'uf', d.uf, 'serviceMode', d.service_mode, 'contacts', d.contacts,
    'linkedCommunityId', d.linked_community_id, 'linkedCommunityName', d.linked_community_name,
    'useProfileAvatar', d.use_profile_avatar, 'basedOnPublishedVersion', d.based_on_published_version,
    'rejectionSummary', d.rejection_summary, 'createdAt', d.created_at, 'updatedAt', d.updated_at
  )
$$;

-- 'id' (não 'listingId'): ProfessionalListingCard/Professionals.jsx leem listing.id pra
-- montar /profissionais/{id} -- mesmo formato de toItem() no original
-- (professionalListingsService.js: {id: snapshot.id, ...snapshot.data()}). linkedCommunity
-- vem como objeto aninhado {id,name} porque publish() no original grava os dois campos
-- (linkedCommunityId achatado E linkedCommunity aninhado) -- ProfessionalListing.jsx lê
-- especificamente listing.linkedCommunity.id.
create or replace function public._to_json_published(p public.published_professional_listings) returns jsonb
  language sql immutable as $$
  select jsonb_build_object(
    'id', p.listing_id, 'kind', p.kind, 'displayName', p.display_name, 'sortKey', p.sort_key,
    'categoryKey', p.category_key, 'modalityKeys', p.modality_keys, 'specialties', p.specialties,
    'bio', p.bio, 'city', p.city, 'cityKey', p.city_key, 'uf', p.uf, 'serviceMode', p.service_mode,
    'publicContacts', p.public_contacts, 'linkedCommunityId', p.linked_community_id,
    'linkedCommunity', case when p.linked_community_id is null then null
      else jsonb_build_object('id', p.linked_community_id, 'name', p.linked_community_name) end,
    'avatarPath', p.avatar_path, 'avatarSourceMediaId', p.avatar_source_media_id,
    'publishedVersion', p.published_version, 'publishedAt', p.published_at, 'updatedAt', p.updated_at
  )
$$;

-- Equivalente a getMyProfessionalListing(userId).
create or replace function public.get_my_professional_listing() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_published public.published_professional_listings;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_listing from public.professional_listings where owner_id = v_uid;
  if v_listing.id is null then return null; end if;
  select * into v_draft from public.professional_listing_drafts where listing_id = v_listing.id;
  select * into v_published from public.published_professional_listings where listing_id = v_listing.id;

  return jsonb_build_object(
    'id', v_listing.id,
    'listing', public._to_json_listing(v_listing),
    'draft', case when v_draft.listing_id is null then null else public._to_json_draft(v_draft) end,
    'published', case when v_published.listing_id is null then null else public._to_json_published(v_published) end
  );
end;
$$;

-- Equivalente a listPublishedProfessionalListings. filterKeys/array-contains do
-- original vira WHERE de verdade -- cada filtro opcional (uf/cidade/atendimento/
-- modalidade) só participa da query quando informado.
create or replace function public.list_published_professional_listings(
  p_kind text, p_modality text default null, p_uf text default null,
  p_city text default null, p_service_mode text default null,
  p_cursor text default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_city_key text := case when p_city is null or p_city = '' then null else public._normalize_search_value(p_city) end;
  v_rows jsonb;
begin
  if not public.has_app_access() then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('professional', 'space') then raise exception 'INVALID_ARGUMENT'; end if;

  select coalesce(jsonb_agg(public._to_json_published(sub) order by sub.sort_key), '[]'::jsonb)
    into v_rows
  from (
    select * from public.published_professional_listings
    where kind = p_kind
      and (p_modality is null or p_modality = '' or modality_keys @> array[p_modality])
      and (p_uf is null or p_uf = '' or uf = p_uf)
      and (v_city_key is null or city_key = v_city_key)
      and (p_service_mode is null or p_service_mode = '' or service_mode = p_service_mode)
      and (p_cursor is null or sort_key > p_cursor)
    order by sort_key
    limit v_page_size
  ) sub;

  return jsonb_build_object(
    'items', v_rows,
    'nextCursor', case when jsonb_array_length(v_rows) = v_page_size
      then v_rows->(jsonb_array_length(v_rows) - 1)->>'sortKey' else null end
  );
end;
$$;
