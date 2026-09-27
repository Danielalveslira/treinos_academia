-- Campos de promoção adiantados (Fase 4 ainda não implementa a compra/promoção em si,
-- mas o voto já precisa checar "promovido estende a janela de expiração" — nascem
-- sempre false/null até lá, sem efeito nenhum por enquanto).
alter table public.statuses
  add column if not exists promoted boolean not null default false,
  add column if not exists promoted_until timestamptz,
  add column if not exists active_promotion_id uuid;

-- Equivalente a voteOnPostV2 (vote-core.js/vote-service.js). Ordem de validação
-- idêntica ao original; cada erro é um código curto, traduzido no cliente (mesmo
-- padrão de submit_support_request/decide_support_request).
create or replace function public.cast_vote(p_status_id uuid, p_value smallint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status public.statuses;
  v_community public.communities;
  v_existing public.status_economy_votes;
  v_action text;
  v_config jsonb;
  v_cost_coins numeric;
  v_max_votes_per_day integer;
  v_daily public.economy_daily;
  v_day date;
  v_new_reward_state text;
  v_natural_key text;
  v_delta_pos integer := 0;
  v_delta_neg integer := 0;
  v_expires_at timestamptz;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_value is not null and p_value not in (1, -1) then raise exception 'INVALID_VALUE'; end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_status from public.statuses where id = p_status_id;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;
  if v_status.type = 'poll' then raise exception 'INELIGIBLE_TYPE_POLL'; end if;
  if v_status.type = 'workout' then raise exception 'INELIGIBLE_TYPE_WORKOUT'; end if;
  if v_status.author_id = v_uid then raise exception 'SELF_VOTE'; end if;

  v_expires_at := case when v_status.promoted and v_status.promoted_until > v_status.expires_at
    then v_status.promoted_until else v_status.expires_at end;
  if v_expires_at <= now() then raise exception 'EXPIRED'; end if;

  select * into v_community from public.communities where id = v_status.community_id;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind='community' and target_id=v_status.community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;
  if not exists (select 1 from public.community_members where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  select * into v_existing from public.status_economy_votes
    where status_id = p_status_id and user_id = v_uid for update;

  if v_existing is null then
    if p_value is null then return jsonb_build_object('action', 'noop'); end if;
    v_action := 'create';
  elsif v_existing.value is not distinct from p_value then
    return jsonb_build_object('action', 'noop');
  elsif p_value is null then
    v_action := 'remove';
  else
    v_action := 'switch';
  end if;

  v_day := (now() at time zone 'America/Sao_Paulo')::date;

  if v_action = 'create' then
    select config into v_config from public.economy_config where id;
    v_cost_coins := (v_config->'voting'->>'costCoins')::numeric;
    v_max_votes_per_day := (v_config->'voting'->>'maxVotesPerUserDay')::integer;
    if v_cost_coins is null or v_cost_coins <= 0 or v_cost_coins > 1000
       or v_max_votes_per_day is null or v_max_votes_per_day <= 0 or v_max_votes_per_day > 1000 then
      v_cost_coins := 3;
      v_max_votes_per_day := 10;
    end if;

    insert into public.economy_daily (user_id, day) values (v_uid, v_day) on conflict (user_id, day) do nothing;
    select * into v_daily from public.economy_daily where user_id = v_uid and day = v_day for update;
    if v_daily.votes_charged >= v_max_votes_per_day then
      raise exception 'RATE_LIMITED';
    end if;

    select coin_balance into v_balance from public.wallets where user_id = v_uid;
    if coalesce(v_balance, 0) < v_cost_coins then
      raise exception 'INSUFFICIENT_COINS';
    end if;

    perform public._wallet_debit_coins(v_uid, v_cost_coins);
    v_natural_key := 'vote:' || p_status_id::text || ':charge';
    perform public._ledger_record(v_uid, v_natural_key, 'coin', 'debit', v_cost_coins, 'vote_charge', 'status_economy_vote', p_status_id::text);
    update public.economy_daily set votes_charged = votes_charged + 1, vote_coins_spent = vote_coins_spent + v_cost_coins, updated_at = now()
      where user_id = v_uid and day = v_day;
  end if;

  if coalesce(v_existing.reward_state, '') in ('processed', 'capped') then
    v_new_reward_state := v_existing.reward_state;
  else
    v_new_reward_state := case when p_value = 1 then 'pending' else 'ineligible' end;
  end if;

  insert into public.status_economy_votes (
    status_id, user_id, author_id, value, charged, first_charged_at, updated_at,
    reward_state, reward_pending_at, reward_day_key
  ) values (
    p_status_id, v_uid, v_status.author_id, p_value, true,
    now(), now(), v_new_reward_state,
    case when v_new_reward_state = 'pending' then now() else null end,
    case when v_new_reward_state = 'pending' then v_day else null end
  )
  on conflict (status_id, user_id) do update set
    value = excluded.value, charged = true, updated_at = now(), reward_state = excluded.reward_state,
    reward_pending_at = excluded.reward_pending_at, reward_day_key = excluded.reward_day_key;

  if v_existing.value = 1 then v_delta_pos := v_delta_pos - 1; end if;
  if v_existing.value = -1 then v_delta_neg := v_delta_neg - 1; end if;
  if p_value = 1 then v_delta_pos := v_delta_pos + 1; end if;
  if p_value = -1 then v_delta_neg := v_delta_neg + 1; end if;
  update public.statuses set
    positive_vote_count = positive_vote_count + v_delta_pos,
    negative_vote_count = negative_vote_count + v_delta_neg
    where id = p_status_id;

  return jsonb_build_object('action', v_action, 'value', p_value);
end;
$$;

-- Equivalente a listPostEconomyVoters: nunca expõe charged/rewardState/timestamps
-- internos, só {userId, username}. Mesma checagem de acesso do voto (membro,
-- sem restrição, comunidade ativa), com bypass para superadmin.
create or replace function public.list_post_economy_voters(
  p_status_id uuid, p_direction smallint, p_cursor timestamptz default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.statuses;
  v_allowed boolean;
  v_page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
  v_next_cursor timestamptz;
begin
  if p_direction not in (1, -1) then raise exception 'INVALID_VALUE'; end if;
  select * into v_status from public.statuses where id = p_status_id;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;

  v_allowed := public.is_superadmin() or (
    public.is_community_member(v_status.community_id)
    and not exists (select 1 from public.community_restrictions where community_id = v_status.community_id and user_id = auth.uid())
  );
  if not v_allowed then raise exception 'PERMISSION_DENIED'; end if;

  select jsonb_agg(jsonb_build_object('userId', sub.user_id, 'username', sub.username) order by sub.first_charged_at, sub.user_id),
         max(sub.first_charged_at) filter (where true)
    into v_rows, v_next_cursor
  from (
    select v.user_id, v.first_charged_at, pp.username
    from public.status_economy_votes v
    left join public.public_profiles pp on pp.user_id = v.user_id
    where v.status_id = p_status_id and v.value = p_direction
      and (p_cursor is null or v.first_charged_at > p_cursor)
    order by v.first_charged_at, v.user_id
    limit v_page_size
  ) sub;

  return jsonb_build_object(
    'voters', coalesce(v_rows, '[]'::jsonb),
    'nextCursor', case when jsonb_array_length(coalesce(v_rows, '[]'::jsonb)) = v_page_size then v_next_cursor else null end
  );
end;
$$;
