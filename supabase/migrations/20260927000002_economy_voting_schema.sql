-- Economia — Fase 2, parte 1: schema de voto econômico + colunas de voto em
-- economy_daily. Portado de vote-core.js/vote-service.js.

alter table public.statuses
  add column if not exists positive_vote_count integer not null default 0,
  add column if not exists negative_vote_count integer not null default 0;

-- statuses/{id}/economyVotes/{uid} -> tabela própria, distinta de status_votes (voto de
-- ENQUETE, gratuito) -- nunca confundir os dois, mesmo aviso do código original.
create table public.status_economy_votes (
  status_id uuid not null references public.statuses(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  author_id uuid not null references public.users(id),
  value smallint check (value in (1, -1)),
  charged boolean not null default false,
  first_charged_at timestamptz,
  updated_at timestamptz not null default now(),
  reward_state text not null default 'ineligible'
    check (reward_state in ('pending', 'ineligible', 'deferred', 'processed', 'capped')),
  reward_pending_at timestamptz,
  reward_day_key date,
  reward_retry_at timestamptz,
  primary key (status_id, user_id)
);
create index status_economy_votes_reward_pending_idx
  on public.status_economy_votes(reward_pending_at, status_id, user_id)
  where reward_state = 'pending';

alter table public.status_economy_votes enable row level security;
create policy status_economy_votes_select on public.status_economy_votes for select
  using (user_id = auth.uid() or public.is_superadmin());

-- economy_daily ganha os campos de voto/recompensa (Fase 1 só tinha os de atividade).
-- author_reward_counts (mapa autor->contagem no Firestore) vira tabela própria abaixo,
-- mais seguro/consultável em SQL do que um jsonb reescrito por inteiro a cada write.
alter table public.economy_daily
  add column if not exists votes_charged integer not null default 0,
  add column if not exists vote_coins_spent numeric not null default 0,
  add column if not exists author_reward_coins numeric not null default 0,
  add column if not exists rewarded_votes_given integer not null default 0;

create table public.economy_daily_author_rewards (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  author_id uuid not null references public.users(id) on delete cascade,
  count integer not null default 0,
  primary key (user_id, day, author_id)
);
alter table public.economy_daily_author_rewards enable row level security;
create policy economy_daily_author_rewards_select on public.economy_daily_author_rewards for select
  using (user_id = auth.uid() or public.is_superadmin());

-- statuses/{id}/economyRewardDaily/{day}.coinsCredited -> teto por publicação/dia.
create table public.status_economy_reward_daily (
  status_id uuid not null references public.statuses(id) on delete cascade,
  day date not null,
  coins_credited numeric not null default 0,
  primary key (status_id, day)
);
alter table public.status_economy_reward_daily enable row level security;
create policy status_economy_reward_daily_select on public.status_economy_reward_daily for select
  using (public.is_superadmin());
