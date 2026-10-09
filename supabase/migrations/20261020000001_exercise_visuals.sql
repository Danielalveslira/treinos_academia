-- Mídia oficial dos exercícios (docs/promps/Evolutus_arquitetura_imagens_exercicios_V2_auditada.md,
-- Fase 1): conjuntos visuais versionados (start/end/thumbnail), revisão humana, publicação
-- atômica e rollback. A IA nunca participa da abertura de um exercício pelo aluno: o app só lê
-- exercise_catalog.published_media_refs, preenchido AQUI, depois de aprovado por um superadmin.
--
-- 1) source_media_refs (cópia de media_refs) passa a ser onde o importador grava as referências do
--    dataset original; a mídia oficial fica em published_media_refs, que o importador nunca toca
--    (reimportar não apaga imagem aprovada). media_refs LEGADO é mantida intacta, só para o
--    frontend/importador antigos continuarem funcionando durante o rollout.
-- 2) exercise_visual_sets / exercise_visual_assets / exercise_visual_style_profiles.
-- 3) Buckets: drafts (privado), exercise-visuals (público, só publicado), references (privado).
-- 4) allocate (superadmin) -> upload direto pro Storage num path pré-alocado -> Edge Function
--    exercise-visual-confirm -> review -> Edge Function publish-exercise-visual -> RPC interna.
--    Rollback = trocar o conjunto publicado por um arquivado (os bytes ficam no bucket público).
--
-- COMPATIBILIDADE (expand/contract): esta migration é só de EXPANSÃO. Nada é renomeado nem removido:
-- media_refs continua existindo (e search_exercise_catalog continua devolvendo-a), então o frontend
-- antigo segue funcionando antes, durante e depois da migration. A remoção de media_refs fica para
-- uma migration FUTURA, depois que o frontend novo estiver estabilizado em produção.
--
-- Miniatura: start e end são obrigatórios; a thumbnail é esperada no fluxo normal mas OPCIONAL no
-- servidor -- uma falha secundária de miniatura nunca deixa um conjunto start/end válido
-- impossível de revisar, publicar ou restaurar.

-- ---------------------------------------------------------------------------
-- 1) Separar mídia de origem e mídia publicada
-- ---------------------------------------------------------------------------
alter table public.exercise_catalog
  add column source_media_refs jsonb not null default '{}'::jsonb,
  add column published_media_refs jsonb not null default '{"images":[]}'::jsonb
    check (jsonb_typeof(published_media_refs) = 'object');
-- Copia o que existe hoje (as referências do dataset original); depois disso o importador novo só
-- escreve em source_media_refs.
update public.exercise_catalog set source_media_refs = media_refs;
comment on column public.exercise_catalog.media_refs is
  'LEGADO (só compatibilidade com o frontend/importador antigos). Use source_media_refs (dataset) e published_media_refs (mídia oficial). Remover em migration futura.';

-- O retorno ganha colunas (muda de tipo): precisa dropar e recriar. media_refs continua no retorno
-- (frontend antigo). Continua uma única RPC (sem N+1).
drop function public.search_exercise_catalog(text, text, text, text, text, integer, integer);
create function public.search_exercise_catalog(
  p_query text default null,
  p_category text default null,
  p_equipment text default null,
  p_muscle text default null,
  p_difficulty text default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns table (
  id uuid, provider text, provider_exercise_id text, name text,
  primary_muscle text, muscles text[], equipment text, category text,
  difficulty text, force text, mechanic text, instructions text[],
  media_refs jsonb, source_media_refs jsonb, published_media_refs jsonb, total_count bigint
) language sql stable set search_path = public, extensions as $$
  select
    ec.id, ec.provider, ec.provider_exercise_id, ec.name, ec.primary_muscle,
    ec.muscles, ec.equipment, ec.category, ec.difficulty, ec.force, ec.mechanic,
    ec.instructions, ec.media_refs, ec.source_media_refs, ec.published_media_refs,
    count(*) over() as total_count
  from public.exercise_catalog ec
  where ec.is_active
    and (p_category is null or ec.category = p_category)
    and (p_equipment is null or ec.equipment = p_equipment)
    and (p_muscle is null or ec.muscles @> array[p_muscle])
    and (p_difficulty is null or ec.difficulty = p_difficulty)
    and (
      p_query is null or p_query = ''
      or ec.name_normalized ilike '%' || public._normalize_search_value(p_query) || '%'
      or ec.name_normalized % public._normalize_search_value(p_query)
    )
  order by
    case when p_query is null or p_query = '' then 0
      else similarity(ec.name_normalized, public._normalize_search_value(p_query)) end desc,
    ec.name asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;
grant execute on function public.search_exercise_catalog to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Style profiles
-- ---------------------------------------------------------------------------
create table public.exercise_visual_style_profiles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  version text not null check (char_length(version) between 1 and 30),
  base_prompt text not null,
  negative_rules text,
  reference_assets jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, version)
);

insert into public.exercise_visual_style_profiles (name, version, base_prompt, negative_rules)
values (
  'EVOLUTUS_FITNESS_V1', 'v1',
  E'Ilustração técnica fitness.\n'
  'Mesmo personagem em todos os exercícios.\n'
  'Anatomia proporcional.\n'
  'Roupa esportiva neutra.\n'
  'Equipamentos consistentes.\n'
  'Fundo transparente.\n'
  'Prioridade para clareza biomecânica.\n'
  'Posição inicial e final claramente distintas.',
  E'Sem texto.\nSem números.\nSem logotipos externos.\nSem decoração.\nSem membros extras.'
);

-- ---------------------------------------------------------------------------
-- 3) Conjuntos visuais (uma versão = start + end + thumbnail publicados juntos)
-- ---------------------------------------------------------------------------
create table public.exercise_visual_sets (
  id uuid primary key default gen_random_uuid(),
  catalog_id uuid not null references public.exercise_catalog(id) on delete cascade,
  version integer not null check (version > 0),
  status text not null check (status in (
    'allocated', 'draft', 'review', 'published', 'rejected', 'archived', 'failed'
  )),
  generation_source text not null check (generation_source in (
    'manual_upload', 'gemini_manual', 'gemini_api', 'internal_svg', 'internal_canvas'
  )),
  generation_model text,
  style_profile_id uuid references public.exercise_visual_style_profiles(id),
  prompt_version text,
  generation_hash text,
  created_by uuid references auth.users(id),
  approved_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_at timestamptz,
  published_at timestamptz,
  unique (catalog_id, version)
);
create index exercise_visual_sets_status_idx on public.exercise_visual_sets (status, created_at);

-- Nunca duas versões publicadas do mesmo exercício.
create unique index exercise_visual_sets_one_published
  on public.exercise_visual_sets (catalog_id) where status = 'published';

create table public.exercise_visual_assets (
  id uuid primary key default gen_random_uuid(),
  visual_set_id uuid not null references public.exercise_visual_sets(id) on delete cascade,
  role text not null check (role in (
    'start', 'end', 'thumbnail', 'movement', 'muscle_map', 'animation'
  )),
  storage_bucket text not null check (storage_bucket in (
    'exercise-visual-drafts', 'exercise-visuals'
  )),
  storage_path text not null,
  mime_type text,
  width integer,
  height integer,
  byte_size bigint,
  created_at timestamptz not null default now(),
  unique (visual_set_id, role)
);
create index exercise_visual_assets_path_idx on public.exercise_visual_assets (storage_path);

-- Tudo aqui é administrativo: só superadmin lê (o app do aluno lê exercise_catalog); nenhuma
-- escrita direta -- só as RPCs abaixo (security definer / service_role).
alter table public.exercise_visual_style_profiles enable row level security;
alter table public.exercise_visual_sets enable row level security;
alter table public.exercise_visual_assets enable row level security;

revoke all on public.exercise_visual_style_profiles from public, anon, authenticated;
revoke all on public.exercise_visual_sets from public, anon, authenticated;
revoke all on public.exercise_visual_assets from public, anon, authenticated;
grant select on public.exercise_visual_style_profiles to authenticated;
grant select on public.exercise_visual_sets to authenticated;
grant select on public.exercise_visual_assets to authenticated;
grant select, insert, update, delete on public.exercise_visual_style_profiles to service_role;
grant select, insert, update, delete on public.exercise_visual_sets to service_role;
grant select, insert, update, delete on public.exercise_visual_assets to service_role;

create policy exercise_visual_style_profiles_select on public.exercise_visual_style_profiles
  for select using (public.is_superadmin());
create policy exercise_visual_sets_select on public.exercise_visual_sets
  for select using (public.is_superadmin());
create policy exercise_visual_assets_select on public.exercise_visual_assets
  for select using (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 4) Buckets e policies
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('exercise-visual-drafts', 'exercise-visual-drafts', false, 2097152, array['image/webp']),
  ('exercise-visuals', 'exercise-visuals', true, 2097152, array['image/webp']),
  ('exercise-visual-references', 'exercise-visual-references', false, 5242880,
    array['image/webp', 'image/png', 'image/jpeg'])
on conflict (id) do nothing;

-- Rascunhos: só superadmin lê (preview da revisão) e só escreve num path já alocado por ele.
create policy exercise_visual_drafts_read on storage.objects for select
  using (bucket_id = 'exercise-visual-drafts' and public.is_superadmin());

create policy exercise_visual_drafts_insert on storage.objects for insert
  with check (
    bucket_id = 'exercise-visual-drafts'
    and public.is_superadmin()
    and exists (
      select 1
      from public.exercise_visual_assets a
      join public.exercise_visual_sets s on s.id = a.visual_set_id
      where a.storage_bucket = 'exercise-visual-drafts'
        and a.storage_path = storage.objects.name
        and s.status = 'allocated'
        and s.created_by = auth.uid()
        and s.created_at > now() - interval '24 hours'
    )
  );

-- Referências de estilo (personagem, poses-base): leitura só superadmin; escrita só service_role.
create policy exercise_visual_references_read on storage.objects for select
  using (bucket_id = 'exercise-visual-references' and public.is_superadmin());

-- exercise-visuals é público (leitura sem policy); escrita só service_role (Edge Function de
-- publicação). update/delete em qualquer um dos três: sem policy pra authenticated.

-- ---------------------------------------------------------------------------
-- 5) RPCs
-- ---------------------------------------------------------------------------
create or replace function private.exercise_visual_file_name(p_role text) returns text
  language sql immutable set search_path = '' as $$
  select case p_role when 'start' then 'start.webp' when 'end' then 'end.webp'
    when 'thumbnail' then 'thumb.webp' end
$$;
revoke all on function private.exercise_visual_file_name(text) from public, anon, authenticated;

-- Aloca versão + paths. O cliente nunca inventa caminho: só sobe nos que esta RPC reservou.
create or replace function public.allocate_exercise_visual_set(
  p_catalog_id uuid,
  p_generation_source text default 'gemini_manual',
  p_prompt_version text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_version integer;
  v_set_id uuid := gen_random_uuid();
  v_profile public.exercise_visual_style_profiles;
  v_role text;
  v_assets jsonb := '{}'::jsonb;
  v_asset_id uuid;
  v_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_generation_source not in ('manual_upload', 'gemini_manual') then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' or pg_column_size(p_metadata) > 4096 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  if p_prompt_version is not null and char_length(p_prompt_version) > 30 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  -- Trava o exercício: duas alocações simultâneas não calculam a mesma versão.
  perform 1 from public.exercise_catalog where id = p_catalog_id and is_active for update;
  if not found then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;

  if (select count(*) from public.exercise_visual_sets
        where created_by = v_uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.exercise_visual_sets where catalog_id = p_catalog_id;
  select * into v_profile from public.exercise_visual_style_profiles
    where active order by created_at desc limit 1;

  insert into public.exercise_visual_sets (
    id, catalog_id, version, status, generation_source, style_profile_id, prompt_version,
    created_by, metadata
  ) values (
    v_set_id, p_catalog_id, v_version, 'allocated', p_generation_source, v_profile.id,
    coalesce(p_prompt_version, 'v1'), v_uid,
    jsonb_build_object('source', p_generation_source, 'styleVersion', v_profile.name) || p_metadata
  );

  foreach v_role in array array['start', 'end', 'thumbnail'] loop
    v_path := p_catalog_id::text || '/' || v_set_id::text || '/' || private.exercise_visual_file_name(v_role);
    insert into public.exercise_visual_assets (visual_set_id, role, storage_bucket, storage_path)
      values (v_set_id, v_role, 'exercise-visual-drafts', v_path)
      returning id into v_asset_id;
    v_assets := v_assets || jsonb_build_object(v_role, jsonb_build_object('id', v_asset_id, 'path', v_path));
  end loop;

  return jsonb_build_object('visualSetId', v_set_id, 'version', v_version, 'assets', v_assets);
end;
$$;
revoke all on function public.allocate_exercise_visual_set(uuid, text, text, jsonb) from public, anon;
grant execute on function public.allocate_exercise_visual_set(uuid, text, text, jsonb) to authenticated;

-- Chamada só pela Edge Function exercise-visual-confirm (service_role), depois de baixar os
-- arquivos e validar WebP real/dimensões/tamanho (Postgres não decodifica imagem).
-- p_assets: [{"role":"start","mime_type":"image/webp","width":1024,"height":1024,"byte_size":123}, ...]
-- start e end são obrigatórios; thumbnail é opcional (ausente = o conjunto segue sem miniatura).
create or replace function public.confirm_exercise_visual_internal(
  p_set_id uuid, p_actor uuid, p_assets jsonb
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_set public.exercise_visual_sets;
  v_item jsonb;
  v_roles text[] := '{}';
begin
  select * into v_set from public.exercise_visual_sets where id = p_set_id for update;
  if v_set.id is null or v_set.status <> 'allocated' or v_set.created_by is distinct from p_actor then
    raise exception 'UPLOAD_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_assets is null or jsonb_typeof(p_assets) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_assets) loop
    if (v_item->>'role') not in ('start', 'end', 'thumbnail')
       or coalesce(v_item->>'mime_type', '') <> 'image/webp'
       or coalesce((v_item->>'width')::integer, 0) <= 0
       or coalesce((v_item->>'height')::integer, 0) <= 0
       or coalesce((v_item->>'byte_size')::bigint, 0) <= 0 then
      raise exception 'INVALID_IMAGE' using errcode = '22023';
    end if;
    v_roles := v_roles || (v_item->>'role');
  end loop;
  -- start e end sempre; thumbnail no máximo uma vez; nenhum papel repetido
  if not (v_roles @> array['start', 'end'])
     or (select count(distinct r) from unnest(v_roles) r) <> cardinality(v_roles) then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_assets) loop
    update public.exercise_visual_assets set
      mime_type = v_item->>'mime_type',
      width = (v_item->>'width')::integer,
      height = (v_item->>'height')::integer,
      byte_size = (v_item->>'byte_size')::bigint
    where visual_set_id = p_set_id and role = v_item->>'role';
  end loop;
  -- Miniatura não confirmada: remove a linha reservada (o conjunto fica consistente com 2 assets).
  if not ('thumbnail' = any (v_roles)) then
    delete from public.exercise_visual_assets where visual_set_id = p_set_id and role = 'thumbnail';
  end if;

  update public.exercise_visual_sets set
    status = 'review', submitted_at = now(), updated_at = now()
  where id = p_set_id;

  return jsonb_build_object('visualSetId', p_set_id, 'status', 'review', 'hasThumbnail', 'thumbnail' = any (v_roles));
end;
$$;
revoke all on function public.confirm_exercise_visual_internal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_exercise_visual_internal(uuid, uuid, jsonb) to service_role;

create or replace function public.reject_exercise_visual_set(p_set_id uuid, p_reason text default null)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_reason is not null and char_length(p_reason) > 500 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  select status into v_status from public.exercise_visual_sets where id = p_set_id for update;
  if v_status is distinct from 'review' then
    raise exception 'INVALID_STATE' using errcode = '55000';
  end if;

  update public.exercise_visual_sets set
    status = 'rejected', updated_at = now(),
    metadata = metadata || jsonb_build_object(
      'rejection', jsonb_build_object('reason', p_reason, 'by', v_uid, 'at', now()))
  where id = p_set_id;

  return jsonb_build_object('visualSetId', p_set_id, 'status', 'rejected');
end;
$$;
revoke all on function public.reject_exercise_visual_set(uuid, text) from public, anon;
grant execute on function public.reject_exercise_visual_set(uuid, text) to authenticated;

-- Troca atômica do conjunto publicado (publicação e rollback compartilham este núcleo).
-- Sempre arquiva o publicado atual ANTES de publicar o novo (índice parcial único).
create or replace function private.apply_published_visual_set(
  p_set_id uuid, p_actor uuid, p_from_status text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_catalog_id uuid;
  v_set public.exercise_visual_sets;
  v_refs jsonb;
  v_role text;
  v_thumb text;
begin
  -- Ordem de locks: exercício, depois conjunto (evita deadlock entre publicações concorrentes).
  select catalog_id into v_catalog_id from public.exercise_visual_sets where id = p_set_id;
  if v_catalog_id is null then raise exception 'INVALID_STATE' using errcode = '55000'; end if;
  perform 1 from public.exercise_catalog where id = v_catalog_id for update;
  select * into v_set from public.exercise_visual_sets where id = p_set_id for update;
  if v_set.status is distinct from p_from_status then
    raise exception 'INVALID_STATE' using errcode = '55000';
  end if;

  -- Sem conjunto pela metade: start e end confirmados (revisão) ou já públicos (rollback). A miniatura,
  -- quando existe, também precisa estar confirmada (linha sem metadados = upload incompleto).
  if (select count(*) from public.exercise_visual_assets
        where visual_set_id = p_set_id and role in ('start', 'end')
          and mime_type = 'image/webp' and byte_size > 0) <> 2
     or exists (select 1 from public.exercise_visual_assets
        where visual_set_id = p_set_id and role = 'thumbnail'
          and (mime_type is distinct from 'image/webp' or coalesce(byte_size, 0) <= 0)) then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;
  if p_from_status = 'archived' and exists (
    select 1 from public.exercise_visual_assets
    where visual_set_id = p_set_id and storage_bucket <> 'exercise-visuals') then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;

  update public.exercise_visual_sets set status = 'archived', updated_at = now()
    where catalog_id = v_catalog_id and status = 'published' and id <> p_set_id;

  if p_from_status = 'review' then
    -- Os bytes já foram copiados pra exercise-visuals/{catalog}/v{versão}/ pela Edge Function.
    foreach v_role in array array['start', 'end', 'thumbnail'] loop
      -- (thumbnail ausente: o update não encontra linha e nada acontece)
      update public.exercise_visual_assets set
        storage_bucket = 'exercise-visuals',
        storage_path = v_catalog_id::text || '/v' || v_set.version::text || '/' || private.exercise_visual_file_name(v_role)
      where visual_set_id = p_set_id and role = v_role;
    end loop;
    update public.exercise_visual_sets set
      status = 'published', approved_by = p_actor, approved_at = now(),
      published_at = now(), updated_at = now()
    where id = p_set_id;
  else
    update public.exercise_visual_sets set
      status = 'published', published_at = now(), updated_at = now(),
      metadata = metadata || jsonb_build_object(
        'restoredBy', p_actor, 'restoredAt', now())
    where id = p_set_id;
  end if;

  v_refs := jsonb_build_object(
    'version', v_set.version,
    'images', jsonb_build_array(
      jsonb_build_object('role', 'start', 'path', (select storage_path from public.exercise_visual_assets where visual_set_id = p_set_id and role = 'start')),
      jsonb_build_object('role', 'end', 'path', (select storage_path from public.exercise_visual_assets where visual_set_id = p_set_id and role = 'end'))
    )
  );
  -- Sem miniatura a chave nem existe (nunca um path nulo).
  select storage_path into v_thumb from public.exercise_visual_assets
    where visual_set_id = p_set_id and role = 'thumbnail';
  if v_thumb is not null then
    v_refs := v_refs || jsonb_build_object('thumbnail', jsonb_build_object('path', v_thumb));
  end if;

  update public.exercise_catalog set published_media_refs = v_refs, updated_at = now()
    where id = v_catalog_id;

  return v_refs;
end;
$$;
revoke all on function private.apply_published_visual_set(uuid, uuid, text) from public, anon, authenticated;

-- Só a Edge Function publish-exercise-visual (service_role) chama, depois de copiar os bytes.
create or replace function public.publish_exercise_visual_internal(p_set_id uuid, p_actor uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = p_actor and role = 'superadmin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return private.apply_published_visual_set(p_set_id, p_actor, 'review');
end;
$$;
revoke all on function public.publish_exercise_visual_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.publish_exercise_visual_internal(uuid, uuid) to service_role;

-- Rollback: volta a uma versão arquivada sem regenerar nada (os arquivos continuam no bucket público).
create or replace function public.restore_exercise_visual_version(p_set_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return private.apply_published_visual_set(p_set_id, v_uid, 'archived');
end;
$$;
revoke all on function public.restore_exercise_visual_version(uuid) from public, anon;
grant execute on function public.restore_exercise_visual_version(uuid) to authenticated;
