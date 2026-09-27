-- Equivalente a reward-settlement-core.js/reward-settlement-service.js
-- (settleVoteRewardsScheduled, onSchedule every 5 minutes). Roda dentro de uma única
-- transação (o Postgres não tem o teto de tempo por invocação que o Firestore/Cloud
-- Functions tinha, então processa tudo numa passada só, sem "chunks" artificiais) e usa
-- um advisory lock em vez do documento de lease do Firestore — mais simples e
-- automaticamente liberado no fim da transação, mesmo se a função falhar no meio.
--
-- Simplificação deliberada: cada voto creditado gera seu PRÓPRIO lançamento no ledger
-- (natural_key = 'reward:{statusId}:{voterId}'), em vez de agrupar vários votos do
-- mesmo autor processados na mesma passada num único lançamento combinado (o que o
-- original fazia via um hash determinístico da lista de votos). O resultado financeiro
-- é idêntico; só a granularidade do histórico muda (1 linha por voto, não por rodada).
create or replace function public.evaluate_author_eligibility(p_author_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status text;
  v_restriction record;
begin
  select account_status into v_status from public.users where id = p_author_id;
  if v_status is null or v_status = 'deleting' then
    return jsonb_build_object('eligible', 'permanently_ineligible');
  end if;
  select * into v_restriction from public.account_restrictions where user_id = p_author_id;
  if v_restriction.action = 'system_ban' then
    return jsonb_build_object('eligible', 'permanently_ineligible');
  end if;
  if v_restriction.action = 'temporary_suspension' and v_restriction.until > now() then
    return jsonb_build_object('eligible', 'temporarily_ineligible', 'retryAt', v_restriction.until);
  end if;
  return jsonb_build_object('eligible', 'eligible');
end;
$$;

create or replace function public.settle_vote_rewards() returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_config jsonb;
  v_reward_per_vote numeric;
  v_max_post_day numeric;
  v_max_author_day numeric;
  v_max_pair_day integer;
  v_max_voter_day integer;
  v_deferred record;
  v_eligibility jsonb;
  v_promoted_count integer := 0;
  v_vote record;
  v_processed_count integer := 0;
  v_capped_count integer := 0;
  v_post_total numeric;
  v_author_total numeric;
  v_pair_count integer;
  v_voter_total integer;
begin
  if not pg_try_advisory_xact_lock(hashtext('settle_vote_rewards')) then
    return jsonb_build_object('skipped', true, 'reason', 'already_running');
  end if;

  select config into v_config from public.economy_config where id;
  v_reward_per_vote := (v_config->'voting'->>'rewardCoinsPerPositiveVote')::numeric;
  v_max_post_day := (v_config->'voting'->>'maxRewardCoinsPerPostDay')::numeric;
  v_max_author_day := (v_config->'voting'->>'maxRewardCoinsPerAuthorDay')::numeric;
  v_max_pair_day := (v_config->'voting'->>'maxRewardedVotesSameAuthorPerVoterDay')::integer;
  v_max_voter_day := (v_config->'voting'->>'maxRewardedVotesPerVoterDay')::integer;
  if v_reward_per_vote is null or v_reward_per_vote <= 0
     or v_max_post_day is null or v_max_author_day is null
     or v_max_pair_day is null or v_max_voter_day is null
     or v_reward_per_vote > v_max_post_day or v_reward_per_vote > v_max_author_day
  then
    v_reward_per_vote := 1;
    v_max_post_day := 10;
    v_max_author_day := 30;
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
        reward_day_key = (now() at time zone 'America/Sao_Paulo')::date, reward_retry_at = null
        where status_id = v_deferred.status_id and user_id = v_deferred.user_id;
      v_promoted_count := v_promoted_count + 1;
    elsif v_eligibility->>'eligible' = 'permanently_ineligible' then
      update public.status_economy_votes set reward_state = 'capped', reward_retry_at = null
        where status_id = v_deferred.status_id and user_id = v_deferred.user_id;
    end if;
    -- temporarily_ineligible: permanece deferred, nada a fazer.
  end loop;

  -- Descoberta + processamento em ordem global (evento mais antigo primeiro), nunca
  -- reagrupado por autor — é isso que faz os limites por dia funcionarem como cota
  -- compartilhada entre todos os votantes/posts, não uma cota por autor isolada.
  for v_vote in
    select * from public.status_economy_votes
    where reward_state = 'pending'
    order by reward_pending_at asc, status_id, user_id
    limit 200
    for update
  loop
    -- Revalidação: se o voto não é mais 'pending' quando chegamos nele (raro, só
    -- possível se algo mudou entre a query e o lock, o que FOR UPDATE já impede dentro
    -- desta transação) ou o votante removeu/trocou o voto, ignora silenciosamente.
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

    insert into public.status_economy_reward_daily (status_id, day, coins_credited) values (v_vote.status_id, v_vote.reward_day_key, 0)
      on conflict (status_id, day) do nothing;
    select coins_credited into v_post_total from public.status_economy_reward_daily where status_id = v_vote.status_id and day = v_vote.reward_day_key for update;

    insert into public.economy_daily (user_id, day) values (v_vote.author_id, v_vote.reward_day_key) on conflict (user_id, day) do nothing;
    select author_reward_coins into v_author_total from public.economy_daily where user_id = v_vote.author_id and day = v_vote.reward_day_key for update;

    insert into public.economy_daily_author_rewards (user_id, day, author_id, count) values (v_vote.user_id, v_vote.reward_day_key, v_vote.author_id, 0)
      on conflict (user_id, day, author_id) do nothing;
    select count into v_pair_count from public.economy_daily_author_rewards where user_id = v_vote.user_id and day = v_vote.reward_day_key and author_id = v_vote.author_id for update;

    insert into public.economy_daily (user_id, day) values (v_vote.user_id, v_vote.reward_day_key) on conflict (user_id, day) do nothing;
    select rewarded_votes_given into v_voter_total from public.economy_daily where user_id = v_vote.user_id and day = v_vote.reward_day_key for update;

    if v_post_total + v_reward_per_vote > v_max_post_day
       or v_author_total + v_reward_per_vote > v_max_author_day
       or v_pair_count + 1 > v_max_pair_day
       or v_voter_total + 1 > v_max_voter_day
    then
      update public.status_economy_votes set reward_state = 'capped' where status_id = v_vote.status_id and user_id = v_vote.user_id;
      v_capped_count := v_capped_count + 1;
      continue;
    end if;

    perform public._wallet_credit_coins(v_vote.author_id, v_reward_per_vote);
    perform public._ledger_record(
      v_vote.author_id, 'reward:' || v_vote.status_id::text || ':' || v_vote.user_id::text,
      'coin', 'credit', v_reward_per_vote, 'vote_reward', 'status_economy_vote',
      v_vote.status_id::text || ':' || v_vote.user_id::text
    );

    update public.status_economy_reward_daily set coins_credited = v_post_total + v_reward_per_vote
      where status_id = v_vote.status_id and day = v_vote.reward_day_key;
    update public.economy_daily set author_reward_coins = v_author_total + v_reward_per_vote
      where user_id = v_vote.author_id and day = v_vote.reward_day_key;
    update public.economy_daily_author_rewards set count = v_pair_count + 1
      where user_id = v_vote.user_id and day = v_vote.reward_day_key and author_id = v_vote.author_id;
    update public.economy_daily set rewarded_votes_given = v_voter_total + 1
      where user_id = v_vote.user_id and day = v_vote.reward_day_key;
    update public.status_economy_votes set reward_state = 'processed' where status_id = v_vote.status_id and user_id = v_vote.user_id;

    v_processed_count := v_processed_count + 1;
  end loop;

  return jsonb_build_object('promoted', v_promoted_count, 'processed', v_processed_count, 'capped', v_capped_count);
end;
$$;

revoke execute on function public.settle_vote_rewards() from public, anon, authenticated;
revoke execute on function public.evaluate_author_eligibility(uuid) from public, anon, authenticated;

-- Agendamento: a cada 5 minutos, mesma cadência do onSchedule original. cron.schedule
-- com um jobname já existente reagenda (idempotente), então é seguro rodar de novo.
create extension if not exists pg_cron;
select cron.schedule('settle-vote-rewards', '*/5 * * * *', $$select public.settle_vote_rewards()$$);
