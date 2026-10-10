-- Exercise Visuals V2 -- consistência visual (EVOLUTUS_FITNESS_V2, prompts START/END) e endurecimento do
-- backend: alocação serializada e idempotente, máquina de estados no banco, trilha de auditoria, hashes
-- dos arquivos, referências oficiais do personagem e limpeza segura de rascunhos.
--
-- COMPATIBILIDADE (expand/contract, sobre 20261020000001): só expansão. Nada é removido nem renomeado.
--  * A única função recriada com assinatura nova é allocate_exercise_visual_set: ganha parâmetros FINAIS
--    com default, então a chamada antiga (4 parâmetros nomeados) do frontend já publicado continua válida.
--  * confirm_exercise_visual_internal / publish_exercise_visual_internal / reject / restore mantêm a
--    assinatura; as Edge Functions v1 em produção continuam funcionando (sha256/perceptual_hash/
--    validation_version são opcionais no payload do confirm).
--  * EVOLUTUS_FITNESS_V1 não é tocado e continua o perfil ATIVO. O V2 é criado INATIVO: esta migration não
--    muda o perfil ativo. A troca é uma operação explícita (activate_exercise_visual_style_profile, seção 1),
--    feita só depois de migration + Edge Functions V2 + frontend V2 publicados e do smoke técnico.
-- Nenhum segredo/API key é guardado em lugar algum daqui.

-- ---------------------------------------------------------------------------
-- 1) Style profile V2 (personagem neutro Evolutus) -- criado INATIVO
--    `family` agrupa as versões do mesmo estilo (EVOLUTUS_FITNESS_V1/V2 => EVOLUTUS_FITNESS): no máximo um
--    perfil ativo por família. Ativar/voltar de versão é sempre a função abaixo; nada muda sozinho.
-- ---------------------------------------------------------------------------
alter table public.exercise_visual_style_profiles
  add column family text,
  add column activated_at timestamptz,
  add column activated_by uuid;
update public.exercise_visual_style_profiles
  set family = coalesce(substring(name from '^(.*)_V[0-9]+$'), name);
alter table public.exercise_visual_style_profiles alter column family set not null;

insert into public.exercise_visual_style_profiles (name, version, family, active, base_prompt, negative_rules)
values (
  'EVOLUTUS_FITNESS_V2', 'v2', 'EVOLUTUS_FITNESS', false,
  E'Ilustração técnica fitness 3D semi-realista.\n'
  'Avatar humano adulto neutro, de aparência andrógina: sem traços fortemente masculinos ou femininos.\n'
  'Anatomia natural e proporcional; sem musculatura exagerada.\n'
  'Roupa esportiva neutra, lisa e sem marcas (camiseta, shorts e tênis).\n'
  'Rosto pouco caracterizado, com expressão neutra.\n'
  'Mesmo avatar em todos os exercícios: mesmo corpo, mesmas proporções, mesma roupa e mesma aparência.\n'
  'Equipamento proporcional ao corpo, realista e com acabamento consistente.\n'
  'Fundo transparente.\n'
  'Prioridade para a biomecânica: articulações, coluna, mãos e pés na posição correta do exercício.',
  E'Sem texto.\nSem números.\nSem logotipos.\nSem setas.\nSem elementos decorativos.\n'
  'Sem membros extras.\nSem musculatura exagerada.'
)
on conflict (name, version) do nothing;

-- Só um ativo por família (o V1 é o único ativo hoje, então o índice nasce válido).
create unique index exercise_visual_style_profiles_one_active_per_family
  on public.exercise_visual_style_profiles (family) where active;

-- Núcleo: ativa o perfil e desativa os demais da MESMA família numa transação. Serve para ativar o V2 e para
-- voltar ao V1 (rollback). Idempotente.
create or replace function private.apply_style_profile_activation(p_profile_id uuid, p_actor uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_profile public.exercise_visual_style_profiles;
begin
  perform pg_advisory_xact_lock(hashtextextended('exercise-visual-style-profile-active', 0));
  select * into v_profile from public.exercise_visual_style_profiles where id = p_profile_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  update public.exercise_visual_style_profiles set active = false
    where family = v_profile.family and active and id <> p_profile_id;
  if not v_profile.active then
    update public.exercise_visual_style_profiles
      set active = true, activated_at = now(), activated_by = p_actor, updated_at = now()
      where id = p_profile_id;
  end if;
  return jsonb_build_object('profileId', v_profile.id, 'name', v_profile.name,
    'version', v_profile.version, 'family', v_profile.family, 'active', true);
end;
$$;
revoke all on function private.apply_style_profile_activation(uuid, uuid) from public, anon, authenticated;

-- Superadmin autenticado (painel/cliente com JWT de superadmin).
create or replace function public.activate_exercise_visual_style_profile(p_profile_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return private.apply_style_profile_activation(p_profile_id, v_uid);
end;
$$;
revoke all on function public.activate_exercise_visual_style_profile(uuid) from public, anon;
grant execute on function public.activate_exercise_visual_style_profile(uuid) to authenticated;

-- Backend autorizado (service_role), com um superadmin como ator.
create or replace function public.activate_exercise_visual_style_profile_internal(
  p_profile_id uuid, p_actor uuid
) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = p_actor and role = 'superadmin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return private.apply_style_profile_activation(p_profile_id, p_actor);
end;
$$;
revoke all on function public.activate_exercise_visual_style_profile_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_exercise_visual_style_profile_internal(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 2) Referências oficiais do personagem/estilo (bucket exercise-visual-references)
--    Um "reference set" é um pacote VERSIONADO (character-front/side/back + style-reference). O conjunto
--    visual guarda qual versão foi usada. Os assets ainda não existem: só a estrutura.
-- ---------------------------------------------------------------------------
create table public.exercise_visual_reference_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  version text not null check (char_length(version) between 1 and 30),
  style_profile_id uuid references public.exercise_visual_style_profiles(id),
  active boolean not null default false,
  notes text check (notes is null or char_length(notes) <= 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  activated_at timestamptz,
  unique (name, version)
);
-- No máximo UM pacote de referência ativo por vez.
create unique index exercise_visual_reference_sets_one_active
  on public.exercise_visual_reference_sets ((true)) where active;

create table public.exercise_visual_reference_assets (
  id uuid primary key default gen_random_uuid(),
  reference_set_id uuid not null references public.exercise_visual_reference_sets(id) on delete cascade,
  role text not null check (role in (
    'character-front', 'character-side', 'character-back', 'style-reference'
  )),
  storage_bucket text not null default 'exercise-visual-references'
    check (storage_bucket = 'exercise-visual-references'),
  storage_path text not null,
  mime_type text check (mime_type is null or mime_type in ('image/webp', 'image/png', 'image/jpeg')),
  width integer,
  height integer,
  byte_size bigint,
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (reference_set_id, role),
  -- path exato: {reference_set_id}/{role}.{ext}
  check (storage_path = reference_set_id::text || '/' || role || '.webp'
      or storage_path = reference_set_id::text || '/' || role || '.png'
      or storage_path = reference_set_id::text || '/' || role || '.jpg')
);

alter table public.exercise_visual_reference_sets enable row level security;
alter table public.exercise_visual_reference_assets enable row level security;
revoke all on public.exercise_visual_reference_sets from public, anon, authenticated;
revoke all on public.exercise_visual_reference_assets from public, anon, authenticated;
grant select on public.exercise_visual_reference_sets to authenticated;
grant select on public.exercise_visual_reference_assets to authenticated;
grant select, insert, update, delete on public.exercise_visual_reference_sets to service_role;
grant select, insert, update, delete on public.exercise_visual_reference_assets to service_role;
create policy exercise_visual_reference_sets_select on public.exercise_visual_reference_sets
  for select using (public.is_superadmin());
create policy exercise_visual_reference_assets_select on public.exercise_visual_reference_assets
  for select using (public.is_superadmin());

-- ---------------------------------------------------------------------------
-- 3) Proveniência no conjunto visual + idempotência + controle de limpeza
-- ---------------------------------------------------------------------------
-- `prompt_version` (já existente) passa a ser a versão do PERFIL de prompt (builder START/END).
-- Os hashes são SHA-256 (hex) do texto exato copiado pelo admin: registro de proveniência calculado no
-- cliente, não uma fronteira de segurança (o servidor não reconstrói o prompt).
alter table public.exercise_visual_sets
  add column style_version text check (style_version is null or char_length(style_version) <= 30),
  add column prompt_start_hash text check (prompt_start_hash is null or prompt_start_hash ~ '^[0-9a-f]{64}$'),
  add column prompt_end_hash text check (prompt_end_hash is null or prompt_end_hash ~ '^[0-9a-f]{64}$'),
  add column provider_hint text check (provider_hint is null or provider_hint ~ '^[a-z0-9_-]{1,30}$'),
  add column reference_set_id uuid references public.exercise_visual_reference_sets(id),
  add column reference_style_version text check (reference_style_version is null or char_length(reference_style_version) <= 30),
  add column request_id uuid,
  add column drafts_purged_at timestamptz;

-- Última defesa da alocação idempotente: a mesma chave do mesmo usuário nunca cria dois conjuntos.
create unique index exercise_visual_sets_request_id_key
  on public.exercise_visual_sets (created_by, request_id) where request_id is not null;

-- Conjuntos da V1 já alocados: preenche a versão do estilo a partir do perfil usado.
update public.exercise_visual_sets s set style_version = p.version
  from public.exercise_visual_style_profiles p
  where p.id = s.style_profile_id and s.style_version is null;

-- ---------------------------------------------------------------------------
-- 4) Hashes e validação dos arquivos
--    sha256: calculado NO SERVIDOR (Edge Function) sobre os bytes; detecta arquivo repetido.
--    perceptual_hash: dHash de 64 bits (16 hex) calculado no navegador; só gera AVISO, nunca bloqueia.
-- ---------------------------------------------------------------------------
alter table public.exercise_visual_assets
  add column sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  add column perceptual_hash text check (perceptual_hash is null or perceptual_hash ~ '^[0-9a-f]{16}$'),
  add column validated_at timestamptz,
  add column validation_version smallint check (validation_version is null or validation_version > 0);
create index exercise_visual_assets_sha256_idx on public.exercise_visual_assets (sha256)
  where sha256 is not null;

-- ---------------------------------------------------------------------------
-- 5) Trilha de auditoria (append-only; sem FK para sobreviver a limpezas e exclusões de usuário)
-- ---------------------------------------------------------------------------
create table public.exercise_visual_audit_log (
  id bigint generated always as identity primary key,
  visual_set_id uuid not null,
  catalog_id uuid not null,
  actor_id uuid,
  action text not null check (action in (
    'allocate', 'confirm', 'reject', 'publish', 'archive', 'restore', 'fail', 'cleanup'
  )),
  previous_status text,
  new_status text not null,
  version integer not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object' and pg_column_size(metadata) <= 2048),
  created_at timestamptz not null default now()
);
create index exercise_visual_audit_log_set_idx on public.exercise_visual_audit_log (visual_set_id, id);
create index exercise_visual_audit_log_catalog_idx on public.exercise_visual_audit_log (catalog_id, id);

alter table public.exercise_visual_audit_log enable row level security;
revoke all on public.exercise_visual_audit_log from public, anon, authenticated, service_role;
grant select on public.exercise_visual_audit_log to authenticated, service_role;
create policy exercise_visual_audit_log_select on public.exercise_visual_audit_log
  for select using (public.is_superadmin());

create or replace function private.exercise_visual_audit_log_immutable() returns trigger
  language plpgsql set search_path = '' as $$
begin
  raise exception 'AUDIT_LOG_IMMUTABLE' using errcode = '55000';
end;
$$;
create trigger exercise_visual_audit_log_immutable
  before update or delete on public.exercise_visual_audit_log
  for each row execute function private.exercise_visual_audit_log_immutable();

-- Quem fez e por quê: as funções do fluxo declaram o ator (e um motivo curto) na transação, e o trigger de
-- auditoria lê. Variáveis transaction-local: não vazam para outra requisição.
create or replace function private.set_visual_audit_context(p_actor uuid, p_reason text default null)
  returns void language plpgsql set search_path = '' as $$
begin
  perform pg_catalog.set_config('app.visual_audit_actor', coalesce(p_actor::text, ''), true);
  perform pg_catalog.set_config('app.visual_audit_reason', coalesce(pg_catalog.left(p_reason, 200), ''), true);
end;
$$;
revoke all on function private.set_visual_audit_context(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) Máquina de estados no banco
--    allocated -> review | failed          draft -> review | rejected | failed (status reservado)
--    review -> published | rejected | failed
--    published -> archived                 archived -> published (rollback)
--    rejected, failed: terminais
-- ---------------------------------------------------------------------------
create or replace function private.exercise_visual_transition_allowed(p_from text, p_to text)
  returns boolean language sql immutable set search_path = '' as $$
  select case p_from
    when 'allocated' then p_to in ('review', 'failed')
    when 'draft' then p_to in ('review', 'rejected', 'failed')
    when 'review' then p_to in ('published', 'rejected', 'failed')
    when 'published' then p_to = 'archived'
    when 'archived' then p_to = 'published'
    else false
  end
$$;
revoke all on function private.exercise_visual_transition_allowed(text, text) from public, anon, authenticated;

create or replace function private.exercise_visual_sets_guard() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  -- Identidade do conjunto é imutável: paths publicados dependem de catalog_id + version.
  if new.catalog_id is distinct from old.catalog_id
     or new.version is distinct from old.version
     or new.created_by is distinct from old.created_by
     or new.request_id is distinct from old.request_id then
    raise exception 'IMMUTABLE_FIELD' using errcode = '55000';
  end if;
  if new.status is distinct from old.status then
    if not private.exercise_visual_transition_allowed(old.status, new.status) then
      raise exception 'INVALID_TRANSITION' using errcode = '55000',
        detail = old.status || ' -> ' || new.status;
    end if;
    new.updated_at := pg_catalog.now();
  end if;
  return new;
end;
$$;
create trigger exercise_visual_sets_guard
  before update on public.exercise_visual_sets
  for each row execute function private.exercise_visual_sets_guard();

-- Todo evento do ciclo de vida vira uma linha de auditoria, venha de RPC, Edge Function ou SQL direto.
create or replace function private.exercise_visual_sets_audit() returns trigger
  language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_reason text := nullif(pg_catalog.current_setting('app.visual_audit_reason', true), '');
  v_action text;
  v_meta jsonb := '{}'::jsonb;
begin
  begin
    v_actor := nullif(pg_catalog.current_setting('app.visual_audit_actor', true), '')::uuid;
  exception when others then
    v_actor := null;
  end;

  if tg_op = 'INSERT' then
    v_action := 'allocate';
    v_actor := coalesce(v_actor, new.created_by);
    v_meta := pg_catalog.jsonb_build_object('source', new.generation_source);
  else
    v_action := case
      when new.status = 'review' then 'confirm'
      when new.status = 'rejected' then 'reject'
      when old.status = 'archived' and new.status = 'published' then 'restore'
      when new.status = 'published' then 'publish'
      when new.status = 'archived' then 'archive'
      when new.status = 'failed' then 'fail'
    end;
    if v_action = 'confirm' and new.metadata #> '{validation,warnings}' is not null then
      v_meta := pg_catalog.jsonb_build_object('warnings', new.metadata #> '{validation,warnings}');
    end if;
  end if;
  if v_reason is not null then v_meta := v_meta || pg_catalog.jsonb_build_object('reason', v_reason); end if;

  if v_action is not null then
    insert into public.exercise_visual_audit_log (
      visual_set_id, catalog_id, actor_id, action, previous_status, new_status, version, metadata
    ) values (
      new.id, new.catalog_id, v_actor, v_action,
      case when tg_op = 'UPDATE' then old.status end, new.status, new.version, v_meta
    );
  end if;
  -- O motivo vale para um evento só (não escorre para outro conjunto na mesma transação).
  perform pg_catalog.set_config('app.visual_audit_reason', '', true);
  return new;
end;
$$;
create trigger exercise_visual_sets_audit_insert
  after insert on public.exercise_visual_sets
  for each row execute function private.exercise_visual_sets_audit();
create trigger exercise_visual_sets_audit_update
  after update on public.exercise_visual_sets
  for each row when (old.status is distinct from new.status)
  execute function private.exercise_visual_sets_audit();

-- ---------------------------------------------------------------------------
-- 7) Alocação: serializada por exercício e idempotente
--    Antes: `select ... from exercise_catalog for update` (travava a linha do catálogo, inclusive para as
--    FKs de treinos de alunos) + max(version)+1. Agora: advisory lock transacional dedicado por exercício
--    (não interfere em ninguém que só referencie o catálogo), request_id para retry/duplo clique e a
--    unique (catalog_id, version) como última defesa.
-- ---------------------------------------------------------------------------
create or replace function private.lock_exercise_visual_catalog(p_catalog_id uuid) returns void
  language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('exercise-visual:' || p_catalog_id::text, 0))
$$;
revoke all on function private.lock_exercise_visual_catalog(uuid) from public, anon, authenticated;

create or replace function private.exercise_visual_allocation_payload(p_set_id uuid) returns jsonb
  language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'visualSetId', s.id, 'version', s.version, 'status', s.status,
    'assets', coalesce((
      select pg_catalog.jsonb_object_agg(a.role, pg_catalog.jsonb_build_object('id', a.id, 'path', a.storage_path))
      from public.exercise_visual_assets a where a.visual_set_id = s.id), '{}'::jsonb))
  from public.exercise_visual_sets s where s.id = p_set_id
$$;
revoke all on function private.exercise_visual_allocation_payload(uuid) from public, anon, authenticated;

-- A assinatura antiga (4 parâmetros) é substituída por uma com parâmetros finais opcionais: chamadas
-- antigas por nome continuam resolvendo para esta única função (sem ambiguidade de overload).
drop function public.allocate_exercise_visual_set(uuid, text, text, jsonb);
create function public.allocate_exercise_visual_set(
  p_catalog_id uuid,
  p_generation_source text default 'gemini_manual',
  p_prompt_version text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_request_id uuid default null,
  p_style_profile_id uuid default null,
  p_prompt_start_hash text default null,
  p_prompt_end_hash text default null,
  p_provider_hint text default null
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_version integer;
  v_set_id uuid := gen_random_uuid();
  v_profile public.exercise_visual_style_profiles;
  v_ref public.exercise_visual_reference_sets;
  v_existing public.exercise_visual_sets;
  v_role text;
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
  if (p_prompt_start_hash is not null and p_prompt_start_hash !~ '^[0-9a-f]{64}$')
     or (p_prompt_end_hash is not null and p_prompt_end_hash !~ '^[0-9a-f]{64}$')
     or (p_provider_hint is not null and p_provider_hint !~ '^[a-z0-9_-]{1,30}$') then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  -- Serializa alocações (e publicações) do mesmo exercício até o fim da transação.
  perform private.lock_exercise_visual_catalog(p_catalog_id);

  -- Repetição da mesma chave (duplo clique, retry, resposta perdida): devolve o conjunto já criado.
  if p_request_id is not null then
    select * into v_existing from public.exercise_visual_sets
      where created_by = v_uid and request_id = p_request_id;
    if found then
      if v_existing.catalog_id <> p_catalog_id then
        raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
      end if;
      return private.exercise_visual_allocation_payload(v_existing.id) || jsonb_build_object('replayed', true);
    end if;
  end if;

  perform 1 from public.exercise_catalog where id = p_catalog_id and is_active for key share;
  if not found then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;

  if (select count(*) from public.exercise_visual_sets
        where created_by = v_uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

  -- O perfil é o que o cliente usou para montar o prompt (proveniência honesta); sem ele, o ativo.
  if p_style_profile_id is not null then
    select * into v_profile from public.exercise_visual_style_profiles where id = p_style_profile_id;
    if not found then raise exception 'INVALID_ARGUMENT' using errcode = '22023'; end if;
  else
    select * into v_profile from public.exercise_visual_style_profiles
      where active order by created_at desc, id limit 1;
  end if;
  select * into v_ref from public.exercise_visual_reference_sets where active limit 1;

  select coalesce(max(version), 0) + 1 into v_version
    from public.exercise_visual_sets where catalog_id = p_catalog_id;

  perform private.set_visual_audit_context(v_uid, null);
  begin
    insert into public.exercise_visual_sets (
      id, catalog_id, version, status, generation_source, style_profile_id, style_version, prompt_version,
      prompt_start_hash, prompt_end_hash, provider_hint, reference_set_id, reference_style_version,
      request_id, created_by, metadata
    ) values (
      v_set_id, p_catalog_id, v_version, 'allocated', p_generation_source, v_profile.id, v_profile.version,
      coalesce(p_prompt_version, 'v2'),
      p_prompt_start_hash, p_prompt_end_hash, p_provider_hint, v_ref.id, v_ref.version,
      p_request_id, v_uid,
      -- chaves do servidor por último: o metadata do cliente não pode forjar a proveniência
      p_metadata || jsonb_build_object('source', p_generation_source, 'styleVersion', v_profile.name)
    );
  exception when unique_violation then
    -- Só chega aqui se outro request com a MESMA chave passou por outro exercício (locks diferentes).
    raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = '22023';
  end;

  foreach v_role in array array['start', 'end', 'thumbnail'] loop
    v_path := p_catalog_id::text || '/' || v_set_id::text || '/' || private.exercise_visual_file_name(v_role);
    insert into public.exercise_visual_assets (visual_set_id, role, storage_bucket, storage_path)
      values (v_set_id, v_role, 'exercise-visual-drafts', v_path);
  end loop;

  return private.exercise_visual_allocation_payload(v_set_id);
end;
$$;
revoke all on function public.allocate_exercise_visual_set(uuid, text, text, jsonb, uuid, uuid, text, text, text) from public, anon;
grant execute on function public.allocate_exercise_visual_set(uuid, text, text, jsonb, uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) Confirmação: hashes, validated_at/validation_version e avisos (nunca bloqueiam)
-- ---------------------------------------------------------------------------
create or replace function public.confirm_exercise_visual_internal(
  p_set_id uuid, p_actor uuid, p_assets jsonb
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_set public.exercise_visual_sets;
  v_item jsonb;
  v_roles text[] := '{}';
  v_start jsonb;
  v_end jsonb;
  v_version smallint := 1;
  v_warnings jsonb := '[]'::jsonb;
  v_distance integer;
  v_duplicates jsonb;
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
       or coalesce((v_item->>'byte_size')::bigint, 0) <= 0
       or (v_item->>'sha256' is not null and v_item->>'sha256' !~ '^[0-9a-f]{64}$')
       or (v_item->>'perceptual_hash' is not null and v_item->>'perceptual_hash' !~ '^[0-9a-f]{16}$') then
      raise exception 'INVALID_IMAGE' using errcode = '22023';
    end if;
    v_roles := v_roles || (v_item->>'role');
    if v_item->>'validation_version' is not null then
      v_version := (v_item->>'validation_version')::smallint;
    end if;
    if (v_item->>'role') = 'start' then v_start := v_item; end if;
    if (v_item->>'role') = 'end' then v_end := v_item; end if;
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
      byte_size = (v_item->>'byte_size')::bigint,
      sha256 = v_item->>'sha256',
      perceptual_hash = v_item->>'perceptual_hash',
      validated_at = now(),
      validation_version = v_version
    where visual_set_id = p_set_id and role = v_item->>'role';
  end loop;
  -- Miniatura não confirmada: remove a linha reservada (o conjunto fica consistente com 2 assets).
  if not ('thumbnail' = any (v_roles)) then
    delete from public.exercise_visual_assets where visual_set_id = p_set_id and role = 'thumbnail';
  end if;

  -- AVISOS (o revisor humano decide; nada aqui reprova o conjunto).
  if v_start->>'sha256' is not null and v_start->>'sha256' = v_end->>'sha256' then
    v_warnings := v_warnings || to_jsonb('START_END_IDENTICAL_FILE'::text);
  end if;
  if v_start->>'perceptual_hash' is not null and v_end->>'perceptual_hash' is not null then
    v_distance := bit_count(
      ('x' || (v_start->>'perceptual_hash'))::bit(64) # ('x' || (v_end->>'perceptual_hash'))::bit(64));
    -- dHash de 64 bits: distância <= 2 = praticamente a mesma imagem
    if v_distance <= 2 and not (v_warnings ? 'START_END_IDENTICAL_FILE') then
      v_warnings := v_warnings || to_jsonb('START_END_NEARLY_IDENTICAL'::text);
    end if;
  end if;
  select coalesce(jsonb_agg(distinct a.visual_set_id), '[]'::jsonb) into v_duplicates
    from (
      select a2.visual_set_id
        from public.exercise_visual_assets a2
        where a2.visual_set_id <> p_set_id
          and a2.sha256 in (v_start->>'sha256', v_end->>'sha256')
        limit 3
    ) a;
  if jsonb_array_length(v_duplicates) > 0 then
    v_warnings := v_warnings || to_jsonb('DUPLICATE_FILE_IN_OTHER_SET'::text);
  end if;

  perform private.set_visual_audit_context(p_actor, null);
  update public.exercise_visual_sets set
    status = 'review', submitted_at = now(),
    metadata = metadata || jsonb_build_object('validation', jsonb_strip_nulls(jsonb_build_object(
      'version', v_version,
      'warnings', v_warnings,
      'phashDistance', v_distance,
      'duplicateSetIds', case when jsonb_array_length(v_duplicates) > 0 then v_duplicates end)))
  where id = p_set_id;

  return jsonb_build_object(
    'visualSetId', p_set_id, 'status', 'review',
    'hasThumbnail', 'thumbnail' = any (v_roles), 'warnings', v_warnings);
end;
$$;
revoke all on function public.confirm_exercise_visual_internal(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.confirm_exercise_visual_internal(uuid, uuid, jsonb) to service_role;

-- Falha definitiva (arquivo inválido num path imutável, expiração): sai do fluxo sem apagar nada.
create or replace function public.fail_exercise_visual_set_internal(
  p_set_id uuid, p_actor uuid, p_reason text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_status text;
begin
  if p_reason is null or p_reason !~ '^[A-Z_]{1,40}$' then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  select status into v_status from public.exercise_visual_sets where id = p_set_id for update;
  if v_status is null or v_status not in ('allocated', 'draft', 'review') then
    raise exception 'INVALID_STATE' using errcode = '55000';
  end if;
  perform private.set_visual_audit_context(p_actor, p_reason);
  update public.exercise_visual_sets set
    status = 'failed',
    metadata = metadata || jsonb_build_object('failure', jsonb_build_object('reason', p_reason, 'at', now()))
  where id = p_set_id;
  return jsonb_build_object('visualSetId', p_set_id, 'status', 'failed');
end;
$$;
revoke all on function public.fail_exercise_visual_set_internal(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.fail_exercise_visual_set_internal(uuid, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9) Rejeição e publicação/rollback: ator na auditoria + mesmo lock transacional da alocação
-- ---------------------------------------------------------------------------
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

  perform private.set_visual_audit_context(v_uid, p_reason);
  update public.exercise_visual_sets set
    status = 'rejected',
    metadata = metadata || jsonb_build_object(
      'rejection', jsonb_build_object('reason', p_reason, 'by', v_uid, 'at', now()))
  where id = p_set_id;

  return jsonb_build_object('visualSetId', p_set_id, 'status', 'rejected');
end;
$$;

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
  -- Ordem de locks: advisory do exercício (mesmo da alocação), depois o conjunto.
  select catalog_id into v_catalog_id from public.exercise_visual_sets where id = p_set_id;
  if v_catalog_id is null then raise exception 'INVALID_STATE' using errcode = '55000'; end if;
  perform private.lock_exercise_visual_catalog(v_catalog_id);
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

  perform private.set_visual_audit_context(p_actor, null);
  update public.exercise_visual_sets set status = 'archived'
    where catalog_id = v_catalog_id and status = 'published' and id <> p_set_id;

  perform private.set_visual_audit_context(p_actor, null);
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
      status = 'published', approved_by = p_actor, approved_at = now(), published_at = now()
    where id = p_set_id;
  else
    update public.exercise_visual_sets set
      status = 'published', published_at = now(),
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

-- ---------------------------------------------------------------------------
-- 10) Referências: ativar um pacote (só service_role; ainda sem assets reais)
-- ---------------------------------------------------------------------------
create or replace function public.activate_exercise_visual_reference_set_internal(
  p_reference_set_id uuid, p_actor uuid
) returns jsonb
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users where id = p_actor and role = 'superadmin') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('exercise-visual-reference-active', 0));
  perform 1 from public.exercise_visual_reference_sets where id = p_reference_set_id for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0002'; end if;
  -- Pacote só ativa com todos os arquivos confirmados (nada pela metade).
  if not exists (select 1 from public.exercise_visual_reference_assets where reference_set_id = p_reference_set_id)
     or exists (select 1 from public.exercise_visual_reference_assets
                where reference_set_id = p_reference_set_id
                  and (mime_type is null or coalesce(byte_size, 0) <= 0)) then
    raise exception 'INCOMPLETE_REFERENCE_SET' using errcode = '22023';
  end if;
  update public.exercise_visual_reference_sets set active = false where active and id <> p_reference_set_id;
  update public.exercise_visual_reference_sets set active = true, activated_at = now()
    where id = p_reference_set_id;
  return jsonb_build_object('referenceSetId', p_reference_set_id, 'active', true);
end;
$$;
revoke all on function public.activate_exercise_visual_reference_set_internal(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_exercise_visual_reference_set_internal(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 11) Limpeza de rascunhos abandonados (nunca published/archived; banco e bytes em passos separados)
--     1. expire_stale_exercise_visual_sets: allocated/draft velhos -> failed (a linha e o histórico ficam;
--        a versão nunca é reaproveitada).
--     2. list_exercise_visual_purge_candidates: failed/rejected antigos com bytes ainda no bucket de rascunhos.
--     3. a Edge Function cleanup-exercise-visuals remove os bytes do bucket PRIVADO de rascunhos.
--     4. mark_exercise_visual_drafts_purged_internal: só depois do passo 3 dar certo.
--     Qualquer passo pode falhar e ser repetido: nada depende de o anterior ter terminado na mesma execução.
-- ---------------------------------------------------------------------------
create or replace function public.expire_stale_exercise_visual_sets(
  p_older_than interval default interval '48 hours', p_limit integer default 200
) returns integer
  language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_count integer := 0;
begin
  -- 24h é a janela de upload da policy do bucket: nunca expira uma alocação ainda utilizável.
  if p_older_than is null or p_older_than < interval '24 hours' or p_limit not between 1 and 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  for v_row in
    select id from public.exercise_visual_sets
    where status in ('allocated', 'draft') and created_at < now() - p_older_than
    order by created_at limit p_limit for update skip locked
  loop
    perform private.set_visual_audit_context(null, 'EXPIRED');
    update public.exercise_visual_sets set
      status = 'failed',
      metadata = metadata || jsonb_build_object('failure', jsonb_build_object('reason', 'EXPIRED', 'at', now()))
    where id = v_row.id and status in ('allocated', 'draft');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.expire_stale_exercise_visual_sets(interval, integer) from public, anon, authenticated;
grant execute on function public.expire_stale_exercise_visual_sets(interval, integer) to service_role;

create or replace function public.list_exercise_visual_purge_candidates(
  p_failed_after interval default interval '7 days',
  p_rejected_after interval default interval '30 days',
  p_limit integer default 100
) returns table (visual_set_id uuid, catalog_id uuid, status text, assets jsonb)
  language plpgsql stable security definer set search_path = public as $$
begin
  if p_failed_after is null or p_rejected_after is null
     or p_failed_after < interval '1 day' or p_rejected_after < interval '1 day'
     or p_limit not between 1 and 1000 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;
  return query
    select s.id, s.catalog_id, s.status,
           coalesce((select jsonb_agg(jsonb_build_object('role', a.role, 'path', a.storage_path))
                       from public.exercise_visual_assets a
                      where a.visual_set_id = s.id and a.storage_bucket = 'exercise-visual-drafts'), '[]'::jsonb)
      from public.exercise_visual_sets s
     where s.drafts_purged_at is null
       and ((s.status = 'failed' and s.updated_at < now() - p_failed_after)
         or (s.status = 'rejected' and s.updated_at < now() - p_rejected_after))
     order by s.updated_at
     limit p_limit;
end;
$$;
revoke all on function public.list_exercise_visual_purge_candidates(interval, interval, integer) from public, anon, authenticated;
grant execute on function public.list_exercise_visual_purge_candidates(interval, interval, integer) to service_role;

create or replace function public.mark_exercise_visual_drafts_purged_internal(p_set_id uuid)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_set public.exercise_visual_sets;
begin
  select * into v_set from public.exercise_visual_sets where id = p_set_id for update;
  -- published/archived (e qualquer outro estado) NUNCA entram aqui.
  if v_set.id is null or v_set.status not in ('failed', 'rejected') then
    raise exception 'INVALID_STATE' using errcode = '55000';
  end if;
  if v_set.drafts_purged_at is not null then
    return jsonb_build_object('visualSetId', p_set_id, 'alreadyPurged', true);
  end if;
  update public.exercise_visual_sets set drafts_purged_at = now() where id = p_set_id;
  insert into public.exercise_visual_audit_log (
    visual_set_id, catalog_id, actor_id, action, previous_status, new_status, version, metadata
  ) values (
    v_set.id, v_set.catalog_id, null, 'cleanup', v_set.status, v_set.status, v_set.version,
    jsonb_build_object('purged', 'drafts'));
  return jsonb_build_object('visualSetId', p_set_id, 'alreadyPurged', false);
end;
$$;
revoke all on function public.mark_exercise_visual_drafts_purged_internal(uuid) from public, anon, authenticated;
grant execute on function public.mark_exercise_visual_drafts_purged_internal(uuid) to service_role;
