-- Ciclo de vida de conteúdo do catálogo oficial de exercícios (Etapa 1+2 do plano
-- PROMPT_EVOLUTUS_CATALOGO_EXERCICIOS_V2). Puramente aditivo: nenhuma coluna/função/policy
-- existente é removida; search_exercise_catalog, get_exercise_catalog_revision e
-- list_exercise_catalog_for_sync continuam lendo is_active sem alteração de código, agora
-- garantidamente sincronizado com a nova coluna status.
--
-- O buraco de segurança real fechado aqui NÃO está em exercise_catalog (RLS já nega escrita
-- por padrão -- só existe policy de SELECT). Está em public.exercises: a policy exercises_all
-- deixava o próprio usuário inserir, via client Supabase direto, uma linha source='catalog'
-- com provider/provider_exercise_id/catalog_id ARBITRÁRIOS, sem nenhuma validação server-side
-- de que o item existe e está publicado (ver seção "exercises_validate_catalog_reference").

set local lock_timeout = '5s';

-- ============================================================================================
-- 1) Colunas novas em exercise_catalog + backfill fiel ao estado atual
-- ============================================================================================
alter table public.exercise_catalog
  add column status text check (status in ('draft', 'in_review', 'published', 'withdrawn'));
update public.exercise_catalog set status = case when is_active then 'published' else 'withdrawn' end;
alter table public.exercise_catalog alter column status set not null;
-- Default 'draft' (não 'published'): um exercício novo nunca entra ao ar automaticamente.
-- scripts/import-exercise-catalog.mjs nunca grava status/is_active (nem no insert novo, nem no
-- upsert de conflito): reimportar um item JÁ EXISTENTE não toca essas colunas (preserva o
-- estado atual, seja ele qual for); um item do dataset NUNCA VISTO antes passa a nascer 'draft'
-- e exige revisão/publicação manual -- mudança de comportamento deliberada, documentada aqui.
alter table public.exercise_catalog alter column status set default 'draft';

alter table public.exercise_catalog
  add column revision bigint not null default 1,
  add column created_by uuid references auth.users(id),
  add column published_at timestamptz,
  add column published_by uuid references auth.users(id),
  add column withdrawn_at timestamptz,
  add column withdrawn_by uuid references auth.users(id),
  add column withdrawal_reason text check (withdrawal_reason is null or char_length(withdrawal_reason) between 1 and 500),
  add column safety_notes text[],
  -- Edição de um exercício JÁ PUBLICADO nunca muda o conteúdo ao vivo direto: fica em
  -- pending_content até ser republicada (admin_publish_catalog_exercise), revalidando tudo.
  -- Quem já vê o exercício publicado (busca pública, offline, biblioteca pessoal) continua
  -- vendo a última versão aprovada intacta durante a revisão.
  add column pending_content jsonb;

update public.exercise_catalog set published_at = coalesce(updated_at, created_at) where status = 'published';
update public.exercise_catalog set withdrawn_at = coalesce(updated_at, created_at) where status = 'withdrawn';

-- ============================================================================================
-- 2) Relaxar checks de completude (rascunho pode ser incompleto) + garantir published sempre completo
-- ============================================================================================
alter table public.exercise_catalog alter column primary_muscle drop not null;
alter table public.exercise_catalog drop constraint if exists exercise_catalog_primary_muscle_check;
alter table public.exercise_catalog add constraint exercise_catalog_primary_muscle_check
  check (primary_muscle is null or char_length(primary_muscle) between 1 and 60);

alter table public.exercise_catalog alter column muscles drop not null;
alter table public.exercise_catalog drop constraint if exists exercise_catalog_muscles_check;
alter table public.exercise_catalog add constraint exercise_catalog_muscles_check
  check (muscles is null or array_length(muscles, 1) > 0);

alter table public.exercise_catalog alter column category drop not null;
alter table public.exercise_catalog drop constraint if exists exercise_catalog_category_check;
alter table public.exercise_catalog add constraint exercise_catalog_category_check
  check (category is null or char_length(category) between 1 and 60);

alter table public.exercise_catalog alter column instructions drop not null;
alter table public.exercise_catalog drop constraint if exists exercise_catalog_instructions_check;
alter table public.exercise_catalog add constraint exercise_catalog_instructions_check
  check (instructions is null or array_length(instructions, 1) > 0);
-- name continua NOT NULL (até um rascunho precisa de nome pra aparecer na lista admin).

alter table public.exercise_catalog add constraint exercise_catalog_published_requires_content check (
  status <> 'published' or (
    primary_muscle is not null
    and muscles is not null and array_length(muscles, 1) > 0
    and category is not null
    and instructions is not null and array_length(instructions, 1) > 0
  )
);

-- ============================================================================================
-- 3) status <-> is_active: garantidamente consistentes mesmo em escrita direta no banco
-- ============================================================================================
create or replace function public._sync_exercise_catalog_is_active() returns trigger
  language plpgsql as $$
begin
  new.is_active := (new.status = 'published');
  return new;
end;
$$;
create trigger exercise_catalog_sync_is_active
  before insert or update of status on public.exercise_catalog
  for each row execute function public._sync_exercise_catalog_is_active();

-- A trigger acima só dispara quando "status" está na lista SET de um UPDATE -- não garante o
-- invariante contra uma escrita direta tipo `update exercise_catalog set is_active = true` sem
-- tocar status. A garantia real é este CHECK, verificado em TODA transação (RPC, trigger,
-- service_role, SQL manual), não só quando a trigger roda.
alter table public.exercise_catalog add constraint exercise_catalog_status_is_active_sync
  check (is_active = (status = 'published'));

-- ============================================================================================
-- 4) Revisão: incrementa em toda mutação de conteúdo/ciclo-de-vida/mídia oficial
-- ============================================================================================
create or replace function public._bump_exercise_catalog_revision() returns trigger
  language plpgsql as $$
begin
  if new.name is distinct from old.name
     or new.primary_muscle is distinct from old.primary_muscle
     or new.muscles is distinct from old.muscles
     or new.equipment is distinct from old.equipment
     or new.category is distinct from old.category
     or new.difficulty is distinct from old.difficulty
     or new.force is distinct from old.force
     or new.mechanic is distinct from old.mechanic
     or new.instructions is distinct from old.instructions
     or new.safety_notes is distinct from old.safety_notes
     or new.status is distinct from old.status
     or new.published_media_refs is distinct from old.published_media_refs
  then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
create trigger exercise_catalog_bump_revision
  before update on public.exercise_catalog
  for each row execute function public._bump_exercise_catalog_revision();
-- INSERT já nasce em revision=1 (default da coluna) -- não precisa de trigger de INSERT.

-- ============================================================================================
-- 5) Origem dos exercícios: distinguir conteúdo autoral da equipe de conteúdo importado
-- ============================================================================================
alter table public.exercise_catalog drop constraint exercise_catalog_provider_check;
alter table public.exercise_catalog add constraint exercise_catalog_provider_check
  check (provider in ('evolutus_dataset', 'evolutus_original'));

alter table public.exercises drop constraint exercises_provider_check;
alter table public.exercises add constraint exercises_provider_check
  check (provider in ('exerciseapi', 'evolutus_dataset', 'evolutus_original'));

-- Compatibiliza o limite de nome: exercise_catalog permite até 150 caracteres, mas
-- exercises (biblioteca pessoal) só permitia 60 -- providerExerciseToPersonal() copia o nome
-- direto; um nome de catálogo de 61-150 caracteres faria o INSERT pessoal falhar hoje.
alter table public.exercises drop constraint if exists exercises_name_check;
alter table public.exercises add constraint exercises_name_check check (char_length(name) between 1 and 150);

-- ============================================================================================
-- 6) Trigger de veracidade em public.exercises (o buraco real de segurança)
-- ============================================================================================
create or replace function public._validate_catalog_exercise_reference() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_catalog public.exercise_catalog;
begin
  select * into v_catalog from public.exercise_catalog
    where provider = new.provider and provider_exercise_id = new.provider_exercise_id;

  if v_catalog.id is null or v_catalog.status <> 'published' then
    raise exception 'catalog_exercise_unavailable' using errcode = 'P0001';
  end if;
  if new.catalog_id is not null and new.catalog_id <> v_catalog.id then
    raise exception 'catalog_exercise_unavailable' using errcode = 'P0001';
  end if;
  new.catalog_id := v_catalog.id;  -- nunca confia no client
  return new;
end;
$$;

-- Só revalida quando a REFERÊNCIA ao catálogo está sendo criada/trocada -- nunca numa edição
-- incidental (reordenar, desativar, editar nota) de um exercício pessoal já salvo que aponte
-- pra algo retirado DEPOIS de adicionado. source='custom' nunca passa aqui.
create trigger exercises_validate_catalog_reference
  before insert or update of source, provider, provider_exercise_id, catalog_id on public.exercises
  for each row
  when (new.source = 'catalog')
  execute function public._validate_catalog_exercise_reference();
-- Funções de trigger SECURITY DEFINER nascem com EXECUTE para PUBLIC (todo CREATE FUNCTION
-- concede por padrão) -- Postgres não deixa chamar uma função que retorna "trigger" via SELECT,
-- mas o GRANT continua existindo em pg_proc independente disso. Revoga explicitamente, mesma
-- rede de segurança que supabase/tests/security_followup_test.sql e notification_security_test.sql
-- verificam para TODO SECURITY DEFINER em public/private.
revoke all on function public._validate_catalog_exercise_reference() from public, anon, authenticated;

-- ============================================================================================
-- 7) Trigger em public.workouts: bloqueia INSERT/UPDATE OF exercise_id quando o exercício
--    oficial não está published (draft/in_review/withdrawn), inclusive para quem já tinha o
--    exercício na biblioteca pessoal antes. Prioriza catalog_id (atalho resolvido/validado no
--    momento em que a referência foi criada), cai para provider+provider_exercise_id quando
--    catalog_id é nulo (linhas legadas, ex.: anteriores à coluna catalog_id existir), e trata
--    uma eventual discordância entre os dois como referência inconsistente (bloqueia por
--    segurança em vez de confiar ciegamente em um dos dois). Histórico pré-existente é 100%
--    preservado -- só dispara em INSERT/UPDATE OF exercise_id, nunca em UPDATE de outras
--    colunas (note, set_details etc.), então nenhum treino já registrado é tocado.
-- ============================================================================================
create or replace function public._validate_workout_exercise_published() returns trigger
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ex public.exercises;
  v_by_id public.exercise_catalog;
  v_by_provider public.exercise_catalog;
  v_status text;
begin
  select * into v_ex from public.exercises where id = new.exercise_id;
  if v_ex.id is null or v_ex.source <> 'catalog' then
    return new;  -- source='custom', ou linha inexistente (a FK já garante existência)
  end if;

  if v_ex.catalog_id is not null then
    select * into v_by_id from public.exercise_catalog where id = v_ex.catalog_id;
  end if;
  if v_ex.provider is not null and v_ex.provider_exercise_id is not null then
    select * into v_by_provider from public.exercise_catalog
      where provider = v_ex.provider and provider_exercise_id = v_ex.provider_exercise_id;
  end if;

  -- catalog_id é o atalho preferido, mas só confiamos nele se concordar com provider+id quando
  -- ambos resolvem. Discordância = referência inconsistente = trata como indisponível.
  if v_by_id.id is not null and v_by_provider.id is not null and v_by_id.id <> v_by_provider.id then
    raise exception 'catalog_exercise_not_published' using errcode = 'P0001';
  end if;

  v_status := coalesce(v_by_id.status, v_by_provider.status);
  -- Nenhuma referência resolvível (linha legada sem catalog_id e sem provider/id reconhecível
  -- em exercise_catalog): não bloqueia -- preserva compatibilidade com dados legados; não é
  -- papel desta trigger decidir validade de criação, só impedir uso de algo conhecidamente
  -- não-publicado.
  if v_status is not null and v_status <> 'published' then
    raise exception 'catalog_exercise_not_published' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger workouts_validate_exercise_published
  before insert or update of exercise_id on public.workouts
  for each row execute function public._validate_workout_exercise_published();
revoke all on function public._validate_workout_exercise_published() from public, anon, authenticated;

-- ============================================================================================
-- 8) sync_workout_mutations: reconhece os erros de negócio acima como rejeição definitiva,
--    em vez de mascará-los como 'INTERNAL'. CORPO REAL extraído via pg_get_functiondef contra
--    todas as migrations anteriores aplicadas (não o corpo original de
--    20261016000001_offline_workout_sync.sql!): 20261113000001_session_revocation_guard.sql e
--    20261114000001_financial_auth_integration.sql já tinham endurecido esta função depois da
--    sua criação (guard de SESSION_REVOKED). Recriar a partir do corpo original, como uma
--    primeira versão deste arquivo fez, reverteria esse hardening -- erro real encontrado pelo
--    CI (offline_workout_sync_test.sql, testes 14-18 esperando SESSION_REVOKED e recebendo
--    APP_ACCESS_DENIED). Só a lista de sqlerrm reconhecidos ganha as duas mensagens novas; o
--    resto é idêntico ao estado real atual. settle() no frontend
--    (src/services/offline/syncEngine.js) já trata QUALQUER status='rejected' como falha
--    terminal (nunca reenviado automaticamente) -- confirmado lendo o código: o ganho aqui é a
--    mensagem/código correto para a UI (src/services/offline/syncActions.js), não a ausência de
--    retry (que já não existia).
-- ============================================================================================
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
        v_result := private.apply_workout_mutation(v_uid, v_item);
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
              'TYPE_IMMUTABLE', 'CREATED_AT_IMMUTABLE',
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

-- ============================================================================================
-- 9) Validação real de imagem antes de publicar: consulta a fonte de verdade
--    (exercise_visual_sets/exercise_visual_assets + storage.objects, não o cache jsonb
--    published_media_refs). Precisa existir um conjunto PUBLISHED para este catalog_id, com
--    assets start/end no bucket público, metadados de imagem coerentes (mime/dimensões/
--    tamanho) E o objeto realmente presente em storage.objects (Supabase Storage é apoiado
--    pela própria tabela storage.objects neste Postgres -- sem chamada HTTP, sem corrida entre
--    "achou a linha" e "o arquivo existe").
-- ============================================================================================
create or replace function private._exercise_has_valid_published_visuals(p_catalog_id uuid) returns boolean
  language plpgsql stable as $$
declare
  v_ok boolean;
begin
  select exists (
    select 1 from public.exercise_visual_sets evs
    where evs.catalog_id = p_catalog_id and evs.status = 'published'
      and exists (
        select 1 from public.exercise_visual_assets a
        join storage.objects o on o.bucket_id = a.storage_bucket and o.name = a.storage_path
        where a.visual_set_id = evs.id and a.role = 'start'
          and a.storage_bucket = 'exercise-visuals'
          and a.mime_type like 'image/%' and coalesce(a.width, 0) > 0
          and coalesce(a.height, 0) > 0 and coalesce(a.byte_size, 0) > 0
      )
      and exists (
        select 1 from public.exercise_visual_assets a
        join storage.objects o on o.bucket_id = a.storage_bucket and o.name = a.storage_path
        where a.visual_set_id = evs.id and a.role = 'end'
          and a.storage_bucket = 'exercise-visuals'
          and a.mime_type like 'image/%' and coalesce(a.width, 0) > 0
          and coalesce(a.height, 0) > 0 and coalesce(a.byte_size, 0) > 0
      )
  ) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- ============================================================================================
-- 10) allocate_exercise_visual_set: CORPO REAL extraído via pg_get_functiondef (não o de
--     20261021000001_exercise_visuals_v2.sql!): já tinha sido endurecido depois da criação --
--     search_path termina em pg_temp e ganhou o guard de SESSION_REVOKED
--     (20261113000001/20261114000001, mesma função atingida pelo DO block que varre
--     SECURITY DEFINER cujo corpo chama public.is_superadmin()). Recriar do corpo original
--     reverteria os dois; erro real encontrado pelo CI (security_followup_test.sql).
--     Única mudança de conteúdo real: "and is_active" -> "and status <> 'withdrawn'" (libera
--     draft/in_review para receber imagem; continua bloqueando retirado). Sem essa correção,
--     status='draft' nunca teria is_active=true e ninguém conseguiria alocar imagem antes de
--     publicar -- deadlock.
-- ============================================================================================
create or replace function public.allocate_exercise_visual_set(
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
  language plpgsql security definer set search_path = public, pg_temp as $$
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
  if auth.uid() is not null and not private.current_session_active() then raise exception 'SESSION_REVOKED'; end if;
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

  perform private.lock_exercise_visual_catalog(p_catalog_id);

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

  perform 1 from public.exercise_catalog where id = p_catalog_id and status <> 'withdrawn' for key share;
  if not found then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;

  if (select count(*) from public.exercise_visual_sets
        where created_by = v_uid and created_at > now() - interval '1 hour') >= 40 then
    raise exception 'RATE_LIMITED' using errcode = '54000';
  end if;

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
      p_metadata || jsonb_build_object('source', p_generation_source, 'styleVersion', v_profile.name)
    );
  exception when unique_violation then
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

-- ============================================================================================
-- 11) private.apply_published_visual_set: núcleo COMPARTILHADO por publish_exercise_visual_internal
--     E restore_exercise_visual_version (ambos só chamam esta função com p_from_status
--     diferente) -- um único guard aqui cobre os dois, sem precisar recriar os wrappers
--     públicos. CORPO REAL extraído via pg_get_functiondef, não o de
--     20261020000001_exercise_visuals.sql: o lock mudou de "for update" na linha de
--     exercise_catalog para private.lock_exercise_visual_catalog() (advisory, mesma função que
--     allocate_exercise_visual_set usa) e ganhou chamadas a
--     private.set_visual_audit_context() para a auditoria atribuir o ator certo -- mudanças de
--     alguma migration posterior a 20261021000001 que recriar do corpo antigo perderia. Única
--     adição real: o bloco "CORREÇÃO" abaixo. Antes desta correção, só
--     allocate_exercise_visual_set tinha o guard de retirada -- um conjunto já alocado ANTES da
--     retirada ainda podia ser publicado ou restaurado depois.
-- ============================================================================================
create or replace function private.apply_published_visual_set(p_set_id uuid, p_actor uuid, p_from_status text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $$
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
  -- CORREÇÃO: exercício retirado depois da alocação não pode ganhar imagem publicada nem ter
  -- versão restaurada. Cobre publish (p_from_status='review') e restore
  -- (p_from_status='archived') de uma vez, pois ambos passam por aqui.
  if exists (select 1 from public.exercise_catalog where id = v_catalog_id and status = 'withdrawn') then
    raise exception 'CATALOG_WITHDRAWN' using errcode = '55000';
  end if;
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

-- ============================================================================================
-- 12) RPCs de conteúdo do catálogo (SECURITY DEFINER, superadmin-only). Padrão de segurança em
--     TODAS: auth.uid() is null -> NOT_AUTHENTICATED; current_session_active() falso ->
--     SESSION_REVOKED (bloqueia sessão revogada, mesmo padrão de
--     20261114000001_financial_auth_integration.sql); not is_superadmin() -> FORBIDDEN;
--     REVOKE ALL FROM public, anon + GRANT EXECUTE TO authenticated (a própria função decide,
--     nunca confia só no GRANT).
-- ============================================================================================

-- --- Criar rascunho ---------------------------------------------------------------------------
create or replace function public.admin_create_catalog_exercise_draft(
  p_name text,
  p_primary_muscle text default null,
  p_muscles text[] default null,
  p_equipment text default null,
  p_category text default null,
  p_difficulty text default null,
  p_force text default null,
  p_mechanic text default null,
  p_instructions text[] default null,
  p_safety_notes text[] default null,
  p_provider_exercise_id text default null
) returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exercise_catalog;
  v_provider_exercise_id text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) < 1 or char_length(p_name) > 150 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  v_provider_exercise_id := coalesce(p_provider_exercise_id, 'manual-' || replace(gen_random_uuid()::text, '-', ''));
  if char_length(v_provider_exercise_id) > 100 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  -- Conteúdo autoral da equipe via painel (distinto de 'evolutus_dataset', reservado ao
  -- importador do dataset free-exercise-db) -- preserva a origem real do exercício.
  insert into public.exercise_catalog (
    provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category,
    difficulty, force, mechanic, instructions, safety_notes, status, created_by
  ) values (
    'evolutus_original', v_provider_exercise_id, trim(p_name), p_primary_muscle, p_muscles, p_equipment,
    p_category, p_difficulty, p_force, p_mechanic, p_instructions, p_safety_notes, 'draft', v_uid
  ) returning * into v_row;

  insert into public.admin_audit_log (admin_user_id, action, metadata)
  values (v_uid, 'catalog_exercise_draft_created', jsonb_build_object('catalogId', v_row.id, 'name', v_row.name));

  return v_row;
end;
$$;
revoke all on function public.admin_create_catalog_exercise_draft
  (text, text, text[], text, text, text, text, text, text[], text[], text) from public, anon;
grant execute on function public.admin_create_catalog_exercise_draft
  (text, text, text[], text, text, text, text, text, text[], text[], text) to authenticated;

-- --- Editar conteúdo (full replace; protege a versão PUBLICADA via pending_content) -----------
create or replace function public.admin_update_catalog_exercise_content(
  p_id uuid,
  p_name text,
  p_primary_muscle text,
  p_muscles text[],
  p_equipment text,
  p_category text,
  p_difficulty text,
  p_force text,
  p_mechanic text,
  p_instructions text[],
  p_safety_notes text[]
) returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_before public.exercise_catalog;
  v_after public.exercise_catalog;
  v_content jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_name is null or char_length(trim(p_name)) < 1 or char_length(p_name) > 150 then
    raise exception 'INVALID_ARGUMENT' using errcode = '22023';
  end if;

  select * into v_before from public.exercise_catalog where id = p_id for update;
  if v_before.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_before.status = 'withdrawn' then raise exception 'INVALID_STATE' using errcode = '55000'; end if;

  v_content := jsonb_build_object(
    'name', trim(p_name), 'primaryMuscle', p_primary_muscle, 'muscles', to_jsonb(p_muscles),
    'equipment', p_equipment, 'category', p_category, 'difficulty', p_difficulty,
    'force', p_force, 'mechanic', p_mechanic, 'instructions', to_jsonb(p_instructions),
    'safetyNotes', to_jsonb(p_safety_notes)
  );

  if v_before.published_at is not null then
    -- Já foi publicado alguma vez: o conteúdo AO VIVO (o que busca pública/offline/biblioteca
    -- pessoal continuam lendo) não é tocado -- fica em pending_content até republicar
    -- (admin_publish_catalog_exercise revalida tudo de novo antes de aplicar).
    update public.exercise_catalog set pending_content = v_content, status = 'in_review'
      where id = p_id returning * into v_after;
  else
    update public.exercise_catalog set
      name = trim(p_name), primary_muscle = p_primary_muscle, muscles = p_muscles,
      equipment = p_equipment, category = p_category, difficulty = p_difficulty,
      force = p_force, mechanic = p_mechanic, instructions = p_instructions,
      safety_notes = p_safety_notes, pending_content = null
    where id = p_id returning * into v_after;
  end if;

  insert into public.admin_audit_log (admin_user_id, action, metadata)
  values (v_uid, 'catalog_exercise_content_updated',
    jsonb_build_object('catalogId', p_id, 'stagedAsPending', v_before.published_at is not null));

  return v_after;
end;
$$;
revoke all on function public.admin_update_catalog_exercise_content
  (uuid, text, text, text[], text, text, text, text, text, text[], text[]) from public, anon;
grant execute on function public.admin_update_catalog_exercise_content
  (uuid, text, text, text[], text, text, text, text, text, text[], text[]) to authenticated;

-- --- Submeter a revisão ------------------------------------------------------------------------
create or replace function public.admin_submit_catalog_exercise_for_review(p_id uuid)
  returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exercise_catalog;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_row from public.exercise_catalog where id = p_id for update;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'draft' then raise exception 'INVALID_STATE' using errcode = '55000'; end if;

  update public.exercise_catalog set status = 'in_review' where id = p_id returning * into v_row;

  insert into public.admin_audit_log (admin_user_id, action, metadata)
  values (v_uid, 'catalog_exercise_submitted_for_review', jsonb_build_object('catalogId', p_id));

  return v_row;
end;
$$;
revoke all on function public.admin_submit_catalog_exercise_for_review(uuid) from public, anon;
grant execute on function public.admin_submit_catalog_exercise_for_review(uuid) to authenticated;

-- --- Publicar: aplica pending_content (se houver), exige texto completo E imagem real ---------
create or replace function public.admin_publish_catalog_exercise(p_id uuid)
  returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exercise_catalog;
  v_pending jsonb;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_row from public.exercise_catalog where id = p_id for update;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status not in ('draft', 'in_review') then raise exception 'INVALID_STATE' using errcode = '55000'; end if;

  v_pending := v_row.pending_content;
  if v_pending is not null then
    update public.exercise_catalog set
      name = coalesce(v_pending->>'name', name),
      primary_muscle = v_pending->>'primaryMuscle',
      muscles = case when v_pending->'muscles' is null then null
                     else (select array_agg(x) from jsonb_array_elements_text(v_pending->'muscles') x) end,
      equipment = v_pending->>'equipment',
      category = v_pending->>'category',
      difficulty = v_pending->>'difficulty',
      force = v_pending->>'force',
      mechanic = v_pending->>'mechanic',
      instructions = case when v_pending->'instructions' is null then null
                     else (select array_agg(x) from jsonb_array_elements_text(v_pending->'instructions') x) end,
      safety_notes = case when v_pending->'safetyNotes' is null then null
                     else (select array_agg(x) from jsonb_array_elements_text(v_pending->'safetyNotes') x) end,
      pending_content = null
    where id = p_id returning * into v_row;
  end if;

  if v_row.name is null
     or v_row.primary_muscle is null
     or v_row.muscles is null or array_length(v_row.muscles, 1) is null
     or v_row.category is null
     or v_row.instructions is null or array_length(v_row.instructions, 1) is null then
    raise exception 'INCOMPLETE_CONTENT' using errcode = '22023';
  end if;
  if not private._exercise_has_valid_published_visuals(p_id) then
    raise exception 'INCOMPLETE_VISUAL_SET' using errcode = '22023';
  end if;

  update public.exercise_catalog set
    status = 'published', published_at = now(), published_by = v_uid,
    withdrawn_at = null, withdrawn_by = null, withdrawal_reason = null
  where id = p_id
  returning * into v_row;

  insert into public.admin_audit_log (admin_user_id, action, metadata)
  values (v_uid, 'catalog_exercise_published', jsonb_build_object('catalogId', p_id, 'revision', v_row.revision));

  return v_row;
end;
$$;
revoke all on function public.admin_publish_catalog_exercise(uuid) from public, anon;
grant execute on function public.admin_publish_catalog_exercise(uuid) to authenticated;

-- --- Retirar: motivo OBRIGATÓRIO, soft (nunca apaga a linha) ----------------------------------
create or replace function public.admin_withdraw_catalog_exercise(p_id uuid, p_reason text)
  returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_before public.exercise_catalog;
  v_row public.exercise_catalog;
  v_reason text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  v_reason := trim(coalesce(p_reason, ''));
  if v_reason = '' then raise exception 'REASON_REQUIRED' using errcode = '22023'; end if;
  if char_length(v_reason) > 500 then raise exception 'INVALID_ARGUMENT' using errcode = '22023'; end if;

  select * into v_before from public.exercise_catalog where id = p_id for update;
  if v_before.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_before.status = 'withdrawn' then raise exception 'INVALID_STATE' using errcode = '55000'; end if;

  update public.exercise_catalog set
    status = 'withdrawn', withdrawn_at = now(), withdrawn_by = v_uid, withdrawal_reason = v_reason
  where id = p_id
  returning * into v_row;

  insert into public.admin_audit_log (admin_user_id, action, reason, metadata)
  values (v_uid, 'catalog_exercise_withdrawn', v_reason,
    jsonb_build_object('catalogId', p_id, 'previousStatus', v_before.status));

  return v_row;
end;
$$;
revoke all on function public.admin_withdraw_catalog_exercise(uuid, text) from public, anon;
grant execute on function public.admin_withdraw_catalog_exercise(uuid, text) to authenticated;

-- --- Restaurar: sempre volta para in_review, nunca published direto ---------------------------
create or replace function public.admin_restore_catalog_exercise(p_id uuid)
  returns public.exercise_catalog
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_row public.exercise_catalog;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_row from public.exercise_catalog where id = p_id for update;
  if v_row.id is null then raise exception 'CATALOG_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.status <> 'withdrawn' then raise exception 'INVALID_STATE' using errcode = '55000'; end if;

  update public.exercise_catalog set
    status = 'in_review', withdrawn_at = null, withdrawn_by = null, withdrawal_reason = null
  where id = p_id
  returning * into v_row;

  insert into public.admin_audit_log (admin_user_id, action, metadata)
  values (v_uid, 'catalog_exercise_restored', jsonb_build_object('catalogId', p_id));

  return v_row;
end;
$$;
revoke all on function public.admin_restore_catalog_exercise(uuid) from public, anon;
grant execute on function public.admin_restore_catalog_exercise(uuid) to authenticated;

-- --- Listagem paginada p/ painel (todas as seções, diferente da busca pública) -----------------
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
      -- Mesmo sinal que o antigo /admin/exercicios-imagens usava (onlyMissing via
      -- published_media_refs->version): indicador de exibição/triagem, não o portão de
      -- publicação (esse continua validando contra exercise_visual_sets/assets/storage.objects
      -- de verdade em admin_publish_catalog_exercise). Filtra no SERVIDOR, contra a tabela
      -- inteira -- nunca só a página já carregada.
      and (not p_only_missing_images or not (ec.published_media_refs ? 'version'))
    order by ec.updated_at desc
    limit least(greatest(p_limit, 1), 50)
    offset greatest(p_offset, 0);
end;
$$;
revoke all on function public.admin_list_catalog_exercises(text, text, text, integer, integer, boolean) from public, anon;
grant execute on function public.admin_list_catalog_exercises(text, text, text, integer, integer, boolean) to authenticated;

-- ============================================================================================
-- 13) Auditoria: leitura filtrada (admin_audit_log já existe e é reaproveitada -- não cria
--     tabela nova; admin_list_audit_log existente é indexada por target_user_id, que aqui é
--     sempre nulo, por isso uma RPC/índice próprios).
-- ============================================================================================
create index admin_audit_log_catalog_idx on public.admin_audit_log ((metadata->>'catalogId'), created_at desc)
  where action like 'catalog_exercise_%';

create or replace function public.admin_list_catalog_audit_log(
  p_catalog_id uuid default null,
  p_action_filter text default null,
  p_limit integer default 50
) returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 200 then raise exception 'INVALID_ARGUMENT' using errcode = '22023'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'action', l.action, 'reason', l.reason, 'metadata', l.metadata,
      'created_at', l.created_at, 'admin_user_id', l.admin_user_id, 'admin_username', a.username
    ) order by l.created_at desc, l.id)
    from (
      select * from public.admin_audit_log
      where action like 'catalog_exercise_%'
        and (p_action_filter is null or action = p_action_filter)
        and (p_catalog_id is null or (metadata->>'catalogId') = p_catalog_id::text)
      order by created_at desc, id
      limit p_limit
    ) l
    left join public.users a on a.id = l.admin_user_id
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_catalog_audit_log(uuid, text, integer) from public, anon;
grant execute on function public.admin_list_catalog_audit_log(uuid, text, integer) to authenticated;
