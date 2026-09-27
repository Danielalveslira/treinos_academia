-- Equivalente a createCommunityWithCash (privilege-core.js/privilege-service.js).
--
-- Idempotência: em vez de derivar um ID determinístico de comunidade a partir de
-- sha256(uid:requestId) (o Firestore usava isso porque o ID do documento É a chave de
-- deduplicação), uma tabela de rastreio própria faz o mesmo papel de forma mais idiomática
-- em Postgres — (user_id, request_id) só grava depois que TUDO deu certo, então uma
-- tentativa que falhou no meio (elegibilidade recusada) não deixa rastro nenhum e uma
-- nova tentativa com o mesmo request_id tenta de novo do zero, exatamente como o
-- original (transação única, tudo ou nada).
create table public.community_creation_requests (
  user_id uuid not null references public.users(id),
  request_id text not null,
  community_id uuid not null references public.communities(id),
  input_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, request_id)
);
alter table public.community_creation_requests enable row level security;
create policy community_creation_requests_select on public.community_creation_requests for select
  using (user_id = auth.uid());

-- postAccess não é parâmetro: comunidades criadas por este privilégio nascem sempre
-- 'everyone' (o criador não ganha papel de admin global) — mesmo comportamento do
-- original, que também nunca aceitava isso do cliente aqui.
create or replace function public.create_community_with_cash(
  p_name text, p_description text, p_icon_name text, p_request_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_input_hash text;
  v_existing_request public.community_creation_requests;
  v_community public.communities;
  v_user public.users;
  v_wallet public.wallets;
  v_config jsonb;
  v_privilege jsonb;
  v_min_coins numeric;
  v_min_age_days numeric;
  v_require_email_verified boolean;
  v_cash_cost numeric;
  v_account_age_days numeric;
  v_email_verified boolean;
  v_new_community_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_request_id is null or length(p_request_id) = 0 then raise exception 'INVALID_REQUEST_ID'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  v_input_hash := md5(coalesce(p_name, '') || '|' || coalesce(p_description, '') || '|' || coalesce(p_icon_name, ''));

  select * into v_existing_request from public.community_creation_requests
    where user_id = v_uid and request_id = p_request_id;
  if v_existing_request is not null then
    if v_existing_request.input_hash <> v_input_hash then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    select * into v_community from public.communities where id = v_existing_request.community_id;
    return jsonb_build_object('id', v_community.id, 'replay', true);
  end if;

  -- Elegibilidade, na mesma ordem do original. Config sempre fresca, nunca cache —
  -- ausente/inválida bloqueia (é dinheiro real), nunca cai num default embutido.
  select * into v_user from public.users where id = v_uid;
  select config into v_config from public.economy_config where id;
  v_privilege := v_config->'privileges'->'createCommunity';
  v_min_coins := (v_privilege->>'minimumLifetimeCoins')::numeric;
  v_min_age_days := (v_privilege->>'minimumAccountAgeDays')::numeric;
  v_require_email_verified := (v_privilege->>'requireEmailVerified')::boolean;
  v_cash_cost := (v_privilege->>'cashCost')::numeric;
  if v_min_coins is null or v_min_coins < 0 or v_min_age_days is null or v_min_age_days < 0
     or v_require_email_verified is null or v_cash_cost is null or v_cash_cost <= 0 then
    raise exception 'PRIVILEGE_CONFIG_UNAVAILABLE';
  end if;

  if v_user.account_status = 'disabled' then raise exception 'ACCOUNT_DISABLED'; end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  v_account_age_days := extract(epoch from (now() - v_user.created_at)) / 86400;
  if v_account_age_days < v_min_age_days then raise exception 'ACCOUNT_TOO_NEW'; end if;

  if v_require_email_verified then
    select (email_confirmed_at is not null) into v_email_verified from auth.users where id = v_uid;
    if not coalesce(v_email_verified, false) then raise exception 'EMAIL_NOT_VERIFIED'; end if;
  end if;

  if coalesce((select lifetime_coins_earned from public.wallets where user_id = v_uid), 0) < v_min_coins then
    raise exception 'INSUFFICIENT_REPUTATION';
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if coalesce(v_wallet.cash_balance, 0) < v_cash_cost then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  -- Escrita atômica: comunidade + filiação do dono + débito + ledger, tudo ou nada
  -- (qualquer exceção acima desfaz a transação inteira sem gravar nada).
  insert into public.communities (name, description, icon_name, is_active, post_access, created_by, owner_id)
    values (trim(p_name), coalesce(trim(p_description), ''), p_icon_name, true, 'everyone', v_uid, v_uid)
    returning id into v_new_community_id;

  insert into public.community_members (community_id, user_id) values (v_new_community_id, v_uid);

  perform public._wallet_debit_cash(v_uid, v_cash_cost);
  perform public._ledger_record(v_uid, 'create-community:' || v_new_community_id::text, 'cash', 'debit', v_cash_cost, 'create_community', 'community', v_new_community_id::text);

  insert into public.community_creation_requests (user_id, request_id, community_id, input_hash)
    values (v_uid, p_request_id, v_new_community_id, v_input_hash);

  return jsonb_build_object('id', v_new_community_id, 'replay', false);
end;
$$;
