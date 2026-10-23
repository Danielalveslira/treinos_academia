-- EvoCoins and EvoCash are indivisible units, bounded by existing int4 storage.
-- NOT VALID enforces new writes without rewriting/rounding historical rows.
create or replace function private.require_money_units(p_amount numeric) returns void
language plpgsql immutable set search_path = '' as $$
begin
 if p_amount is null or p_amount::text in ('NaN','Infinity','-Infinity')
    or p_amount <= 0 or p_amount <> trunc(p_amount) or p_amount > 2147483647 then
   raise exception 'INVALID_MONEY_UNITS';
 end if;
end;
$$;
revoke all on function private.require_money_units(numeric) from public, anon, authenticated;
create or replace function public._wallet_credit_coins(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
begin
  perform private.require_money_units(p_amount);
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  perform 1 from public.wallets where user_id = p_user_id for update;
  update public.wallets
    set coin_balance = coin_balance + p_amount,
        lifetime_coins_earned = lifetime_coins_earned + p_amount,
        updated_at = now()
    where user_id = p_user_id;
end;
$$;
create or replace function public._wallet_debit_coins(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
declare
  v_balance numeric;
begin
  perform private.require_money_units(p_amount);
  perform public._wallet_ensure_row(p_user_id);
  select coin_balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance - p_amount < 0 then
    raise exception 'Saldo de EvoCoins insuficiente.';
  end if;
  update public.wallets set coin_balance = coin_balance - p_amount, updated_at = now() where user_id = p_user_id;
end;
$$;
create or replace function public._wallet_credit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
declare
  v_next numeric;
begin
  perform private.require_money_units(p_amount);
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance + p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 or v_next > 9007199254740991 then
    raise exception 'Saldo de EvoCash inválido após o crédito.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;
create or replace function public._wallet_debit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
declare
  v_next numeric;
begin
  perform private.require_money_units(p_amount);
  if exists (select 1 from public.users where id = p_user_id and account_status = 'deleting') then
    raise exception 'ACCOUNT_DELETING';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance - p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 then
    raise exception 'Saldo de EvoCash insuficiente.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;
create or replace function public._ledger_record(
  p_user_id uuid, p_natural_key text, p_asset text, p_direction text,
  p_amount numeric, p_reason text, p_reference_type text, p_reference_id text
) returns void
  language plpgsql set search_path = '' as $$
declare v_constraint text;
begin
  perform private.require_money_units(p_amount);
  insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
  values (p_user_id, p_natural_key, p_asset, p_direction, p_amount, p_reason, p_reference_type, p_reference_id);
exception when unique_violation then
  get stacked diagnostics v_constraint=constraint_name;
  if v_constraint='economy_transactions_user_id_natural_key_key' then
    raise exception 'Esta operação já foi registrada.';
  end if;
  raise;
end;
$$;

alter table public.economy_transactions add constraint economy_transactions_whole_units
 check (amount::text not in ('NaN','Infinity','-Infinity') and amount = trunc(amount) and amount between 1 and 2147483647) not valid;
alter table public.cash_purchases add constraint cash_purchases_whole_units
 check (cash_amount::text not in ('NaN','Infinity','-Infinity') and cash_amount = trunc(cash_amount) and cash_amount between 1 and 1000000) not valid;
alter table public.promotions add constraint promotions_whole_units
 check (cash_amount::text not in ('NaN','Infinity','-Infinity') and cash_amount = trunc(cash_amount) and cash_amount between 1 and 1000000) not valid;
alter table public.wallets add constraint wallets_cash_nonnegative check (cash_balance >= 0) not valid;
alter table public.wallets add constraint wallets_lifetime_nonnegative check (lifetime_coins_earned >= 0) not valid;
-- Validation is deliberately a separate rollout step after read-only diagnostics.

-- Protect financial content, allowing only existing case association and account
-- pseudonymisation operations. No automatic purge is currently defined by the app.
create or replace function private.protect_economy_ledger() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'LEDGER_IMMUTABLE'; end if;
 if (to_jsonb(new) - 'user_id' - 'financial_case_id') is distinct from
    (to_jsonb(old) - 'user_id' - 'financial_case_id') then raise exception 'LEDGER_IMMUTABLE'; end if;
 if new.user_id is distinct from old.user_id and
    not (new.user_id is null and old.user_id is not null and (new.financial_case_id is not null or (
      exists(select 1 from public.users u where u.id=old.user_id and u.account_status='deleting')
      and exists(select 1 from public.deletion_jobs j where j.kind='account' and j.target_id=old.user_id and j.state='pending')))) then
   raise exception 'LEDGER_IDENTITY_IMMUTABLE';
 end if;
 return new;
end;
$$;
revoke all on function private.protect_economy_ledger() from public, anon, authenticated;
create trigger economy_ledger_immutable before update or delete on public.economy_transactions
 for each row execute function private.protect_economy_ledger();
create or replace function public.create_promotion(
  p_target_type text, p_target_id uuid, p_package_id text, p_request_id text
) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.promotions;
  v_status public.statuses;
  v_community public.communities;
  v_is_owner boolean;
  v_community_id uuid;
  v_promoted boolean;
  v_promoted_until timestamptz;
  v_config jsonb;
  v_pkg jsonb;
  v_cash_amount numeric;
  v_duration_days integer;
  v_wallet public.wallets;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target_type is null or p_target_type not in ('post', 'community') then raise exception 'INVALID_TARGET_TYPE'; end if;
  if p_target_id is null or p_package_id is null or p_request_id is null or length(p_request_id) not between 1 and 100 then
    raise exception 'INVALID_REQUEST';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promotion:' || v_uid::text, 0));
  select * into v_existing from public.promotions where owner_id = v_uid and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.target_type <> p_target_type or v_existing.target_id <> p_target_id or v_existing.package_id <> p_package_id then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('id', v_existing.id, 'replay', true, 'expiresAt', v_existing.expires_at);
  end if;

  if p_target_type = 'post' then
    select * into v_status from public.statuses where id = p_target_id for update;
    if v_status is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_status.author_id = v_uid);
    v_community_id := v_status.community_id;
    v_promoted := v_status.promoted;
    v_promoted_until := v_status.promoted_until;
  else
    select * into v_community from public.communities where id = p_target_id for update;
    if v_community is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_community.owner_id = v_uid);
    v_community_id := v_community.id;
    v_promoted := v_community.promoted;
    v_promoted_until := v_community.promoted_until;
  end if;

  if not coalesce(v_is_owner, false) then raise exception 'NOT_OWNER'; end if;

  if (select account_status from public.users where id = v_uid) = 'disabled' then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;
  if not coalesce(public.has_app_access(), false) then raise exception 'PERMISSION_DENIED'; end if;

  if not exists (select 1 from public.community_members where community_id = v_community_id and user_id = v_uid) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;

  if p_target_type = 'post' then
    select * into v_community from public.communities where id = v_community_id;
  end if;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind = 'community' and target_id = v_community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  if (p_target_type = 'post' and private.status_promotion_until(v_status) > v_now)
     or (p_target_type = 'community' and v_promoted and v_promoted_until is not null and v_promoted_until > v_now) then
    raise exception 'ALREADY_PROMOTED';
  end if;

  select config into v_config from public.economy_config where id;
  v_pkg := v_config->'promotionPackages'->p_package_id;
  v_cash_amount := (v_pkg->>'cashAmount')::numeric;
  v_duration_days := (v_pkg->>'durationDays')::integer;
  if v_pkg is null or (v_pkg->>'targetType') <> p_target_type
     or v_cash_amount is null or v_cash_amount <= 0 or v_cash_amount > 1000000
     or v_duration_days is null or v_duration_days <= 0 or v_duration_days > 90
     or coalesce((v_pkg->>'active')::boolean, false) <> true
  then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if coalesce(v_wallet.cash_balance, 0) < v_cash_amount then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  v_expires_at := v_now + (v_duration_days || ' days')::interval;
  v_new_id := gen_random_uuid();

  perform public._wallet_debit_cash(v_uid, v_cash_amount);
  perform public._ledger_record(v_uid, 'promote:' || v_new_id::text, 'cash', 'debit', v_cash_amount, 'promotion_purchase', 'promotion', v_new_id::text);

  insert into public.promotions (
    id, owner_id, request_id, target_type, target_id, community_id, package_id,
    cash_amount, duration_days, status, started_at, expires_at
  ) values (
    v_new_id, v_uid, p_request_id, p_target_type, p_target_id, v_community_id, p_package_id,
    v_cash_amount, v_duration_days, 'active', v_now, v_expires_at
  );

  if p_target_type = 'post' then
    update public.statuses set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  else
    update public.communities set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  end if;

  return jsonb_build_object('id', v_new_id, 'replay', false, 'expiresAt', v_expires_at);
end;
$$;
