-- EvoCoins por participação — 3/7: atividade unificada.
--
-- Uma única fonte server-side de checkpoints: community_creation_activity_days.
--   * >= community_creation_rules.min_qualified_seconds (10 min) -> dia ativo (criação de comunidade);
--   * >= economy_reward_settings.activity_reward_seconds (30 min) -> recompensa de atividade (+3).
-- A lógica paralela que gravava minutos em economy_daily deixa de existir.
--
-- Bug corrigido: o teto era de 6 pings/dia contando TODO ping aceito. O app pinga a cada >= 3 min,
-- então quem navega com frequência gastava os 6 pings em ~15 min e nunca chegava a 30 (só
-- recebia quem ficava >= 6 min parado entre pings -- o oposto do pretendido, e trivial de
-- automatizar). O tempo creditado é sempre o intervalo REAL entre pings (limitado a 20 min por
-- intervalo), então o teto de pings só precisa limitar escritas/dia, não minutos: 40/dia.

drop function if exists private.record_activity_checkpoint(uuid, timestamptz);

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
  v_qualified := v_total >= v_min_seconds;
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
revoke all on function private.record_activity_checkpoint(uuid, timestamptz) from public, anon, authenticated;

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
  if v_ck.total_seconds < v_reward_seconds then
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

revoke execute on function public.register_qualified_activity() from public, anon;
grant execute on function public.register_qualified_activity() to authenticated;
