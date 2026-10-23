-- Heartbeats measure elapsed time only. Require a server-validated active business
-- event as well. No lifetime rewrite and no increase to the existing daily cap.
create or replace function private.has_reward_activity(p_user_id uuid, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.economy_transactions t where t.user_id=p_user_id
  and t.asset='coin' and t.direction='credit'
  and t.reason in ('workout_completed','post_published','comment_posted')
  and t.created_at >= (p_day::timestamp at time zone 'America/Sao_Paulo')
  and t.created_at < ((p_day+1)::timestamp at time zone 'America/Sao_Paulo'))
$$;
revoke all on function private.has_reward_activity(uuid,date) from public, anon, authenticated;
create or replace function private.record_activity_checkpoint(p_user_id uuid, p_now timestamptz)
returns table (is_qualified boolean, total_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  c_max_checkpoints constant integer := 40;
  c_min_gap_seconds constant integer := 60;
  c_max_gap_seconds constant integer := 20 * 60;
  v_day date := (p_now at time zone 'America/Sao_Paulo')::date;
  v_row public.community_creation_activity_days;
  v_min_seconds integer;
  v_gap_seconds numeric;
  v_added integer := 0;
  v_total integer;
  v_qualified boolean;
begin
  select min_qualified_seconds into v_min_seconds from public.community_creation_rules where id;
  if v_min_seconds is null then
    return query select false, 0;
    return;
  end if;

  insert into public.community_creation_activity_days (user_id, activity_date)
    values (p_user_id, v_day) on conflict (user_id, activity_date) do nothing;
  select * into v_row from public.community_creation_activity_days
    where user_id = p_user_id and activity_date = v_day for update;

  -- 1º ping do dia nunca soma; ping a < 60s do anterior é ignorado (não gasta cota);
  -- cada intervalo soma no máximo 20 min.
  if v_row.checkpoints_count >= c_max_checkpoints then
    return query select v_row.qualified, v_row.qualified_seconds;
    return;
  end if;
  if v_row.last_checkpoint_at is not null then
    v_gap_seconds := extract(epoch from (p_now - v_row.last_checkpoint_at));
    if v_gap_seconds < c_min_gap_seconds then
      return query select v_row.qualified, v_row.qualified_seconds;
      return;
    end if;
    v_added := least(v_gap_seconds, c_max_gap_seconds)::integer;
  end if;

  v_total := v_row.qualified_seconds + v_added;
  v_qualified := v_total >= v_min_seconds and private.has_reward_activity(p_user_id,v_day);
  update public.community_creation_activity_days set
    qualified_seconds = v_total,
    qualified = v_qualified,
    checkpoints_count = checkpoints_count + 1,
    last_checkpoint_at = p_now,
    updated_at = now()
  where user_id = p_user_id and activity_date = v_day;
  return query select v_qualified, v_total;
end;
$$;
create or replace function public.register_qualified_activity() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_day date := private.sp_today();
  v_ck record;
  v_reward_seconds integer;
  v_resolved boolean;
  v_award jsonb;
  v_reason text;
  v_base jsonb;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'A conta está em exclusão.';
  end if;
  -- has_app_access() devolve NULL (não false) quando os termos não foram aceitos: sempre coalesce.
  if not coalesce(public.has_app_access(), false) then
    raise exception 'APP_ACCESS_DENIED';
  end if;

  select * into v_ck from private.record_activity_checkpoint(v_uid, now());
  select activity_reward_seconds into v_reward_seconds from public.economy_reward_settings where id;
  select coalesce(activity_reward_granted, false) into v_resolved
    from public.economy_daily where user_id = v_uid and day = v_day;

  v_base := jsonb_build_object(
    'dayQualified', v_ck.is_qualified,
    'activeMinutes', round(v_ck.total_seconds / 60.0, 2)
  );

  if coalesce(v_resolved, false) then
    return v_base || jsonb_build_object('granted', false, 'reason', 'already_granted', 'awardedCoins', 0)
      || private.evocoins_day_snapshot(v_uid);
  end if;
  if v_ck.total_seconds < v_reward_seconds or not private.has_reward_activity(v_uid,v_day) then
    return v_base || jsonb_build_object('granted', false, 'awardedCoins', 0)
      || private.evocoins_day_snapshot(v_uid);
  end if;

  v_award := private.award_evocoins(v_uid, 'daily_activity', 'daily-activity:' || v_day::text, 'economy_daily', v_day::text);
  v_reason := v_award ->> 'reason';

  -- A recompensa do dia está resolvida (paga, já paga, ou barrada pelo teto): não há nova tentativa
  -- hoje. Regra desligada/conta indisponível não resolvem o dia.
  if coalesce(v_reason, '') not in ('rule_disabled', 'account_unavailable') then
    insert into public.economy_daily (user_id, day, activity_reward_granted) values (v_uid, v_day, true)
      on conflict (user_id, day) do update set activity_reward_granted = true, updated_at = now();
  end if;

  v_reason := case v_reason when 'already_awarded' then 'already_ledgered'
                            when 'action_cap_reached' then 'daily_cap_reached'
                            else v_reason end;
  return v_base
    || jsonb_build_object('granted', (v_award ->> 'awardedCoins')::integer > 0)
    || case when (v_award ->> 'awardedCoins')::integer > 0
            then jsonb_build_object('rewardCoins', (v_award ->> 'awardedCoins')::integer) else '{}'::jsonb end
    || (v_award - 'reason')
    || case when v_reason is null then '{}'::jsonb else jsonb_build_object('reason', v_reason) end;
end;
$$;
create or replace function private.post_is_rewardable(p_status public.statuses) returns boolean
language sql stable security definer set search_path = '' as $$
  select case p_status.type
    when 'text' then private.is_meaningful_text(p_status.text, 20)
    when 'poll' then private.is_meaningful_text(p_status.poll_question, 15)
    when 'achievement' then (coalesce(p_status.achievement_entries, 0) > 0 and exists (select 1 from public.workouts w where w.user_id=p_status.author_id and w.date::text=p_status.achievement_day))
                            or private.is_meaningful_text(p_status.achievement_text, 15)
    when 'photo' then exists (select 1 from storage.objects o where o.bucket_id='status-photos' and o.name=p_status.photo_path)
    when 'workout' then exists (select 1 from public.workouts w where w.user_id=p_status.author_id and w.date=(p_status.workout_date at time zone 'America/Sao_Paulo')::date)
    else false
  end
$$;

-- Retain only a one-way fingerprint in the existing ledger to deduplicate repeated
-- rewarded text even after resource removal. No extra personal text or second engine.
alter table public.economy_transactions add column content_fingerprint text;
create unique index economy_transactions_reward_fingerprint_idx
 on public.economy_transactions(user_id,content_fingerprint) where content_fingerprint is not null;
create or replace function private.reward_fingerprint(p_action text,p_ref_id text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_text text;
begin
 if p_ref_id !~ '^[0-9a-fA-F-]{36}$' then return null; end if;
 if p_action='post_published' then
  select case type when 'text' then text when 'poll' then poll_question
    when 'achievement' then achievement_text when 'photo' then photo_path
    when 'workout' then 'workout:'||workout_date::text end into v_text from public.statuses where id=p_ref_id::uuid;
 elsif p_action='comment_posted' then
  select body into v_text from public.post_comments where id=p_ref_id::uuid;
 end if;
 if nullif(btrim(v_text),'') is null then return null; end if;
 return md5(p_action||':'||regexp_replace(lower(btrim(v_text)),'\s+',' ','g'));
end;
$$;
revoke all on function private.reward_fingerprint(text,text) from public, anon, authenticated;
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
  v_fingerprint text;
begin
  if p_user_id is null or p_action is null or coalesce(p_natural_key, '') = '' then
    raise exception 'INVALID_ARGUMENT';
  end if;
  select * into v_rule from public.economy_reward_rules where action = p_action;
  if not found then raise exception 'UNKNOWN_ACTION'; end if;
  select daily_cap into v_cap from public.economy_reward_settings where id;

  select account_status into v_status from public.users where id = p_user_id;
  if v_status is null or v_status = 'deleting' or not private.user_app_access(p_user_id) then
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

  v_fingerprint := private.reward_fingerprint(p_action,p_ref_id);
  -- Ledger histórico usa 'vote_reward' para o apoio recebido; mantém o motivo para não quebrar
  -- relatórios/backfill existentes.
  insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id, content_fingerprint)
  values (p_user_id, p_natural_key, 'coin', 'credit', v_grant,
          case p_action when 'support_received' then 'vote_reward' else p_action end,
          p_ref_type, p_ref_id, v_fingerprint)
  on conflict do nothing
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
