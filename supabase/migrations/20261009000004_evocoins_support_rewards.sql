-- EvoCoins por participação — 4/7: apoio recebido passa pelo motor central.
--
-- Mudanças em settle_vote_rewards (resto igual ao da migration 20260927000004):
--   * o crédito vai por private.award_evocoins (teto global de 10/dia e teto passivo de 3/dia vêm
--     de economy_reward_rules; valor/limite deixam de ser lidos de economy_config);
--   * o dia de TODOS os limites é o dia real do CRÉDITO (agora, em America/Sao_Paulo), não o dia do
--     voto -- um voto às 23:58 liquidado às 00:03 conta no dia novo;
--   * autor sem folga no dia: retorno rápido ANTES de tocar em qualquer contador -> 'capped'
--     (estado final, como já era para os outros tetos: impede que votos de um autor no teto
--     entupam a fila de 200 por rodada);
--   * o contador legado economy_daily.author_reward_coins deixa de existir como regra.
-- Mantidos como proteção contra conluio: teto por publicação/dia, por par votante-autor/dia e de
-- votos recompensados por votante/dia.

create or replace function public.settle_vote_rewards() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_config jsonb;
  v_rule_coins integer;
  v_max_post_day numeric;
  v_max_pair_day integer;
  v_max_voter_day integer;
  v_credit_day date := private.sp_today();
  v_deferred record;
  v_eligibility jsonb;
  v_promoted_count integer := 0;
  v_vote record;
  v_processed_count integer := 0;
  v_capped_count integer := 0;
  v_post_total numeric;
  v_pair_count integer;
  v_voter_total integer;
  v_award jsonb;
  v_awarded integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('settle_vote_rewards')) then
    return jsonb_build_object('skipped', true, 'reason', 'already_running');
  end if;

  select coins into v_rule_coins from public.economy_reward_rules where action = 'support_received' and enabled;
  if v_rule_coins is null then
    return jsonb_build_object('skipped', true, 'reason', 'rule_disabled');
  end if;

  select config into v_config from public.economy_config where id;
  v_max_post_day := coalesce((v_config->'voting'->>'maxRewardCoinsPerPostDay')::numeric, 10);
  v_max_pair_day := coalesce((v_config->'voting'->>'maxRewardedVotesSameAuthorPerVoterDay')::integer, 3);
  v_max_voter_day := coalesce((v_config->'voting'->>'maxRewardedVotesPerVoterDay')::integer, 20);
  if v_max_post_day < v_rule_coins or v_max_pair_day <= 0 or v_max_voter_day <= 0 then
    v_max_post_day := 10;
    v_max_pair_day := 3;
    v_max_voter_day := 20;
  end if;

  -- Promove deferred -> pending (ou capped, se a suspensão do autor virou algo pior
  -- nesse meio-tempo), até 100 por execução, reavaliando elegibilidade agora.
  for v_deferred in
    select * from public.status_economy_votes
    where reward_state = 'deferred'
    order by reward_retry_at asc nulls first, status_id, user_id
    limit 100
    for update
  loop
    v_eligibility := public.evaluate_author_eligibility(v_deferred.author_id);
    if v_eligibility->>'eligible' = 'eligible' then
      update public.status_economy_votes set
        reward_state = 'pending', reward_pending_at = now(),
        reward_day_key = v_credit_day, reward_retry_at = null
        where status_id = v_deferred.status_id and user_id = v_deferred.user_id;
      v_promoted_count := v_promoted_count + 1;
    elsif v_eligibility->>'eligible' = 'permanently_ineligible' then
      update public.status_economy_votes set reward_state = 'capped', reward_retry_at = null
        where status_id = v_deferred.status_id and user_id = v_deferred.user_id;
    end if;
    -- temporarily_ineligible: permanece deferred, nada a fazer.
  end loop;

  -- Ordem global (evento mais antigo primeiro), nunca reagrupado por autor.
  for v_vote in
    select * from public.status_economy_votes
    where reward_state = 'pending'
    order by reward_pending_at asc, status_id, user_id
    limit 200
    for update
  loop
    if v_vote.reward_state <> 'pending' or v_vote.value <> 1 then
      continue;
    end if;

    v_eligibility := public.evaluate_author_eligibility(v_vote.author_id);
    if v_eligibility->>'eligible' = 'permanently_ineligible' then
      update public.status_economy_votes set reward_state = 'capped' where status_id = v_vote.status_id and user_id = v_vote.user_id;
      continue;
    end if;
    if v_eligibility->>'eligible' = 'temporarily_ineligible' then
      update public.status_economy_votes set reward_state = 'deferred', reward_retry_at = (v_eligibility->>'retryAt')::timestamptz
        where status_id = v_vote.status_id and user_id = v_vote.user_id;
      continue;
    end if;

    -- Autor sem folga hoje (teto global ou passivo): nada mais é tocado.
    if private.evocoins_headroom(v_vote.author_id, 'support_received') <= 0 then
      update public.status_economy_votes set reward_state = 'capped' where status_id = v_vote.status_id and user_id = v_vote.user_id;
      v_capped_count := v_capped_count + 1;
      continue;
    end if;

    insert into public.status_economy_reward_daily (status_id, day, coins_credited) values (v_vote.status_id, v_credit_day, 0)
      on conflict (status_id, day) do nothing;
    select coins_credited into v_post_total from public.status_economy_reward_daily where status_id = v_vote.status_id and day = v_credit_day for update;

    insert into public.economy_daily_author_rewards (user_id, day, author_id, count) values (v_vote.user_id, v_credit_day, v_vote.author_id, 0)
      on conflict (user_id, day, author_id) do nothing;
    select count into v_pair_count from public.economy_daily_author_rewards where user_id = v_vote.user_id and day = v_credit_day and author_id = v_vote.author_id for update;

    insert into public.economy_daily (user_id, day) values (v_vote.user_id, v_credit_day) on conflict (user_id, day) do nothing;
    select rewarded_votes_given into v_voter_total from public.economy_daily where user_id = v_vote.user_id and day = v_credit_day for update;

    if v_post_total + v_rule_coins > v_max_post_day
       or v_pair_count + 1 > v_max_pair_day
       or v_voter_total + 1 > v_max_voter_day
    then
      update public.status_economy_votes set reward_state = 'capped' where status_id = v_vote.status_id and user_id = v_vote.user_id;
      v_capped_count := v_capped_count + 1;
      continue;
    end if;

    v_award := private.award_evocoins(
      v_vote.author_id, 'support_received', 'reward:' || v_vote.status_id::text || ':' || v_vote.user_id::text,
      'status_economy_vote', v_vote.status_id::text || ':' || v_vote.user_id::text
    );
    v_awarded := (v_award->>'awardedCoins')::integer;
    if v_awarded = 0 then
      -- already_awarded: o ledger já tem este voto (retry/estado inconsistente) -> processado, sem pagar de novo.
      update public.status_economy_votes
        set reward_state = case when v_award->>'reason' = 'already_awarded' then 'processed' else 'capped' end
        where status_id = v_vote.status_id and user_id = v_vote.user_id;
      v_capped_count := v_capped_count + 1;
      continue;
    end if;

    update public.status_economy_reward_daily set coins_credited = v_post_total + v_awarded
      where status_id = v_vote.status_id and day = v_credit_day;
    update public.economy_daily_author_rewards set count = v_pair_count + 1
      where user_id = v_vote.user_id and day = v_credit_day and author_id = v_vote.author_id;
    update public.economy_daily set rewarded_votes_given = v_voter_total + 1
      where user_id = v_vote.user_id and day = v_credit_day;
    update public.status_economy_votes set reward_state = 'processed' where status_id = v_vote.status_id and user_id = v_vote.user_id;

    v_processed_count := v_processed_count + 1;
  end loop;

  return jsonb_build_object('promoted', v_promoted_count, 'processed', v_processed_count, 'capped', v_capped_count);
end;
$$;

revoke execute on function public.settle_vote_rewards() from public, anon, authenticated;
