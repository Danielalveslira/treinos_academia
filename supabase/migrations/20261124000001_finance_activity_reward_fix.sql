-- Corrige a regressão de 20261112000005: has_reward_activity passou a exigir um crédito do
-- MESMO dia por workout_completed/post_published/comment_posted antes de pagar daily_activity.
-- Isso tornou a recompensa por tempo de uso inalcançável por si só (quem só navega/treina sem
-- publicar nada novo no dia nunca recebe) e, como v_qualified em record_activity_checkpoint
-- também dependia de has_reward_activity, o mesmo gate silenciosamente endureceu o critério de
-- "dia ativo" usado pela elegibilidade de criação de comunidade (ver
-- 20261008000003_community_creation_rpcs.sql: required_active_days conta linhas qualified=true).
-- Nenhum dos dois efeitos foi a intenção documentada (o achado F06 falava em heartbeat ISOLADO,
-- não em navegação real throttled pelo próprio cliente -- ver useQualifiedActivity.js).
--
-- Reverte os dois para o critério histórico (só tempo, sem ação alheia), e troca a proteção
-- antifraude por algo que mede o MESMO sinal que estava sendo abusado -- repetição artificial --
-- em vez de uma ação de negócio sem relação: exige um número mínimo de checkpoints DISTINTOS
-- (cada um já exige >= 60s desde o anterior, ver c_min_gap_seconds) para pagar a recompensa de
-- atividade. Dois checkpoints bem posicionados não bastam mais para fechar os 30 minutos (cada
-- intervalo soma no máximo 20 min); com o piso de 5 checkpoints, só 3 chamadas ainda não alcançam
-- o mínimo, e replicar o padrão real do app (ping a cada navegação, no máximo 1x/3min pelo
-- throttle do cliente -- MIN_PING_INTERVAL_MS) passa a exigir presença real, não só esperar.
-- Isso não prova humano (nenhuma automação é provada impossível em lugar nenhum deste motor,
-- ver docs/audits/ECONOMIA_EVOLUTUS.md), só eleva o custo de forjar o mínimo viável.
--
-- Teto de checkpoints (40/dia) e o gate de "dia ativo" da criação de comunidade continuam
-- intactos; nenhuma migration histórica foi editada.

alter table public.economy_reward_settings
  add column activity_reward_min_checkpoints smallint not null default 5
    check (activity_reward_min_checkpoints between 1 and 40);

drop function if exists private.record_activity_checkpoint(uuid, timestamptz);

-- 3ª coluna chamada "checkpoints" (não "checkpoints_count"): RETURNS TABLE cria uma variável
-- implícita por coluna dentro da função, e o nome da coluna real colidiria com ela na hora de
-- fazer `checkpoints_count = checkpoints_count + 1` no UPDATE abaixo (ambíguo entre a variável
-- de retorno e a coluna da tabela).
create or replace function private.record_activity_checkpoint(p_user_id uuid, p_now timestamptz)
returns table (is_qualified boolean, total_seconds integer, checkpoints integer)
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
    return query select false, 0, 0;
    return;
  end if;

  insert into public.community_creation_activity_days (user_id, activity_date)
    values (p_user_id, v_day) on conflict (user_id, activity_date) do nothing;
  select * into v_row from public.community_creation_activity_days
    where user_id = p_user_id and activity_date = v_day for update;

  -- 1º ping do dia nunca soma; ping a < 60s do anterior é ignorado (não gasta cota);
  -- cada intervalo soma no máximo 20 min.
  if v_row.checkpoints_count >= c_max_checkpoints then
    return query select v_row.qualified, v_row.qualified_seconds, v_row.checkpoints_count;
    return;
  end if;
  if v_row.last_checkpoint_at is not null then
    v_gap_seconds := extract(epoch from (p_now - v_row.last_checkpoint_at));
    if v_gap_seconds < c_min_gap_seconds then
      return query select v_row.qualified, v_row.qualified_seconds, v_row.checkpoints_count;
      return;
    end if;
    v_added := least(v_gap_seconds, c_max_gap_seconds)::integer;
  end if;

  v_total := v_row.qualified_seconds + v_added;
  -- Restaurado ao critério histórico: só tempo. A proteção antifraude da recompensa em coins
  -- mora em register_qualified_activity (piso de checkpoints), não aqui -- "dia ativo" da
  -- criação de comunidade nunca exigiu uma ação de negócio alheia, e não deve passar a exigir.
  v_qualified := v_total >= v_min_seconds;
  update public.community_creation_activity_days set
    qualified_seconds = v_total,
    qualified = v_qualified,
    checkpoints_count = checkpoints_count + 1,
    last_checkpoint_at = p_now,
    updated_at = now()
  where user_id = p_user_id and activity_date = v_day;
  return query select v_qualified, v_total, v_row.checkpoints_count + 1;
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
  v_min_checkpoints integer;
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
  select activity_reward_seconds, activity_reward_min_checkpoints
    into v_reward_seconds, v_min_checkpoints
    from public.economy_reward_settings where id;
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
  -- Antifraude: tempo suficiente E checkpoints suficientes. Nenhum dos dois sozinho basta -- só
  -- tempo é o heartbeat isolado do achado F06; só contagem sem o piso de tempo pagaria quem
  -- nunca passou os 30 min. Nenhuma ação de negócio alheia (treino/post/comentário) é exigida.
  if v_ck.total_seconds < v_reward_seconds or v_ck.checkpoints < v_min_checkpoints then
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

-- Não mais usada: a proteção antifraude da atividade agora mora no piso de checkpoints acima,
-- não em exigir uma ação de negócio alheia no mesmo dia.
drop function if exists private.has_reward_activity(uuid, date);
