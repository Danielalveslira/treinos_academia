-- EvoCoins por participação — 1/7: schema do limite diário, regras e endurecimento da carteira.
--
-- Teto absoluto de EvoCoins GANHOS por usuário/dia (America/Sao_Paulo), somando todas as fontes.
-- Gastar não devolve cota: o contador é de crédito bruto. O agregado do dia vive em economy_daily
-- (já existente, 1 linha por usuário/dia) -- nenhum ledger é contado a cada ação e nenhum saldo
-- paralelo é criado. Quem credita é só private.award_evocoins (migration 2/7).

-- Regras globais. daily_cap só pode ser REDUZIDO (CHECK <= 10). Leitura/escrita só pelo servidor:
-- o cliente nunca vê valores nem tetos por ação (só o total diário, via get_my_evocoin_day).
create table public.economy_reward_settings (
  id boolean primary key default true check (id),
  daily_cap smallint not null default 10 check (daily_cap between 0 and 10),
  -- tempo qualificado no dia (mesma fonte dos dias ativos da criação de comunidade) que paga a atividade
  activity_reward_seconds integer not null default 1800 check (activity_reward_seconds between 60 and 86400),
  -- espera antes de pagar publicação/comentário
  pending_delay interval not null default interval '15 minutes'
    check (pending_delay between interval '1 minute' and interval '1 day')
);
insert into public.economy_reward_settings (id) values (true);

-- coins = valor por recompensa; daily_max = máximo de coins DESTA ação por dia (nunca acima do teto global).
create table public.economy_reward_rules (
  action text primary key check (action in (
    'daily_activity', 'workout_completed', 'post_published', 'comment_posted', 'support_received'
  )),
  coins smallint not null check (coins between 1 and 10),
  daily_max smallint not null check (daily_max between 1 and 10),
  enabled boolean not null default true,
  constraint economy_reward_rules_max_ck check (daily_max >= coins)
);
insert into public.economy_reward_rules (action, coins, daily_max) values
  ('daily_activity', 3, 3),
  ('workout_completed', 2, 2),
  ('post_published', 1, 2),
  ('comment_posted', 1, 3),
  ('support_received', 1, 3);

alter table public.economy_reward_settings enable row level security;
alter table public.economy_reward_rules enable row level security;
revoke all on public.economy_reward_settings from anon, authenticated;
revoke all on public.economy_reward_rules from anon, authenticated;

-- Agregado diário de crédito. earned_by_action = {"<action>": coins} -- só o servidor lê/escreve.
alter table public.economy_daily
  add column earned_total smallint not null default 0 check (earned_total between 0 and 10),
  add column earned_by_action jsonb not null default '{}'::jsonb;

-- As colunas de atividade antigas (active_minutes, checkpoints_count, last_qualified_activity_at)
-- deixam de ser escritas: a atividade passa a ter UMA fonte, community_creation_activity_days
-- (migration 3/7). activity_reward_granted continua marcando "recompensa do dia resolvida".
comment on column public.economy_daily.active_minutes is 'LEGADO: não é mais escrito. Fonte da atividade: community_creation_activity_days.';
comment on column public.economy_daily.checkpoints_count is 'LEGADO: não é mais escrito. Fonte da atividade: community_creation_activity_days.';
comment on column public.economy_daily.last_qualified_activity_at is 'LEGADO: não é mais escrito. Fonte da atividade: community_creation_activity_days.';
comment on column public.economy_daily.author_reward_coins is 'LEGADO: não é mais escrito. O limite de apoio recebido vem de earned_by_action.';

-- Dia da virada: quem já recebeu hoje pelas regras antigas entra no agregado (senão o teto do dia
-- da implantação poderia ser ultrapassado). Só o dia corrente importa; dias anteriores não têm teto.
insert into public.economy_daily (user_id, day, earned_total, earned_by_action)
select t.user_id, (now() at time zone 'America/Sao_Paulo')::date,
       least(sum(t.amount), 10)::smallint,
       jsonb_strip_nulls(jsonb_build_object(
         'daily_activity', nullif(sum(t.amount) filter (where t.reason = 'daily_activity'), 0)::integer,
         'support_received', nullif(sum(t.amount) filter (where t.reason = 'vote_reward'), 0)::integer
       ))
from public.economy_transactions t
where t.asset = 'coin' and t.direction = 'credit' and t.user_id is not null
  and t.reason in ('daily_activity', 'vote_reward')
  and (t.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date
group by t.user_id
on conflict (user_id, day) do update set
  earned_total = excluded.earned_total,
  earned_by_action = excluded.earned_by_action;

-- Escrita de cliente nas tabelas da economia: hoje só a ausência de policy a impede. REVOKE
-- explícito deixa o bloqueio independente de RLS (uma policy permissiva futura não abre a carteira).
revoke insert, update, delete, truncate on public.wallets from anon, authenticated;
revoke insert, update, delete, truncate on public.economy_transactions from anon, authenticated;
revoke insert, update, delete, truncate on public.economy_daily from anon, authenticated;
revoke insert, update, delete, truncate on public.economy_config from anon, authenticated;
revoke insert, update, delete, truncate on public.economy_daily_author_rewards from anon, authenticated;
revoke insert, update, delete, truncate on public.status_economy_reward_daily from anon, authenticated;
revoke insert, update, delete, truncate on public.status_economy_votes from anon, authenticated;

-- Saldo nunca negativo no próprio banco (hoje só as funções de débito garantem). NOT VALID protege
-- toda escrita nova já; a validação das linhas existentes só roda se NÃO houver saldo negativo --
-- caso contrário a migration avisa e a constraint fica pendente de validação (nada é corrigido
-- automaticamente: saldo negativo exige investigação, não ajuste silencioso).
alter table public.wallets add constraint wallets_coin_balance_nonnegative check (coin_balance >= 0) not valid;
do $$
begin
  if exists (select 1 from public.wallets where coin_balance < 0) then
    raise warning 'wallets_coin_balance_nonnegative NÃO validada: existem saldos de EvoCoins negativos (%). Investigar antes de rodar VALIDATE CONSTRAINT.',
      (select count(*) from public.wallets where coin_balance < 0);
  else
    alter table public.wallets validate constraint wallets_coin_balance_nonnegative;
  end if;
end $$;

-- Higiene: RPCs que só fazem sentido autenticadas deixam de ser executáveis por anon
-- (já falhavam por auth.uid() nulo; agora nem executam).
revoke execute on function public.cast_vote(uuid, smallint) from public, anon;
grant execute on function public.cast_vote(uuid, smallint) to authenticated;
revoke execute on function public.get_my_wallet() from public, anon;
grant execute on function public.get_my_wallet() to authenticated;
