-- Etapa 3 do PROMPT_CORRECAO_LOGOUT_GLOBAL_EVOLUTUS: hoje nenhuma RPC/RLS confirma, no banco, que
-- a SESSÃO do JWT apresentado ainda existe em auth.sessions -- "sair de todos os dispositivos"
-- revoga o refresh token, mas o access token já emitido continua assinaturalmente válido até
-- `exp` (jwt_expiry = 3600s em supabase/config.toml). Sem este guard, uma sessão revogada em outro
-- aparelho continua executando operações autenticadas por até 1h, mesmo com o cliente já tendo
-- confirmado a revogação (ver AuthContext.jsx:revalidate, que agora usa auth.getUser()).
--
-- Raio de impacto desta migration: SÓ private.current_session_active() (nova) e
-- public.sync_workout_mutations (único call site alterado). NÃO toca public.has_app_access() nem
-- nenhuma RPC financeira/EvoCash/EvoCoins -- has_app_access() é chamado por ~25 objetos (incluindo
-- as RPCs de carteira/ledger que a auditoria financeira paralela está revisando agora em
-- supabase/migrations/20261112*), e boa parte dos testes pgTAP existentes simula sessão só com
-- `request.jwt.claim.sub` (sem `request.jwt.claims`/session_id): embuti-lo em has_app_access()
-- quebraria esses testes e o rollout financeiro em andamento sem relação com logout. A extensão
-- deste guard para outras RPCs (carteira, admin, perfil) é trabalho de follow-up, RPC por RPC, com
-- os testes de cada uma atualizados -- nunca uma alteração indiscriminada a cada leitura/policy.
--
-- Escolha do alvo: sync_workout_mutations (escrita de treino/sync offline) é a prioridade #2 do
-- Etapa 3.4 do prompt, não depende de has_app_access() para o guard em si, e seu teste já simula
-- sessão isolada por lote, sem efeito colateral em outras features.
set local lock_timeout = '5s';

-- =====================================================================================
-- private.current_session_active(): true quando o JWT da requisição atual carrega um claim
-- `session_id` que ainda existe em auth.sessions E pertence a auth.uid(). Único ponto que lê
-- auth.sessions -- nunca exposto via policy/Data API (o schema auth não é exposto ao PostgREST),
-- e nunca recebe session_id/user_id informado pelo cliente (lê exclusivamente do JWT já validado
-- pelo GoTrue, nunca de um parâmetro). JWT sem o claim (ex.: token emitido antes deste deploy,
-- service_role sem contexto de usuário) cai em `session_id is null` -> false: falha fechada, nunca
-- aberta. Mesmo padrão de private.has_account_standing() (20261105000001): sem grant/revoke
-- próprios -- "schema private" já revoga de public/anon/authenticated (20261002000003), então só é
-- alcançável de dentro de outra função SECURITY DEFINER.
-- Também confere `not_after` (timeout absoluto de sessão; coluna confirmada na versão real do
-- projeto via `information_schema.columns` -- nullable timestamptz): uma sessão cuja janela já
-- venceu é tratada como revogada mesmo que a linha ainda exista em auth.sessions.
-- =====================================================================================
create or replace function private.current_session_active() returns boolean
  language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from auth.sessions s
    -- O filtro de formato vem ANTES do cast: um claim ausente/malformado nunca pode lançar uma
    -- excepção dentro da RPC chamadora (cast inválido) -- só falha fechado, como qualquer outra
    -- sessão sem correspondência.
    where (auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      and s.id = (auth.jwt() ->> 'session_id')::uuid
      and s.user_id = auth.uid()
      and (s.not_after is null or s.not_after > now())
  )
$$;

-- =====================================================================================
-- public.sync_workout_mutations: mesma checagem de acesso (has_app_access) de hoje, com UMA
-- verificação adicional de sessão ativa antes de aplicar qualquer mutação do lote. Falha com
-- SESSION_REVOKED (nunca APP_ACCESS_DENIED, para o cliente poder distinguir "sem permissão" de
-- "sessão encerrada em outro aparelho" -- ver follow-up client-side em authService.js).
-- =====================================================================================
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
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
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
