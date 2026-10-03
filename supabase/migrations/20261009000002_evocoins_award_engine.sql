-- EvoCoins por participação — 2/7: motor central de crédito.
--
-- private.award_evocoins é o ÚNICO caminho de crédito promocional de EvoCoins. Sem EXECUTE para o
-- cliente: quem chama já validou a ação no servidor (RPC/trigger/cron) e nunca informa valor --
-- o valor vem de economy_reward_rules. O beneficiário é explícito (apoio recebido credita o autor,
-- não auth.uid()).

-- Mesma regra de public.has_app_access(), mas para um usuário explícito (cron/triggers não têm
-- auth.uid() do beneficiário). Qualquer mudança em has_app_access precisa ser espelhada aqui; o
-- teste de pgTAP compara as duas.
create or replace function private.user_app_access(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.account_status <> 'deleting'
      and (u.role = 'superadmin' or u.account_status <> 'disabled')
      and (u.role = 'superadmin' or public.email_verified_ok(u.id))
      and (
        not exists (select 1 from public.legal_policy where id and published)
        or (u.legal_acceptance_version = (select version from public.legal_policy where id)
            and u.legal_acceptance_digest = (select digest from public.legal_policy where id))
      )
      and not exists (
        select 1 from public.account_restrictions r
        where r.user_id = u.id
          and not (r.action = 'temporary_suspension' and r.until <= now())
      )
    from public.users u where u.id = p_user_id
  ), false)
$$;

create or replace function private.sp_today() returns date
language sql stable set search_path = '' as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

-- Quantas EvoCoins ainda cabem hoje para a ação (0 = nada). Leitura por PK, sem lock: serve de
-- retorno rápido antes de qualquer trabalho caro (enfileirar, avaliar conteúdo, travar linhas).
create or replace function private.evocoins_headroom(p_user_id uuid, p_action text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select greatest(least(
             s.daily_cap - coalesce(d.earned_total, 0),
             r.daily_max - coalesce((d.earned_by_action ->> r.action)::integer, 0)
           ), 0)
    from public.economy_reward_rules r
    cross join public.economy_reward_settings s
    left join public.economy_daily d on d.user_id = p_user_id and d.day = private.sp_today()
    where r.action = p_action and r.enabled
  ), 0)
$$;

-- {dailyEarned, dailyLimit, dailyRemaining} do dia (a única visão que o cliente recebe).
create or replace function private.evocoins_day_snapshot(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'dailyEarned', coalesce(d.earned_total, 0),
    'dailyLimit', s.daily_cap,
    'dailyRemaining', greatest(s.daily_cap - coalesce(d.earned_total, 0), 0)
  )
  from public.economy_reward_settings s
  left join public.economy_daily d on d.user_id = p_user_id and d.day = private.sp_today()
  where s.id
$$;

create or replace function private._award_result(p_awarded integer, p_earned integer, p_cap integer, p_reason text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'awardedCoins', p_awarded,
    'dailyEarned', p_earned,
    'dailyLimit', p_cap,
    'dailyRemaining', greatest(p_cap - p_earned, 0)
  ) || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end
$$;

-- Comentário/publicação com conteúdo mínimo. Limiares ficam só aqui (nunca no cliente): texto de
-- pelo menos N caracteres úteis, 3 palavras distintas e variedade de caracteres (barra "aaaa aaaa").
create or replace function private.is_meaningful_text(p_text text, p_min_chars integer default 20)
returns boolean language sql immutable set search_path = '' as $$
  select p_text is not null
    and char_length(btrim(p_text)) >= p_min_chars
    and (select count(distinct w) from regexp_split_to_table(lower(btrim(p_text)), '\s+') w
          where char_length(w) >= 2) >= 3
    and (select count(distinct c) from regexp_split_to_table(regexp_replace(lower(p_text), '\s', '', 'g'), '') c) >= 6
$$;

-- Publicação elegível a recompensa, por tipo.
create or replace function private.post_is_rewardable(p_status public.statuses) returns boolean
language sql immutable set search_path = '' as $$
  select case p_status.type
    when 'text' then private.is_meaningful_text(p_status.text, 20)
    when 'poll' then private.is_meaningful_text(p_status.poll_question, 15)
    when 'achievement' then coalesce(p_status.achievement_entries, 0) > 0
                            or private.is_meaningful_text(p_status.achievement_text, 15)
    when 'photo' then true
    when 'workout' then true
    else false
  end
$$;

-- Crédito de saldo de EvoCoins: mesma garantia que o EvoCash já tinha (conta inexistente falha
-- explicitamente em vez de depender do erro de FK).
create or replace function public._wallet_credit_coins(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
begin
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

-- Fluxo (tudo na transação do chamador):
--   1. trava economy_daily(usuário, dia) -- serializa créditos concorrentes do mesmo usuário;
--   2. valida teto global e teto da ação (retorno rápido, sem ledger nem carteira, se esgotado);
--   3. grant = min(valor da regra, teto global restante, teto da ação restante);
--   4. UMA linha no ledger com natural_key única (conflito = já processado -> 0);
--   5. credita a carteira e atualiza o agregado do dia.
create or replace function private.award_evocoins(
  p_user_id uuid, p_action text, p_natural_key text, p_ref_type text, p_ref_id text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := private.sp_today();
  v_rule public.economy_reward_rules;
  v_cap integer;
  v_total integer;
  v_action_earned integer;
  v_grant integer;
  v_status text;
  v_ledger_id uuid;
begin
  if p_user_id is null or p_action is null or coalesce(p_natural_key, '') = '' then
    raise exception 'INVALID_ARGUMENT';
  end if;
  select * into v_rule from public.economy_reward_rules where action = p_action;
  if not found then raise exception 'UNKNOWN_ACTION'; end if;
  select daily_cap into v_cap from public.economy_reward_settings where id;

  select account_status into v_status from public.users where id = p_user_id;
  if v_status is null or v_status = 'deleting' then
    return private._award_result(0, 0, v_cap, 'account_unavailable');
  end if;

  select earned_total, coalesce((earned_by_action ->> p_action)::integer, 0)
    into v_total, v_action_earned
    from public.economy_daily where user_id = p_user_id and day = v_day for update;
  if not found then
    insert into public.economy_daily (user_id, day) values (p_user_id, v_day) on conflict (user_id, day) do nothing;
    select earned_total, coalesce((earned_by_action ->> p_action)::integer, 0)
      into v_total, v_action_earned
      from public.economy_daily where user_id = p_user_id and day = v_day for update;
  end if;

  if not v_rule.enabled then
    return private._award_result(0, v_total, v_cap, 'rule_disabled');
  end if;
  if v_total >= v_cap then
    return private._award_result(0, v_total, v_cap, 'daily_cap_reached');
  end if;
  if v_action_earned >= v_rule.daily_max then
    return private._award_result(0, v_total, v_cap, 'action_cap_reached');
  end if;

  v_grant := least(v_rule.coins, v_cap - v_total, v_rule.daily_max - v_action_earned);

  -- Ledger histórico usa 'vote_reward' para o apoio recebido; mantém o motivo para não quebrar
  -- relatórios/backfill existentes.
  insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
  values (p_user_id, p_natural_key, 'coin', 'credit', v_grant,
          case p_action when 'support_received' then 'vote_reward' else p_action end,
          p_ref_type, p_ref_id)
  on conflict (user_id, natural_key) do nothing
  returning id into v_ledger_id;
  if v_ledger_id is null then
    return private._award_result(0, v_total, v_cap, 'already_awarded');
  end if;

  perform public._wallet_credit_coins(p_user_id, v_grant);
  update public.economy_daily set
    earned_total = earned_total + v_grant,
    earned_by_action = jsonb_set(earned_by_action, array[p_action], to_jsonb(v_action_earned + v_grant)),
    updated_at = now()
  where user_id = p_user_id and day = v_day;

  return private._award_result(v_grant, v_total + v_grant, v_cap, null);
end;
$$;

revoke all on function private.user_app_access(uuid) from public, anon, authenticated;
revoke all on function private.sp_today() from public, anon, authenticated;
revoke all on function private.evocoins_headroom(uuid, text) from public, anon, authenticated;
revoke all on function private.evocoins_day_snapshot(uuid) from public, anon, authenticated;
revoke all on function private._award_result(integer, integer, integer, text) from public, anon, authenticated;
revoke all on function private.is_meaningful_text(text, integer) from public, anon, authenticated;
revoke all on function private.post_is_rewardable(public.statuses) from public, anon, authenticated;
revoke all on function private.award_evocoins(uuid, text, text, text, text) from public, anon, authenticated;
