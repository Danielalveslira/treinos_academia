-- Converge produção ao estado final da criação de comunidades.
--
-- 20261008000001/2 já estavam aplicadas em produção numa versão anterior à revisão final:
--   * record_activity_checkpoint devolvia void e register_qualified_activity não devolvia
--     dayQualified (o app precisa dele para só parar de pingar no dia quando o dia qualificou);
--   * faltavam três grants de hardening.
-- Migration já aplicada não se reescreve: este arquivo leva qualquer banco ao mesmo estado final
-- (é idempotente; em banco novo apenas repete o que 000001/000002 já fizeram).

drop function if exists private.record_activity_checkpoint(uuid, timestamptz);

create or replace function private.record_activity_checkpoint(p_user_id uuid, p_now timestamptz)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  c_max_checkpoints constant integer := 6;
  v_day date := (p_now at time zone 'America/Sao_Paulo')::date;
  v_row public.community_creation_activity_days;
  v_min_seconds integer;
  v_gap_seconds numeric;
  v_added integer := 0;
begin
  select min_qualified_seconds into v_min_seconds from public.community_creation_rules where id;
  if v_min_seconds is null then return false; end if;

  insert into public.community_creation_activity_days (user_id, activity_date)
    values (p_user_id, v_day) on conflict (user_id, activity_date) do nothing;
  select * into v_row from public.community_creation_activity_days
    where user_id = p_user_id and activity_date = v_day for update;

  if v_row.checkpoints_count >= c_max_checkpoints then return v_row.qualified; end if;
  if v_row.last_checkpoint_at is not null then
    v_gap_seconds := extract(epoch from (p_now - v_row.last_checkpoint_at));
    if v_gap_seconds < 60 then return v_row.qualified; end if;
    v_added := least(v_gap_seconds, 20 * 60)::integer;
  end if;

  update public.community_creation_activity_days set
    qualified_seconds = qualified_seconds + v_added,
    qualified = (qualified_seconds + v_added) >= v_min_seconds,
    checkpoints_count = checkpoints_count + 1,
    last_checkpoint_at = p_now,
    updated_at = now()
  where user_id = p_user_id and activity_date = v_day;
  return (v_row.qualified_seconds + v_added) >= v_min_seconds;
end;
$$;
revoke all on function private.record_activity_checkpoint(uuid, timestamptz) from public, anon, authenticated;

create or replace function public.register_qualified_activity() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_day date;
  v_now timestamptz := now();
  v_daily public.economy_daily;
  v_config jsonb;
  v_required_minutes numeric;
  v_reward_coins numeric;
  v_gap_ms numeric;
  v_added_minutes numeric;
  v_active_minutes numeric;
  v_reward_eligible boolean;
  v_checkpoints_count integer;
  v_natural_key text;
  v_day_qualified boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'A conta está em exclusão.';
  end if;

  v_day_qualified := private.record_activity_checkpoint(v_uid, v_now);

  v_day := (v_now at time zone 'America/Sao_Paulo')::date;

  select config into v_config from public.economy_config where id;
  v_required_minutes := (v_config->'dailyActivity'->>'requiredMinutes')::numeric;
  v_reward_coins := (v_config->'dailyActivity'->>'rewardCoins')::numeric;
  if v_required_minutes is null or v_required_minutes <= 0 or v_required_minutes > 1440
     or v_reward_coins is null or v_reward_coins <= 0 or v_reward_coins > 1000 then
    v_required_minutes := 30;
    v_reward_coins := 3;
  end if;

  insert into public.economy_daily (user_id, day) values (v_uid, v_day)
    on conflict (user_id, day) do nothing;
  select * into v_daily from public.economy_daily where user_id = v_uid and day = v_day for update;

  if v_daily.activity_reward_granted then
    return jsonb_build_object('granted', false, 'reason', 'already_granted') || jsonb_build_object('dayQualified', v_day_qualified);
  end if;
  if v_daily.checkpoints_count >= 6 then
    return jsonb_build_object('granted', false, 'reason', 'checkpoint_cap_reached') || jsonb_build_object('dayQualified', v_day_qualified);
  end if;

  if v_daily.last_qualified_activity_at is null then
    v_added_minutes := 0;
  else
    v_gap_ms := extract(epoch from (v_now - v_daily.last_qualified_activity_at)) * 1000;
    if v_gap_ms < 60000 then
      return jsonb_build_object('granted', false, 'reason', 'too_soon') || jsonb_build_object('dayQualified', v_day_qualified);
    end if;
    v_added_minutes := least(v_gap_ms, 20 * 60000) / 60000.0;
  end if;

  v_active_minutes := v_daily.active_minutes + v_added_minutes;
  v_reward_eligible := v_active_minutes >= v_required_minutes;
  v_checkpoints_count := v_daily.checkpoints_count + 1;

  if not v_reward_eligible then
    update public.economy_daily set
      active_minutes = v_active_minutes, checkpoints_count = v_checkpoints_count,
      last_qualified_activity_at = v_now, updated_at = now()
      where user_id = v_uid and day = v_day;
    return jsonb_build_object('granted', false, 'activeMinutes', v_active_minutes) || jsonb_build_object('dayQualified', v_day_qualified);
  end if;

  v_natural_key := 'daily-activity:' || v_day::text;
  if public._ledger_already_recorded(v_uid, v_natural_key) then
    update public.economy_daily set
      active_minutes = v_active_minutes, checkpoints_count = v_checkpoints_count,
      last_qualified_activity_at = v_now, activity_reward_granted = true, updated_at = now()
      where user_id = v_uid and day = v_day;
    return jsonb_build_object('granted', false, 'reason', 'already_ledgered') || jsonb_build_object('dayQualified', v_day_qualified);
  end if;

  perform public._wallet_credit_coins(v_uid, v_reward_coins);
  perform public._ledger_record(v_uid, v_natural_key, 'coin', 'credit', v_reward_coins, 'daily_activity', 'economy_daily', v_day::text);

  update public.economy_daily set
    active_minutes = v_active_minutes, checkpoints_count = v_checkpoints_count,
    last_qualified_activity_at = v_now, activity_reward_granted = true, updated_at = now()
    where user_id = v_uid and day = v_day;

  return jsonb_build_object('granted', true, 'rewardCoins', v_reward_coins, 'activeMinutes', v_active_minutes) || jsonb_build_object('dayQualified', v_day_qualified);
end;
$$;

-- anon nunca tem auth.uid(): a função só faz sentido para usuário autenticado.
revoke execute on function public.register_qualified_activity() from public, anon;
grant execute on function public.register_qualified_activity() to authenticated;

-- Função de trigger não precisa de EXECUTE público; community_creation_requests só é escrita
-- pelas RPCs security definer (o cliente só lê as próprias linhas, via policy).
revoke all on function private.communities_guard_insert() from public, anon, authenticated;
revoke insert, update, delete on public.community_creation_requests from anon, authenticated;
