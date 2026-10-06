-- Sincronização de treinos registrados OFFLINE (Fase 3 do plano PWA offline-first).
--
-- O que existe aqui e por quê:
--  1. workouts.updated_at: a tabela não tinha NENHUM controle de concorrência. Sem ele não dá para
--     saber se o treino mudou em outro aparelho desde que este o leu -- e "nunca sobrescrever
--     silenciosamente um treino remoto" exige essa informação. É o mínimo necessário (uma coluna +
--     um gatilho); nenhuma regra de negócio muda.
--  2. offline_mutation_receipts: recibo por (usuário, mutation_id). Reenviar a MESMA mutação (retry
--     depois de uma conexão que caiu entre o servidor aplicar e o cliente receber o ACK) devolve o
--     mesmo resultado e nunca reaplica.
--  3. sync_workout_mutations(): RPC em lote, resultado individual por mutação. Identidade vem SEMPRE
--     de auth.uid(); o cliente não informa user_id (e é rejeitado se tentar).
--
-- Esta função NÃO concede EvoCoins e NÃO chama complete_workout_session: sincronizar registros de
-- treino é só gravar linhas em public.workouts, exatamente como o INSERT/UPDATE/DELETE direto de hoje.
-- Finalizar treino (e qualquer recompensa) continua sendo um evento online, decidido pelo servidor.
-- workouts.created_at segue sendo forçado a now() pelo gatilho existente em INSERTs de cliente: um
-- registro criado offline e sincronizado depois tem o carimbo do servidor da sincronização.

-- 1) updated_at --------------------------------------------------------------------------------
alter table public.workouts add column if not exists updated_at timestamptz;
-- Linhas existentes: "nunca editadas desde a criação" ⇔ updated_at = created_at (usado abaixo para
-- tratar mutações sem versão-base conhecida). Ainda não há gatilho de toque, então nada é alterado
-- além da própria coluna.
update public.workouts set updated_at = created_at where updated_at is null;
alter table public.workouts
  alter column updated_at set default now(),
  alter column updated_at set not null;

create or replace function private.workouts_touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- clock_timestamp(), não now(): now() é o início da TRANSAÇÃO, então dois UPDATEs seguidos (ou duas
  -- mutações do mesmo registro no mesmo lote) teriam a mesma versão e escapariam da detecção de conflito.
  -- No INSERT a linha nasce "nunca editada": updated_at = created_at (o gatilho workouts_server_created_at
  -- dispara antes, por ordem alfabética, e já fixou created_at). É esse igual que as mutações sem versão-base
  -- usam para saber que ninguém mexeu no registro.
  new.updated_at := case when tg_op = 'INSERT' then new.created_at else clock_timestamp() end;
  return new;
end;
$$;
revoke all on function private.workouts_touch_updated_at() from public, anon, authenticated;

drop trigger if exists workouts_touch_updated_at on public.workouts;
create trigger workouts_touch_updated_at before insert or update on public.workouts
  for each row execute function private.workouts_touch_updated_at();

-- 2) Recibos de idempotência -----------------------------------------------------------------------
create table if not exists public.offline_mutation_receipts (
  user_id uuid not null references public.users(id) on delete cascade,
  mutation_id uuid not null,
  operation text not null check (operation in ('workout.create', 'workout.update', 'workout.delete')),
  entity_id uuid not null,
  outcome text not null check (outcome in ('applied', 'already_applied')),
  server_updated_at timestamptz,
  applied_at timestamptz not null default now(),
  primary key (user_id, mutation_id)
);
-- Só a função DEFINER lê/escreve; nenhuma policy e nenhum privilégio para clientes.
alter table public.offline_mutation_receipts enable row level security;
revoke all on public.offline_mutation_receipts from public, anon, authenticated;

-- 3) Aplicação de UMA mutação -----------------------------------------------------------------------
create or replace function private.apply_workout_mutation(p_uid uuid, p_item jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  c_item_keys constant text[] := array['mutation_id', 'operation', 'entity_id', 'payload', 'base_updated_at'];
  c_payload_keys constant text[] := array['exercise_id', 'date', 'type', 'set_details', 'sets',
    'duration_minutes', 'distance_km', 'note'];
  v_mid uuid;
  v_eid uuid;
  v_op text;
  v_payload jsonb;
  v_base timestamptz;
  v_receipt public.offline_mutation_receipts%rowtype;
  v_row public.workouts%rowtype;
  v_new public.workouts%rowtype;
  v_exercise uuid;
  v_type text;
  v_sets jsonb;
  v_date date;
  v_note text;
  v_duration numeric;
  v_distance numeric;
  v_count integer;
  v_same boolean;
begin
  if jsonb_typeof(p_item) <> 'object' then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_MUTATION');
  end if;
  if exists (select 1 from jsonb_object_keys(p_item) k where k <> all (c_item_keys)) then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_MUTATION');
  end if;
  if coalesce(p_item->>'mutation_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('status', 'rejected', 'code', 'INVALID_MUTATION_ID');
  end if;
  v_mid := (p_item->>'mutation_id')::uuid;
  if coalesce(p_item->>'entity_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return jsonb_build_object('mutation_id', v_mid, 'status', 'rejected', 'code', 'INVALID_ENTITY_ID');
  end if;
  v_eid := (p_item->>'entity_id')::uuid;
  v_op := p_item->>'operation';
  if v_op is null or v_op not in ('workout.create', 'workout.update', 'workout.delete') then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected',
      'code', 'UNSUPPORTED_OPERATION');
  end if;

  -- Duas requisições da MESMA mutação (aba duplicada, retry sobreposto) se serializam aqui: a segunda
  -- espera a primeira confirmar e então enxerga o recibo.
  perform pg_advisory_xact_lock(hashtextextended(p_uid::text || ':' || v_mid::text, 0));

  select * into v_receipt from public.offline_mutation_receipts
    where user_id = p_uid and mutation_id = v_mid;
  if found then
    if v_receipt.operation <> v_op or v_receipt.entity_id <> v_eid then
      return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected',
        'code', 'MUTATION_ID_REUSED');
    end if;
    select * into v_row from public.workouts where id = v_eid and user_id = p_uid;
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'already_applied',
      'server_updated_at', coalesce(v_row.updated_at, v_receipt.server_updated_at),
      'row', case when found then to_jsonb(v_row) end);
  end if;

  if p_item ? 'base_updated_at' and jsonb_typeof(p_item->'base_updated_at') not in ('string', 'null') then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'INVALID_PAYLOAD');
  end if;
  v_base := nullif(p_item->>'base_updated_at', '')::timestamptz;

  ------------------------------------------------------------------ delete
  if v_op = 'workout.delete' then
    select * into v_row from public.workouts where id = v_eid and user_id = p_uid for update;
    if not found then
      -- Já não existe (apagado aqui antes ou em outro aparelho): o estado desejado já vale.
      insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome)
        values (p_uid, v_mid, v_op, v_eid, 'already_applied');
      return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'already_applied');
    end if;
    if v_row.updated_at is distinct from coalesce(v_base, v_row.created_at) then
      -- Alterado em outro aparelho desde o que este viu: não apaga trabalho que mudou.
      return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'conflict',
        'code', 'CONFLICT', 'server_row', to_jsonb(v_row));
    end if;
    delete from public.workouts where id = v_eid and user_id = p_uid;
    insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome)
      values (p_uid, v_mid, v_op, v_eid, 'applied');
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'applied');
  end if;

  ------------------------------------------------------- payload (create/update)
  v_payload := p_item->'payload';
  if v_payload is null or jsonb_typeof(v_payload) <> 'object'
     or exists (select 1 from jsonb_object_keys(v_payload) k where k <> all (c_payload_keys)) then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'INVALID_PAYLOAD');
  end if;
  if coalesce(v_payload->>'exercise_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(v_payload->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     or coalesce(v_payload->>'type', '') not in ('strength', 'cardio')
     or jsonb_typeof(coalesce(v_payload->'note', 'null'::jsonb)) not in ('string', 'null')
     or jsonb_typeof(coalesce(v_payload->'duration_minutes', 'null'::jsonb)) not in ('number', 'null')
     or jsonb_typeof(coalesce(v_payload->'distance_km', 'null'::jsonb)) not in ('number', 'null')
     or jsonb_typeof(coalesce(v_payload->'sets', 'null'::jsonb)) not in ('number', 'null')
     or jsonb_typeof(coalesce(v_payload->'set_details', 'null'::jsonb)) not in ('array', 'null') then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'INVALID_PAYLOAD');
  end if;
  v_exercise := (v_payload->>'exercise_id')::uuid;
  v_type := v_payload->>'type';
  v_date := (v_payload->>'date')::date;            -- data impossível => 22008, tratado pelo chamador
  v_sets := v_payload->'set_details';
  v_note := v_payload->>'note';
  v_duration := (v_payload->>'duration_minutes')::numeric;
  v_distance := (v_payload->>'distance_km')::numeric;
  v_count := case when v_sets is null or jsonb_typeof(v_sets) <> 'array' then null else jsonb_array_length(v_sets) end;

  -- O exercício precisa ser do próprio usuário (o FK sozinho aceitaria o id de outra conta).
  if not exists (select 1 from public.exercises where id = v_exercise and user_id = p_uid) then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'EXERCISE_NOT_FOUND');
  end if;
  -- `sets` sempre derivado de set_details (nunca confiado ao cliente); o resto das regras
  -- (limites de peso/reps/duração, tamanho da nota, formato por tipo) são as CHECKs da tabela.
  if v_type = 'strength' and v_payload ? 'sets' and (v_payload->>'sets')::numeric is distinct from v_count then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'INVALID_PAYLOAD');
  end if;

  ------------------------------------------------------------------ create
  if v_op = 'workout.create' then
    select * into v_row from public.workouts where id = v_eid;
    if found then
      if v_row.user_id <> p_uid then
        -- Não revela que o id existe em outra conta.
        return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'ENTITY_ID_IN_USE');
      end if;
      -- A linha já existe e é deste usuário: o INSERT online chegou ao Postgres mas a resposta se perdeu
      -- (timeout) e a mesma criação voltou pela fila. Ali NÃO há recibo, então a decisão é pelo ESTADO:
      --   1) conteúdo igual ao da mutação            -> já aplicado (nada a fazer);
      --   2) linha nunca mexida desde o INSERT (ou versão-base igual à atual) e o conteúdo local mudou
      --      depois (edição feita offline e compactada neste create) -> aplica como atualização, para não
      --      perder a edição do usuário;
      --   3) linha alterada por OUTRO aparelho desde o INSERT e o conteúdo difere -> CONFLITO: nunca assume
      --      "já aplicado" (isso devolveria ao cliente a linha do servidor por cima do que o usuário fez)
      --      nem sobrescreve o que está no servidor.
      -- created_at nunca muda e nada aqui toca recompensa nem economia.
      select * into v_row from public.workouts where id = v_eid and user_id = p_uid for update;
      v_same := v_row.exercise_id = v_exercise and v_row.date = v_date and v_row.type = v_type
        and v_row.note is not distinct from v_note
        and v_row.set_details is not distinct from (case when v_type = 'strength' then v_sets end)
        and v_row.duration_minutes is not distinct from (case when v_type = 'cardio' then v_duration end)
        and v_row.distance_km is not distinct from (case when v_type = 'cardio' then v_distance end);
      if v_same then
        insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome, server_updated_at)
          values (p_uid, v_mid, v_op, v_eid, 'already_applied', v_row.updated_at);
        return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'already_applied',
          'server_updated_at', v_row.updated_at, 'row', to_jsonb(v_row));
      end if;
      if v_row.type <> v_type then
        return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'TYPE_IMMUTABLE');
      end if;
      if v_row.updated_at is distinct from coalesce(v_base, v_row.created_at) then
        return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'conflict',
          'code', 'CONFLICT', 'server_row', to_jsonb(v_row));
      end if;
      update public.workouts set
          exercise_id = v_exercise, date = v_date, note = v_note,
          set_details = case when v_type = 'strength' then v_sets end,
          sets = case when v_type = 'strength' then v_count end,
          duration_minutes = case when v_type = 'cardio' then v_duration end,
          distance_km = case when v_type = 'cardio' then v_distance end
        where id = v_eid and user_id = p_uid
        returning * into v_new;
      insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome, server_updated_at)
        values (p_uid, v_mid, v_op, v_eid, 'applied', v_new.updated_at);
      return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'applied',
        'server_updated_at', v_new.updated_at, 'row', to_jsonb(v_new));
    end if;
    insert into public.workouts (id, user_id, exercise_id, set_details, sets, date, note, type, duration_minutes, distance_km)
      values (v_eid, p_uid, v_exercise,
        case when v_type = 'strength' then v_sets end, case when v_type = 'strength' then v_count end,
        v_date, v_note, v_type,
        case when v_type = 'cardio' then v_duration end, case when v_type = 'cardio' then v_distance end)
      returning * into v_new;
    insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome, server_updated_at)
      values (p_uid, v_mid, v_op, v_eid, 'applied', v_new.updated_at);
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'applied',
      'server_updated_at', v_new.updated_at, 'row', to_jsonb(v_new));
  end if;

  ------------------------------------------------------------------ update
  select * into v_row from public.workouts where id = v_eid and user_id = p_uid for update;
  if not found then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'NOT_FOUND');
  end if;
  if v_row.type <> v_type then
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'rejected', 'code', 'TYPE_IMMUTABLE');
  end if;
  if v_row.updated_at is distinct from coalesce(v_base, v_row.created_at) then
    -- Mudou em outro aparelho. Se o resultado pedido já é exatamente o que está lá, nada a decidir.
    if v_row.exercise_id = v_exercise and v_row.date = v_date and v_row.note is not distinct from v_note
       and v_row.set_details is not distinct from (case when v_type = 'strength' then v_sets end)
       and v_row.duration_minutes is not distinct from (case when v_type = 'cardio' then v_duration end)
       and v_row.distance_km is not distinct from (case when v_type = 'cardio' then v_distance end) then
      insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome, server_updated_at)
        values (p_uid, v_mid, v_op, v_eid, 'already_applied', v_row.updated_at);
      return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'already_applied',
        'server_updated_at', v_row.updated_at, 'row', to_jsonb(v_row));
    end if;
    return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'conflict',
      'code', 'CONFLICT', 'server_row', to_jsonb(v_row));
  end if;
  update public.workouts set
      exercise_id = v_exercise, date = v_date, note = v_note,
      set_details = case when v_type = 'strength' then v_sets end,
      sets = case when v_type = 'strength' then v_count end,
      duration_minutes = case when v_type = 'cardio' then v_duration end,
      distance_km = case when v_type = 'cardio' then v_distance end
    where id = v_eid and user_id = p_uid
    returning * into v_new;
  insert into public.offline_mutation_receipts (user_id, mutation_id, operation, entity_id, outcome, server_updated_at)
    values (p_uid, v_mid, v_op, v_eid, 'applied', v_new.updated_at);
  return jsonb_build_object('mutation_id', v_mid, 'entity_id', v_eid, 'status', 'applied',
    'server_updated_at', v_new.updated_at, 'row', to_jsonb(v_new));
end;
$$;
revoke all on function private.apply_workout_mutation(uuid, jsonb) from public, anon, authenticated;

-- 4) RPC pública --------------------------------------------------------------------------------------
-- p_expected_user: o cliente informa de quem é a fila que está enviando; se a sessão atual for de
-- OUTRA conta (troca de usuário no meio do envio), o lote inteiro é recusado -- uma fila nunca é
-- aplicada sob a identidade errada. Não substitui auth.uid(): só impede o erro.
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
      -- Uma mutação anterior do mesmo registro falhou neste lote: esta não pode passar na frente.
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
            'code', case when sqlerrm in ('TYPE_IMMUTABLE', 'CREATED_AT_IMMUTABLE') then sqlerrm else 'INTERNAL' end);
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
