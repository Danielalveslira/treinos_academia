-- PROMPT final de conclusão do logout global, Etapa 3: inventário recalculado a partir do
-- projeto hospedado real (não do histórico de migrations) encontrou 4 RPCs de
-- comunidade/promoção que leem ou movimentam saldo (EvoCoins/EvoCash) sem NENHUM guard --
-- nem explícito, nem via has_app_access()/is_superadmin() -- e uma quinta de leitura pública
-- (preços) incluída por consistência. Confirmadas financeiras de verdade:
--
--   - create_community: debita a carteira (_wallet_debit_coins/_wallet_debit_cash) e grava no
--     ledger ao criar uma comunidade paga. Mutação financeira direta.
--   - upgrade_community_tier: mesma coisa, ao fazer upgrade de tier.
--   - get_my_community_creation_eligibility: devolve evoCoinsBalance/evoCashBalance (saldo) no
--     corpo da resposta -- exposição de dado financeiro sensível, não só elegibilidade.
--   - record_promotion_event: incrementa click_count de uma promoção paga (métrica que afeta o
--     ROI reportado a quem pagou pela promoção) -- efeito financeiro indireto.
--   - list_community_creation_products: só preços públicos (sem saldo nem PII), incluída por
--     consistência com as demais RPCs deste mesmo fluxo de compra.
--
-- request_infinitepay_cash_purchase_cancellation NÃO precisou de mudança: é um wrapper de 1
-- linha para cancel_my_cash_purchase, que já está na lista nomeada da injeção automática de
-- 20261114000001 -- protegida transitivamente, sem duplicar a checagem aqui.
--
-- Nenhuma destas é chamável por service_role/cron/webhook (todas exigem auth.uid() do próprio
-- usuário; nenhuma tem um caminho de chamada por processo interno) -- não há operação legítima
-- de serviço a preservar aqui.
--
-- Mais duas (Etapa 4 desta rodada): list_community_restrictions e list_deletion_jobs são
-- language sql, RETURNS SETOF -- a injeção automática de 20261114000001 pula qualquer função
-- sem begin/end (ver 20261114000001:46), então as duas seguiram sem a checagem mesmo "dependendo
-- nominalmente" de is_superadmin()/is_community_owner(). Corrigidas aqui com o mesmo padrão já
-- usado nas políticas RLS financeiras (AND na própria condição, não uma exceção): false na
-- condição = zero linhas, consistente com o que já acontece hoje para quem não é superadmin/dono.
set local lock_timeout = '5s';

-- =====================================================================================
-- 1) create_community
-- =====================================================================================
create or replace function public.create_community(p_name text, p_description text, p_icon_name text, p_tier text, p_payment_method text, p_idempotency_key text)
returns jsonb
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
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
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

-- =====================================================================================
-- 2) upgrade_community_tier
-- =====================================================================================
create or replace function public.upgrade_community_tier(p_community_id uuid, p_tier text, p_payment_method text, p_idempotency_key text)
returns jsonb
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
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
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

-- =====================================================================================
-- 3) get_my_community_creation_eligibility -- devolve saldo (evoCoinsBalance/evoCashBalance)
-- =====================================================================================
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
    'evoCashBalance', coalesce(v_wallet.cash_balance, 0)
  );
end;
$$;

-- =====================================================================================
-- 4) record_promotion_event -- click_count afeta métrica/ROI de quem pagou a promoção
-- =====================================================================================
create or replace function public.record_promotion_event(p_target_type text, p_target_id uuid, p_promotion_id uuid, p_type text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_promo public.promotions;
  v_now timestamptz := now();
  v_limit public.promotion_event_limits;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_type <> 'click' then raise exception 'INVALID_EVENT_TYPE'; end if;

  select * into v_promo from public.promotions where id = p_promotion_id;
  if v_promo is null or v_promo.target_type <> p_target_type or v_promo.target_id <> p_target_id then
    raise exception 'PROMOTION_MISMATCH';
  end if;
  if v_promo.status <> 'active' or v_promo.expires_at <= v_now then
    return jsonb_build_object('recorded', false, 'reason', 'not_active');
  end if;

  select * into v_limit from public.promotion_event_limits where user_id = v_uid and promotion_id = p_promotion_id for update;
  if v_limit is not null and v_limit.last_click_at > v_now - interval '10 seconds' then
    return jsonb_build_object('recorded', false);
  end if;

  update public.promotions set click_count = click_count + 1 where id = p_promotion_id;
  insert into public.promotion_event_limits (user_id, promotion_id, last_click_at, expire_at)
    values (v_uid, p_promotion_id, v_now, v_now + interval '24 hours')
  on conflict (user_id, promotion_id) do update set last_click_at = v_now, expire_at = v_now + interval '24 hours';

  return jsonb_build_object('recorded', true);
end;
$$;

-- =====================================================================================
-- 5) list_community_creation_products -- só preços públicos; language sql (CASE, sem begin/end)
-- =====================================================================================
create or replace function public.list_community_creation_products()
returns jsonb
stable language sql security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then null
    when not coalesce(private.current_session_active(), false) then null
    else coalesce(jsonb_agg(jsonb_build_object(
      'tier', p.tier,
      'postRetentionMode', p.post_retention_mode,
      'evoCoinsPrice', p.evocoins_price,
      'evoCashPrice', p.evocash_price,
      'available', p.evocoins_price is not null or p.evocash_price is not null
    ) order by case p.tier when 'essential' then 1 when 'plus' then 2 else 3 end), '[]'::jsonb)
  end
  from public.community_creation_products p
  where p.active
$$;

-- =====================================================================================
-- 6) list_community_restrictions -- language sql, pulada pela injeção automática
-- =====================================================================================
create or replace function public.list_community_restrictions(p_community_id uuid)
returns setof public.community_restrictions
stable language sql security definer set search_path = public, pg_temp as $$
    select * from public.community_restrictions
    where community_id = p_community_id
      and (public.is_superadmin() or public.is_community_owner(p_community_id))
      and private.current_session_active()
$$;

-- =====================================================================================
-- 7) list_deletion_jobs -- language sql, pulada pela injeção automática
-- =====================================================================================
create or replace function public.list_deletion_jobs()
returns setof public.deletion_jobs
stable language sql security definer set search_path = public, pg_temp as $$
    select * from public.deletion_jobs
    where public.is_superadmin() and state = 'pending' and private.current_session_active()
    order by updated_at asc
    limit 50
$$;
