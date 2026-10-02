-- Apoiar / Não apoiar (voto econômico das publicações de comunidade): privacidade e integridade.
--
-- 1. PRIVACIDADE: list_post_economy_voters(status, direction) devolvia, a qualquer membro da
--    comunidade, a identidade de quem votou NÃO APOIAR (direction = -1). Removida. Em seu lugar,
--    list_post_supporters lista SOMENTE apoiadores (value = 1) -- não existe mais nenhuma RPC que
--    receba "direção" nem que liste não apoiadores. A reação "Não apoiar" continua existindo,
--    contando e sendo trocável/removível; só deixou de ter identidade visível.
--    A policy de leitura de status_economy_votes também deixa de liberar o superadmin: nenhuma tela
--    admin usa essa tabela (só o voto do próprio usuário é lido no app), então esse acesso era
--    exposição sem necessidade comprovada. Funções security definer (cast_vote, settlement) não
--    dependem dessa policy.
-- 2. INTEGRIDADE: advisory lock por (usuário, publicação) em cast_vote (retries concorrentes não
--    cobram nem contam 2x); contadores recalculados e protegidos por CHECK >= 0; trigger de DELETE
--    em status_economy_votes mantém os contadores corretos quando a conta de um votante é excluída
--    (o cascade de users removia o voto mas deixava o contador inflado).

drop function if exists public.list_post_economy_voters(uuid, smallint, timestamptz, integer);

drop policy if exists status_economy_votes_select on public.status_economy_votes;
create policy status_economy_votes_select on public.status_economy_votes for select
  using (user_id = auth.uid());

-- Lista de apoiadores: só value = 1, mais recentes primeiro, keyset (updated_at, user_id) -- estável
-- mesmo com empates de horário. Sem N+1: um único JOIN com public_profiles. Só devolve o que a UI
-- mostra (id, username, avatar_path); nada de charged/reward/timestamps internos. Mesma regra de
-- acesso do voto (membro da comunidade sem restrição) -- e o superadmin continua podendo ler, como
-- já podia ler a lista de apoios. Conta excluída: o voto some junto (cascade), então nunca aparece;
-- perfil público ausente vira username null (a UI mostra "Membro").
create or replace function public.list_post_supporters(
  p_status_id uuid, p_cursor_at timestamptz default null, p_cursor_user uuid default null, p_limit integer default 20
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_status public.statuses;
  v_page_size integer := least(greatest(coalesce(p_limit, 20), 1), 50);
  v_rows jsonb;
  v_count integer;
  v_last_at timestamptz;
  v_last_user uuid;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (p_cursor_at is null) <> (p_cursor_user is null) then raise exception 'INVALID_CURSOR'; end if;
  select * into v_status from public.statuses where id = p_status_id;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;

  if not (public.is_superadmin() or (
    public.is_community_member(v_status.community_id)
    and not exists (select 1 from public.community_restrictions where community_id = v_status.community_id and user_id = auth.uid())
  )) then
    raise exception 'PERMISSION_DENIED';
  end if;

  with page as (
    select v.user_id, v.updated_at, pp.username, pp.avatar_path
    from public.status_economy_votes v
    left join public.public_profiles pp on pp.user_id = v.user_id
    where v.status_id = p_status_id and v.value = 1
      and (p_cursor_at is null or (v.updated_at, v.user_id) < (p_cursor_at, p_cursor_user))
    order by v.updated_at desc, v.user_id desc
    limit v_page_size + 1
  ), shown as (
    select * from page order by updated_at desc, user_id desc limit v_page_size
  )
  select
    coalesce(jsonb_agg(jsonb_build_object('userId', s.user_id, 'username', s.username, 'avatarPath', s.avatar_path)
      order by s.updated_at desc, s.user_id desc), '[]'::jsonb),
    (select count(*) from page),
    (select updated_at from shown order by updated_at asc, user_id asc limit 1),
    (select user_id from shown order by updated_at asc, user_id asc limit 1)
    into v_rows, v_count, v_last_at, v_last_user
  from shown s;

  return jsonb_build_object(
    'supporters', v_rows,
    'nextCursor', case when v_count > v_page_size
      then jsonb_build_object('at', v_last_at, 'userId', v_last_user) else null end
  );
end;
$$;
revoke execute on function public.list_post_supporters(uuid, timestamptz, uuid, integer) from public, anon;
grant execute on function public.list_post_supporters(uuid, timestamptz, uuid, integer) to authenticated;

-- Contadores: recálculo a partir dos votos reais (corrige qualquer deriva histórica, p.ex. de
-- contas de votantes excluídas) e nunca negativos daqui em diante.
update public.statuses s set
  positive_vote_count = coalesce(c.pos, 0),
  negative_vote_count = coalesce(c.neg, 0)
from (
  select st.id, count(*) filter (where v.value = 1) pos, count(*) filter (where v.value = -1) neg
  from public.statuses st left join public.status_economy_votes v on v.status_id = st.id
  group by st.id
) c
where c.id = s.id and (s.positive_vote_count <> coalesce(c.pos, 0) or s.negative_vote_count <> coalesce(c.neg, 0));

alter table public.statuses add constraint statuses_vote_counts_nonnegative
  check (positive_vote_count >= 0 and negative_vote_count >= 0);

-- Votante excluído (ou voto removido por qualquer outro caminho): o contador acompanha. Quando a
-- própria publicação está sendo apagada (cascade de statuses), o UPDATE não encontra linha e é no-op.
create or replace function public._status_vote_deleted() returns trigger
  language plpgsql as $$
begin
  if old.value = 1 then
    update public.statuses set positive_vote_count = greatest(positive_vote_count - 1, 0) where id = old.status_id;
  elsif old.value = -1 then
    update public.statuses set negative_vote_count = greatest(negative_vote_count - 1, 0) where id = old.status_id;
  end if;
  return old;
end;
$$;
create trigger status_economy_votes_after_delete after delete on public.status_economy_votes
  for each row execute function public._status_vote_deleted();

-- cast_vote: idêntica à versão anterior, mais o advisory lock por (usuário, publicação).
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

  -- Serializa retries/cliques concorrentes do MESMO usuário na MESMA publicação: sem isto, duas
  -- chamadas simultâneas sem linha prévia passariam ambas por 'create' (cobrando 2x e somando 2
  -- no contador) e só a inserção cairia no ON CONFLICT. O lock é liberado no fim da transação.
  perform pg_advisory_xact_lock(hashtextextended('cast_vote:' || v_uid::text || ':' || p_status_id::text, 0));

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
