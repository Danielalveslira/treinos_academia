-- RPC dedicada para a criação gratuita (em vez de ramificar create_community): menor raio de
-- mudança numa função já crítica, reaproveita 100% do padrão de idempotência (Padrão A) e da
-- elegibilidade compartilhada (private.community_creation_state/community_creation_blocker,
-- já simplificada na migration anterior). Sem débito, sem ledger -- não é operação financeira;
-- nenhuma linha fictícia de valor 0 é gravada em economy_transactions.

-- community_creation_requests.kind foi criado inline (sem nome) -- introspecção estrutural via
-- conkey (não casar texto: o Postgres pode normalizar "kind IN (...)" para
-- "kind = ANY (ARRAY[...])" no texto reconstruído por pg_get_constraintdef, o que faria um
-- casamento ILIKE falhar silenciosamente e deixar o check antigo vivo).
do $$
declare
  v_conname text;
  v_kind_attnum smallint;
begin
  select attnum into v_kind_attnum from pg_attribute
    where attrelid = 'public.community_creation_requests'::regclass and attname = 'kind' and not attisdropped;

  select conname into v_conname from pg_constraint
    where conrelid = 'public.community_creation_requests'::regclass
      and contype = 'c' and conkey = array[v_kind_attnum];
  if v_conname is not null then
    execute format('alter table public.community_creation_requests drop constraint %I', v_conname);
  end if;
end $$;
alter table public.community_creation_requests
  add constraint community_creation_requests_kind_ck check (kind in ('create', 'create_free', 'upgrade'));

create or replace function public.create_free_community(
  p_name text, p_description text, p_icon_name text, p_post_access text, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_post_access text := coalesce(p_post_access, 'everyone');
  v_hash text;
  v_existing public.community_creation_requests;
  v_state jsonb;
  v_blocker text;
  v_community_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if v_post_access not in ('everyone', 'admins') then raise exception 'INVALID_POST_ACCESS'; end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'INVALID_NAME'; end if;
  if char_length(v_description) > 300 then raise exception 'INVALID_DESCRIPTION'; end if;

  -- Mesmo namespace de lock que create_community/upgrade_community_tier: serializa
  -- corretamente chamadas concorrentes de qualquer combinação dessas 3 RPCs do mesmo usuário.
  perform pg_advisory_xact_lock(hashtextextended('community_creation:' || v_uid::text, 0));

  -- Hash sobre uma serialização jsonb estruturada (chave->valor), não concat_ws com
  -- delimitador: concatenar texto com '|' é ambíguo quando um campo contém '|' (ex.: nome
  -- "a|b" + descrição "c" produziria a mesma string que nome "a" + descrição "b|c"). jsonb_build_object
  -- escapa cada valor como string JSON própria (aspas/caracteres especiais nunca se fundem com
  -- o campo vizinho) e seu ::text é determinístico para o mesmo conjunto de chaves/valores.
  v_hash := md5(jsonb_build_object(
    'name', v_name, 'description', v_description, 'iconName', p_icon_name, 'postAccess', v_post_access
  )::text);
  select * into v_existing from public.community_creation_requests
    where user_id = v_uid and request_id = p_idempotency_key;
  if found then
    if v_existing.kind <> 'create_free' or v_existing.input_hash <> v_hash then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('id', v_existing.community_id, 'replay', true, 'tier', v_existing.tier);
  end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  -- Elegibilidade recalculada no servidor, nunca confiada ao cliente -- mesmo gate do fluxo
  -- pago (já sem os requisitos de dias de conta/atividade, ver migration anterior).
  v_state := private.community_creation_state(v_uid);
  v_blocker := private.community_creation_blocker(v_state);
  if v_blocker is not null then raise exception '%', v_blocker; end if;

  if exists (select 1 from public.community_free_creation_grants where user_id = v_uid) then
    raise exception 'FREE_BENEFIT_ALREADY_USED';
  end if;

  insert into public.communities (name, description, icon_name, is_active, post_access, created_by, owner_id, tier, post_retention_mode)
    values (v_name, v_description, p_icon_name, true, v_post_access, v_uid, v_uid, 'starter', '24h')
    returning id into v_community_id;
  insert into public.community_members (community_id, user_id) values (v_community_id, v_uid);

  begin
    insert into public.community_free_creation_grants (user_id, community_id, source)
      values (v_uid, v_community_id, 'new_user');
  exception when unique_violation then
    -- Defesa redundante: o advisory lock por usuário já deveria ter impedido isso. Se algum
    -- caminho futuro pular o lock, a PK em user_id ainda garante "uma vez só", convertendo a
    -- violação em erro de negócio em vez de vazar um erro de banco cru.
    raise exception 'FREE_BENEFIT_ALREADY_USED';
  end;

  insert into public.community_creation_requests
    (user_id, request_id, community_id, input_hash, kind, tier, payment_asset, amount_charged)
    values (v_uid, p_idempotency_key, v_community_id, v_hash, 'create_free', 'starter', null, null);

  return jsonb_build_object('id', v_community_id, 'replay', false, 'tier', 'starter');
end;
$$;
revoke all on function public.create_free_community(text, text, text, text, text) from public, anon;
grant execute on function public.create_free_community(text, text, text, text, text) to authenticated;

-- get_my_community_creation_eligibility ganha freeCommunityAvailable (o benefício ainda não
-- foi usado) -- sem isso o frontend não tem como decidir se mostra "Grátis" como opção sem
-- chamar create_free_community especulativamente. Mesma assinatura (sem parâmetros): CREATE OR
-- REPLACE seguro. Corpo idêntico ao efetivo em produção (20261114000003, com guard de sessão),
-- só acrescentando o campo novo.
create or replace function public.get_my_community_creation_eligibility()
returns jsonb
stable language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_state jsonb;
  v_wallet public.wallets;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  v_state := private.community_creation_state(v_uid);
  select * into v_wallet from public.wallets where user_id = v_uid;

  return jsonb_build_object(
    'eligible', (v_state->>'eligible')::boolean,
    'accountDays', v_state->'accountDays',
    'requiredAccountDays', v_state->'requiredAccountDays',
    'qualifiedDays', v_state->'qualifiedDays',
    'requiredQualifiedDays', v_state->'requiredQualifiedDays',
    'activeWindowDays', v_state->'activeWindowDays',
    'qualifiedToday', v_state->'qualifiedToday',
    'emailVerified', v_state->'emailVerified',
    'accountStanding', case when (v_state->>'standingOk')::boolean then 'regular' else 'unavailable' end,
    'activeOwnedCommunities', v_state->'activeOwnedCommunities',
    'communityLimit', v_state->'communityLimit',
    'evoCoinsBalance', coalesce(v_wallet.coin_balance, 0),
    'evoCashBalance', coalesce(v_wallet.cash_balance, 0),
    'freeCommunityAvailable', not exists (
      select 1 from public.community_free_creation_grants where user_id = v_uid
    )
  );
end;
$$;
