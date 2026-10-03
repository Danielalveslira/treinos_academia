-- Criação de comunidades: elegibilidade, criação paga e upgrade -- tudo recalculado no banco.
--
-- Ordem fixa: ELEGIBILIDADE primeiro, PAGAMENTO depois. Nada que o cliente envia (saldo,
-- "eligible", preço, dias, tier->retenção) é confiado: a RPC lê preço de
-- community_creation_products, saldo de wallets, dias de public.users/auth.users e
-- community_creation_activity_days. owner_id vem sempre de auth.uid().
--
-- create_community_with_cash (fluxo antigo, requisitos de reputação + EvoCash) é removida:
-- mantê-la seria um atalho que ignora o novo gate.

drop function if exists public.create_community_with_cash(text, text, text, text);

-- Estado interno de elegibilidade. Devolve também sinais que NUNCA vão ao cliente de forma
-- detalhada (o motivo exato de restrição de conta, por exemplo).
create or replace function private.community_creation_state(p_uid uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_rules public.community_creation_rules;
  v_user public.users;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_account_days integer;
  v_qualified_days integer;
  v_qualified_today boolean;
  v_email_verified boolean;
  v_standing_ok boolean;
  v_owned integer;
begin
  select * into v_rules from public.community_creation_rules where id;
  if v_rules is null then raise exception 'CREATION_RULES_UNAVAILABLE'; end if;

  select * into v_user from public.users where id = p_uid;
  if v_user is null then raise exception 'NOT_AUTHENTICATED'; end if;

  v_account_days := greatest(floor(extract(epoch from (now() - v_user.created_at)) / 86400), 0)::integer;

  select count(*) filter (where qualified), coalesce(bool_or(qualified) filter (where activity_date = v_today), false)
    into v_qualified_days, v_qualified_today
  from public.community_creation_activity_days
  where user_id = p_uid
    and activity_date > v_today - v_rules.active_window_days
    and activity_date <= v_today;

  select coalesce((select au.email_confirmed_at is not null from auth.users au where au.id = p_uid), false)
    into v_email_verified;

  v_standing_ok := v_user.account_status = 'active'
    and not exists (
      select 1 from public.account_restrictions r
      where r.user_id = p_uid and not (r.action = 'temporary_suspension' and r.until <= now())
    );

  select count(*) into v_owned from public.communities c
    where c.owner_id = p_uid and c.is_active and c.deletion_status is null;

  return jsonb_build_object(
    'accountDays', v_account_days,
    'requiredAccountDays', v_rules.required_account_days,
    'qualifiedDays', v_qualified_days,
    'requiredQualifiedDays', v_rules.required_active_days,
    'activeWindowDays', v_rules.active_window_days,
    'qualifiedToday', v_qualified_today,
    'emailVerified', v_email_verified,
    'standingOk', v_standing_ok,
    'activeOwnedCommunities', v_owned,
    'communityLimit', v_rules.max_owned_communities,
    'eligible', v_standing_ok and v_email_verified
      and v_account_days >= v_rules.required_account_days
      and v_qualified_days >= v_rules.required_active_days
      and v_owned < v_rules.max_owned_communities
  );
end;
$$;
revoke all on function private.community_creation_state(uuid) from public, anon, authenticated;

-- Primeiro requisito que falha, como código curto (usado só pela criação).
create or replace function private.community_creation_blocker(p_state jsonb) returns text
language sql immutable set search_path = '' as $$
  select case
    when not (p_state->>'standingOk')::boolean then 'ACCOUNT_NOT_ELIGIBLE'
    when not (p_state->>'emailVerified')::boolean then 'EMAIL_NOT_VERIFIED'
    when (p_state->>'accountDays')::int < (p_state->>'requiredAccountDays')::int then 'ACCOUNT_TOO_NEW'
    when (p_state->>'qualifiedDays')::int < (p_state->>'requiredQualifiedDays')::int then 'NOT_ACTIVE_ENOUGH'
    when (p_state->>'activeOwnedCommunities')::int >= (p_state->>'communityLimit')::int then 'COMMUNITY_LIMIT_REACHED'
    else null
  end
$$;
revoke all on function private.community_creation_blocker(jsonb) from public, anon, authenticated;

-- Retorno mínimo para a UI: só o que ela precisa mostrar. Nada de heurística interna;
-- restrição/moderação vira apenas accountStanding = 'unavailable'.
create or replace function public.get_my_community_creation_eligibility() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_state jsonb;
  v_wallet public.wallets;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
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
    'evoCashBalance', coalesce(v_wallet.cash_balance, 0)
  );
end;
$$;

-- Catálogo para a UI (preço sempre do servidor). Uma forma de pagamento sem preço não é
-- oferecida; um tier sem nenhuma forma de pagamento sai como indisponível.
create or replace function public.list_community_creation_products() returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when (select auth.uid()) is null then null else coalesce(jsonb_agg(jsonb_build_object(
    'tier', p.tier,
    'postRetentionMode', p.post_retention_mode,
    'evoCoinsPrice', p.evocoins_price,
    'evoCashPrice', p.evocash_price,
    'available', p.evocoins_price is not null or p.evocash_price is not null
  ) order by case p.tier when 'essential' then 1 when 'plus' then 2 else 3 end), '[]'::jsonb) end
  from public.community_creation_products p
  where p.active
$$;

-- Criação: uma transação só. Qualquer exceção desfaz tudo (nunca debita numa requisição e
-- cria noutra). O lock advisory por usuário serializa criações simultâneas: o limite e a
-- idempotência são conferidos DEPOIS dele, então duplo clique/retry/corrida não cria duas
-- comunidades nem cobra duas vezes.
create or replace function public.create_community(
  p_name text,
  p_description text,
  p_icon_name text,
  p_tier text,
  p_payment_method text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_name text := btrim(coalesce(p_name, ''));
  v_description text := btrim(coalesce(p_description, ''));
  v_hash text;
  v_existing public.community_creation_requests;
  v_product public.community_creation_products;
  v_state jsonb;
  v_blocker text;
  v_asset text;
  v_price integer;
  v_balance numeric;
  v_community_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_payment_method is null or p_payment_method not in ('evocoins', 'evocash') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;
  if char_length(v_name) not between 1 and 60 then raise exception 'INVALID_NAME'; end if;
  if char_length(v_description) > 300 then raise exception 'INVALID_DESCRIPTION'; end if;

  perform pg_advisory_xact_lock(hashtextextended('community_creation:' || v_uid::text, 0));

  v_hash := md5(concat_ws('|', v_name, v_description, coalesce(p_icon_name, ''), coalesce(p_tier, ''), p_payment_method));
  select * into v_existing from public.community_creation_requests
    where user_id = v_uid and request_id = p_idempotency_key;
  if found then
    if v_existing.kind <> 'create' or v_existing.input_hash <> v_hash then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'id', v_existing.community_id, 'replay', true, 'tier', v_existing.tier,
      'paymentAsset', v_existing.payment_asset, 'amountCharged', v_existing.amount_charged
    );
  end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  -- 1) Elegibilidade (recalculada aqui, nunca confiada).
  v_state := private.community_creation_state(v_uid);
  v_blocker := private.community_creation_blocker(v_state);
  if v_blocker is not null then raise exception '%', v_blocker; end if;

  -- 2) Preço, só do servidor.
  select * into v_product from public.community_creation_products where tier = p_tier and active;
  if not found then raise exception 'INVALID_TIER'; end if;
  v_asset := case p_payment_method when 'evocoins' then 'coin' else 'cash' end;
  v_price := case p_payment_method when 'evocoins' then v_product.evocoins_price else v_product.evocash_price end;
  if v_price is null then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  -- 3) Saldo (com lock da carteira) e débito.
  perform public._wallet_ensure_row(v_uid);
  select case v_asset when 'coin' then coin_balance else cash_balance end into v_balance
    from public.wallets where user_id = v_uid for update;
  if v_balance < v_price then
    raise exception '%', case v_asset when 'coin' then 'INSUFFICIENT_COINS' else 'INSUFFICIENT_CASH' end;
  end if;

  -- 4) Comunidade + filiação do dono + débito + ledger + registro de idempotência/auditoria.
  insert into public.communities (name, description, icon_name, is_active, post_access, created_by, owner_id, tier, post_retention_mode)
    values (v_name, v_description, p_icon_name, true, 'everyone', v_uid, v_uid, v_product.tier, v_product.post_retention_mode)
    returning id into v_community_id;
  insert into public.community_members (community_id, user_id) values (v_community_id, v_uid);

  if v_asset = 'coin' then
    perform public._wallet_debit_coins(v_uid, v_price);
  else
    perform public._wallet_debit_cash(v_uid, v_price);
  end if;
  perform public._ledger_record(v_uid, 'community-creation:' || v_community_id::text, v_asset, 'debit', v_price,
    'community_creation', 'community', v_community_id::text);

  insert into public.community_creation_requests
    (user_id, request_id, community_id, input_hash, kind, tier, payment_asset, amount_charged)
    values (v_uid, p_idempotency_key, v_community_id, v_hash, 'create', v_product.tier, v_asset, v_price);

  return jsonb_build_object(
    'id', v_community_id, 'replay', false, 'tier', v_product.tier,
    'paymentAsset', v_asset, 'amountCharged', v_price
  );
end;
$$;

-- Upgrade (essential -> plus -> archive), sem criar outra comunidade. Cobra a diferença para
-- o que o dono já pagou NA MESMA moeda (lido do ledger, não do cliente). Só posts NOVOS
-- usam a nova retenção: os antigos guardam o próprio expires_at/retention_mode.
-- Não existe downgrade.
create or replace function public.upgrade_community_tier(
  p_community_id uuid,
  p_tier text,
  p_payment_method text,
  p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_existing public.community_creation_requests;
  v_community public.communities;
  v_product public.community_creation_products;
  v_state jsonb;
  v_asset text;
  v_price integer;
  v_credit numeric;
  v_amount integer;
  v_balance numeric;
  v_rank_current integer;
  v_rank_target integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_payment_method is null or p_payment_method not in ('evocoins', 'evocash') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('community_creation:' || v_uid::text, 0));

  v_hash := md5(concat_ws('|', coalesce(p_community_id::text, ''), coalesce(p_tier, ''), p_payment_method));
  select * into v_existing from public.community_creation_requests
    where user_id = v_uid and request_id = p_idempotency_key;
  if found then
    if v_existing.kind <> 'upgrade' or v_existing.input_hash <> v_hash then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object(
      'id', v_existing.community_id, 'replay', true, 'tier', v_existing.tier,
      'paymentAsset', v_existing.payment_asset, 'amountCharged', v_existing.amount_charged
    );
  end if;

  v_state := private.community_creation_state(v_uid);
  if not (v_state->>'standingOk')::boolean then raise exception 'ACCOUNT_NOT_ELIGIBLE'; end if;

  select * into v_community from public.communities where id = p_community_id for update;
  if not found or v_community.owner_id is distinct from v_uid then raise exception 'NOT_OWNER'; end if;
  if not v_community.is_active or v_community.deletion_status is not null then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  select * into v_product from public.community_creation_products where tier = p_tier and active;
  if not found then raise exception 'INVALID_TIER'; end if;
  -- legacy e essential têm a mesma retenção (24h): não é upgrade.
  v_rank_current := case v_community.tier when 'plus' then 2 when 'archive' then 3 else 1 end;
  v_rank_target := case v_product.tier when 'plus' then 2 when 'archive' then 3 else 1 end;
  if v_rank_target <= v_rank_current then raise exception 'NOT_AN_UPGRADE'; end if;

  v_asset := case p_payment_method when 'evocoins' then 'coin' else 'cash' end;
  v_price := case p_payment_method when 'evocoins' then v_product.evocoins_price else v_product.evocash_price end;
  if v_price is null then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  select coalesce(sum(t.amount), 0) into v_credit from public.economy_transactions t
    where t.user_id = v_uid and t.direction = 'debit' and t.asset = v_asset
      and t.reference_type = 'community' and t.reference_id = v_community.id::text;
  v_amount := (v_price - v_credit)::integer;
  if v_amount <= 0 then raise exception 'UPGRADE_NOT_CHARGEABLE'; end if;

  perform public._wallet_ensure_row(v_uid);
  select case v_asset when 'coin' then coin_balance else cash_balance end into v_balance
    from public.wallets where user_id = v_uid for update;
  if v_balance < v_amount then
    raise exception '%', case v_asset when 'coin' then 'INSUFFICIENT_COINS' else 'INSUFFICIENT_CASH' end;
  end if;

  if v_asset = 'coin' then
    perform public._wallet_debit_coins(v_uid, v_amount);
  else
    perform public._wallet_debit_cash(v_uid, v_amount);
  end if;
  perform public._ledger_record(v_uid, 'community-upgrade:' || v_community.id::text || ':' || v_product.tier,
    v_asset, 'debit', v_amount, 'community_upgrade', 'community', v_community.id::text);

  update public.communities set tier = v_product.tier, post_retention_mode = v_product.post_retention_mode
    where id = v_community.id;

  insert into public.community_creation_requests
    (user_id, request_id, community_id, input_hash, kind, tier, payment_asset, amount_charged)
    values (v_uid, p_idempotency_key, v_community.id, v_hash, 'upgrade', v_product.tier, v_asset, v_amount);

  return jsonb_build_object(
    'id', v_community.id, 'replay', false, 'tier', v_product.tier,
    'paymentAsset', v_asset, 'amountCharged', v_amount
  );
end;
$$;

-- Grants mínimos: só usuário autenticado chama as RPCs públicas; anon e public nunca.
revoke all on function public.get_my_community_creation_eligibility() from public, anon;
revoke all on function public.list_community_creation_products() from public, anon;
revoke all on function public.create_community(text, text, text, text, text, text) from public, anon;
revoke all on function public.upgrade_community_tier(uuid, text, text, text) from public, anon;
grant execute on function public.get_my_community_creation_eligibility() to authenticated;
grant execute on function public.list_community_creation_products() to authenticated;
grant execute on function public.create_community(text, text, text, text, text, text) to authenticated;
grant execute on function public.upgrade_community_tier(uuid, text, text, text) to authenticated;
