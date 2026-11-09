-- Tighten upgrade credit to actual community creation/upgrade payments. Preserve the
-- shared quote/charge calculation and support a fully credited upgrade without a
-- fictitious wallet debit or ledger entry. No historical rows are modified.
alter table public.community_creation_requests
  drop constraint if exists community_creation_requests_amount_charged_check;
alter table public.community_creation_requests
  add constraint community_creation_requests_amount_charged_check
  check (amount_charged >= 0 and (kind in ('create_free', 'upgrade') or amount_charged > 0));

create or replace function private.community_tier_upgrade_quote(
  p_uid uuid, p_community_id uuid, p_current_tier text, p_target_tier text, p_payment_method text
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_product public.community_creation_products;
  v_asset text;
  v_price integer;
  v_credit numeric;
  v_amount integer;
  v_rank_current integer;
  v_rank_target integer;
begin
  if p_payment_method is null or p_payment_method not in ('evocoins', 'evocash') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into v_product from public.community_creation_products where tier = p_target_tier and active;
  if not found then raise exception 'INVALID_TIER'; end if;

  -- legacy, essential e starter têm a mesma retenção (24h): nenhum é upgrade em relação ao outro.
  v_rank_current := case p_current_tier when 'plus' then 2 when 'archive' then 3 else 1 end;
  v_rank_target := case v_product.tier when 'plus' then 2 when 'archive' then 3 else 1 end;
  if v_rank_target <= v_rank_current then raise exception 'NOT_AN_UPGRADE'; end if;

  v_asset := case p_payment_method when 'evocoins' then 'coin' else 'cash' end;
  v_price := case p_payment_method when 'evocoins' then v_product.evocoins_price else v_product.evocash_price end;
  if v_price is null then raise exception 'PAYMENT_METHOD_UNAVAILABLE'; end if;

  select coalesce(sum(t.amount), 0) into v_credit from public.economy_transactions t
    where t.user_id = p_uid and t.direction = 'debit' and t.asset = v_asset
      and t.reference_type = 'community' and t.reference_id = p_community_id::text
      and t.reason in ('community_creation', 'create_community', 'community_upgrade');
  v_amount := (v_price - v_credit)::integer;

  return jsonb_build_object(
    'tier', v_product.tier,
    'postRetentionMode', v_product.post_retention_mode,
    'paymentAsset', v_asset,
    'listPrice', v_price,
    'alreadyCredited', v_credit,
    'amountDue', greatest(v_amount, 0),
    'chargeable', v_amount > 0
  );
end;
$$;
revoke all on function private.community_tier_upgrade_quote(uuid, uuid, text, text, text) from public, anon, authenticated;

create or replace function public.quote_community_tier_upgrade(p_community_id uuid, p_tier text, p_payment_method text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_community public.communities;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;

  select * into v_community from public.communities where id = p_community_id;
  if not found or v_community.owner_id is distinct from v_uid then raise exception 'NOT_OWNER'; end if;
  if not v_community.is_active or v_community.deletion_status is not null then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  return private.community_tier_upgrade_quote(v_uid, v_community.id, v_community.tier, p_tier, p_payment_method);
end;
$$;
revoke all on function public.quote_community_tier_upgrade(uuid, text, text) from public, anon;
grant execute on function public.quote_community_tier_upgrade(uuid, text, text) to authenticated;

create or replace function public.upgrade_community_tier(
  p_community_id uuid, p_tier text, p_payment_method text, p_idempotency_key text, p_expected_amount integer
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_hash text;
  v_existing public.community_creation_requests;
  v_community public.communities;
  v_quote jsonb;
  v_asset text;
  v_amount integer;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'INVALID_REQUEST_ID';
  end if;
  if p_payment_method is null or p_payment_method not in ('evocoins', 'evocash') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;
  if p_expected_amount is null or p_expected_amount < 0 then
    raise exception 'INVALID_EXPECTED_AMOUNT';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('community_creation:' || v_uid::text, 0));

  -- Hash sobre uma serialização jsonb estruturada, não concat_ws com delimitador (mesmo motivo
  -- de create_community/create_free_community: evitar colisão quando um campo texto contém o
  -- delimitador). p_expected_amount faz parte da identidade lógica da solicitação: duas
  -- tentativas com valor esperado diferente nunca colidem como replay indevido de uma linha antiga.
  v_hash := md5(jsonb_build_object(
    'communityId', p_community_id, 'tier', p_tier, 'paymentMethod', p_payment_method,
    'expectedAmount', p_expected_amount
  )::text);
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

  if not (private.community_creation_state(v_uid)->>'standingOk')::boolean then
    raise exception 'ACCOUNT_NOT_ELIGIBLE';
  end if;

  select * into v_community from public.communities where id = p_community_id for update;
  if not found or v_community.owner_id is distinct from v_uid then raise exception 'NOT_OWNER'; end if;
  if not v_community.is_active or v_community.deletion_status is not null then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  -- Lógica financeira compartilhada com quote_community_tier_upgrade -- nunca duplicada aqui.
  v_quote := private.community_tier_upgrade_quote(v_uid, v_community.id, v_community.tier, p_tier, p_payment_method);
  v_asset := v_quote->>'paymentAsset';
  v_amount := (v_quote->>'amountDue')::integer;

  -- Proteção contra mudança de preço entre a cotação mostrada ao usuário e a confirmação: se o
  -- valor recalculado agora não bate com o que foi aprovado, aborta ANTES de debitar -- nenhuma
  -- cobrança ocorre, a chave de idempotência não é consumida (a exceção acontece antes do
  -- INSERT em community_creation_requests), o usuário precisa cotar de novo e confirmar de novo.
  if v_amount <> p_expected_amount then raise exception 'PRICE_CHANGED'; end if;

  -- An upgrade fully covered by legitimate prior payments changes only tier/retention.
  -- Wallet and ledger helpers require positive amounts: never invent a zero debit.
  if v_amount > 0 then
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
    perform public._ledger_record(v_uid, 'community-upgrade:' || v_community.id::text || ':' || (v_quote->>'tier'),
      v_asset, 'debit', v_amount, 'community_upgrade', 'community', v_community.id::text);
  end if;

  update public.communities set tier = (v_quote->>'tier'), post_retention_mode = (v_quote->>'postRetentionMode')
    where id = v_community.id;

  insert into public.community_creation_requests
    (user_id, request_id, community_id, input_hash, kind, tier, payment_asset, amount_charged)
    values (v_uid, p_idempotency_key, v_community.id, v_hash, 'upgrade', v_quote->>'tier', v_asset, v_amount);

  return jsonb_build_object(
    'id', v_community.id, 'replay', false, 'tier', v_quote->>'tier',
    'paymentAsset', v_asset, 'amountCharged', v_amount
  );
end;
$$;
revoke all on function public.upgrade_community_tier(uuid, text, text, text, integer) from public, anon;
grant execute on function public.upgrade_community_tier(uuid, text, text, text, integer) to authenticated;
