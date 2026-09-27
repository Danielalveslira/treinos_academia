-- Economia (EvoCoins/EvoCash) — Fase 1: carteira, ledger append-only, configuração e
-- atividade qualificada diária. Portado de functions/economy/{wallet,ledger,config,
-- activity}-{core,service}.js, preservando as mesmas regras de negócio e mensagens.

-- public.wallets já existe (migration wallet_stub.sql) com RLS de leitura própria e
-- nenhuma policy de escrita — todo crédito/débito passa a partir de agora pelas
-- funções internas abaixo (nunca RLS de tabela, sempre security definer via RPC).

create table public.economy_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  natural_key text not null,
  asset text not null check (asset in ('coin', 'cash')),
  direction text not null check (direction in ('credit', 'debit')),
  amount numeric not null check (amount > 0),
  reason text not null,
  reference_type text,
  reference_id text,
  created_at timestamptz not null default now(),
  unique (user_id, natural_key)
);
create index economy_transactions_user_created_idx on public.economy_transactions(user_id, created_at desc);

alter table public.economy_transactions enable row level security;
create policy economy_transactions_select on public.economy_transactions for select
  using (user_id = auth.uid() or public.is_superadmin());

-- Configuração pública da economia (equivalente a economyConfig/current) — um único
-- documento jsonb, mesma forma flexível do Firestore. Leitura livre pra qualquer
-- autenticado (igual ao original: `read: isSignedIn()`); escrita só via RPC de admin
-- (adicionada nas fases seguintes, conforme cada bloco for consumido).
create table public.economy_config (
  id boolean primary key default true check (id),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.economy_config enable row level security;
create policy economy_config_select on public.economy_config for select
  using (auth.uid() is not null);
insert into public.economy_config (id, config) values (true, '{}'::jsonb);

-- users/{uid}/economyDaily/{day} vira uma linha por (user_id, day). Colunas de voto
-- (votes_charged etc.) entram na Fase 2, quando forem de fato usadas — mesmo motivo do
-- merge:true original: nenhuma fase pode apagar o que a outra já gravou no mesmo dia.
create table public.economy_daily (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  active_minutes numeric not null default 0,
  checkpoints_count integer not null default 0,
  last_qualified_activity_at timestamptz,
  activity_reward_granted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
alter table public.economy_daily enable row level security;
create policy economy_daily_select on public.economy_daily for select
  using (user_id = auth.uid() or public.is_superadmin());

-- Funções internas (prefixo _, execute revogado de anon/authenticated): só chamáveis a
-- partir de outras funções security definer deste schema, nunca diretamente pelo
-- cliente via RPC. Espelham wallet-service.js exatamente: nunca saldo negativo,
-- lifetime_coins_earned nunca decresce, cash_balance como inteiro seguro.

create or replace function public._wallet_ensure_row(p_user_id uuid) returns void
  language sql as $$
  insert into public.wallets (user_id) values (p_user_id) on conflict (user_id) do nothing
$$;

create or replace function public._wallet_credit_coins(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
begin
  perform public._wallet_ensure_row(p_user_id);
  perform 1 from public.wallets where user_id = p_user_id for update;
  update public.wallets
    set coin_balance = coin_balance + p_amount,
        lifetime_coins_earned = lifetime_coins_earned + p_amount,
        updated_at = now()
    where user_id = p_user_id;
end;
$$;

create or replace function public._wallet_debit_coins(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
declare
  v_balance numeric;
begin
  perform public._wallet_ensure_row(p_user_id);
  select coin_balance into v_balance from public.wallets where user_id = p_user_id for update;
  if v_balance - p_amount < 0 then
    raise exception 'Saldo de EvoCoins insuficiente.';
  end if;
  update public.wallets set coin_balance = coin_balance - p_amount, updated_at = now() where user_id = p_user_id;
end;
$$;

create or replace function public._wallet_credit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
declare
  v_next numeric;
begin
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance + p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 or v_next > 9007199254740991 then
    raise exception 'Saldo de EvoCash inválido após o crédito.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;

create or replace function public._wallet_debit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
declare
  v_next numeric;
begin
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance - p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 then
    raise exception 'Saldo de EvoCash insuficiente.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;

-- Ledger append-only. A unicidade natural (user_id, natural_key) SUBSTITUI o "ID do
-- documento = hash da chave natural" do Firestore — não precisamos recalcular um SHA-256
-- em SQL só pra ter uma chave única; a própria constraint já garante idempotência, e o
-- texto legível (ex. 'daily-activity:2026-09-27') ainda fica visível para auditoria.
create or replace function public._ledger_already_recorded(p_user_id uuid, p_natural_key text) returns boolean
  language sql stable as $$
  select exists(select 1 from public.economy_transactions where user_id = p_user_id and natural_key = p_natural_key)
$$;

create or replace function public._ledger_record(
  p_user_id uuid, p_natural_key text, p_asset text, p_direction text,
  p_amount numeric, p_reason text, p_reference_type text, p_reference_id text
) returns void
  language plpgsql as $$
begin
  insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
  values (p_user_id, p_natural_key, p_asset, p_direction, p_amount, p_reason, p_reference_type, p_reference_id);
exception when unique_violation then
  raise exception 'Esta operação já foi registrada.';
end;
$$;

revoke execute on function public._wallet_ensure_row(uuid) from public, anon, authenticated;
revoke execute on function public._wallet_credit_coins(uuid, numeric) from public, anon, authenticated;
revoke execute on function public._wallet_debit_coins(uuid, numeric) from public, anon, authenticated;
revoke execute on function public._wallet_credit_cash(uuid, numeric) from public, anon, authenticated;
revoke execute on function public._wallet_debit_cash(uuid, numeric) from public, anon, authenticated;
revoke execute on function public._ledger_already_recorded(uuid, text) from public, anon, authenticated;
revoke execute on function public._ledger_record(uuid, text, text, text, numeric, text, text, text) from public, anon, authenticated;

-- Equivalente a registerQualifiedActivity (activity-service.js/activity-core.js).
-- Regras replicadas ao pé da letra:
--   * MIN_CHECKPOINT_GAP_MS=60s, MAX_CHECKPOINT_GAP_MS=20min, MAX_CHECKPOINTS_PER_DAY=6.
--   * dateKey no fuso America/Sao_Paulo, nunca UTC nem relógio do cliente.
--   * 1º checkpoint do dia NUNCA credita (added_minutes=0), mesmo com config malformada.
--   * "too_soon" nunca consome cota de checkpoints (early return antes de qualquer escrita).
--   * dupla trava de idempotência: activity_reward_granted E o ledger (already_ledgered)
--     — protege contra estado inconsistente por falha parcial.
--   * `select ... for update` na linha do dia serializa checkpoints concorrentes (a
--     Firestore fazia isso via retry automático de transação; aqui é lock de linha real).
--   * config de dailyActivity tem fallback (30min/3coins) se ausente/inválida — é
--     EvoCoins, fail-open é aceitável (nunca faria isso para EvoCash/preço).
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
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'A conta está em exclusão.';
  end if;

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
    return jsonb_build_object('granted', false, 'reason', 'already_granted');
  end if;
  if v_daily.checkpoints_count >= 6 then
    return jsonb_build_object('granted', false, 'reason', 'checkpoint_cap_reached');
  end if;

  if v_daily.last_qualified_activity_at is null then
    v_added_minutes := 0;
  else
    v_gap_ms := extract(epoch from (v_now - v_daily.last_qualified_activity_at)) * 1000;
    if v_gap_ms < 60000 then
      return jsonb_build_object('granted', false, 'reason', 'too_soon');
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
    return jsonb_build_object('granted', false, 'activeMinutes', v_active_minutes);
  end if;

  v_natural_key := 'daily-activity:' || v_day::text;
  if public._ledger_already_recorded(v_uid, v_natural_key) then
    update public.economy_daily set
      active_minutes = v_active_minutes, checkpoints_count = v_checkpoints_count,
      last_qualified_activity_at = v_now, activity_reward_granted = true, updated_at = now()
      where user_id = v_uid and day = v_day;
    return jsonb_build_object('granted', false, 'reason', 'already_ledgered');
  end if;

  perform public._wallet_credit_coins(v_uid, v_reward_coins);
  perform public._ledger_record(v_uid, v_natural_key, 'coin', 'credit', v_reward_coins, 'daily_activity', 'economy_daily', v_day::text);

  update public.economy_daily set
    active_minutes = v_active_minutes, checkpoints_count = v_checkpoints_count,
    last_qualified_activity_at = v_now, activity_reward_granted = true, updated_at = now()
    where user_id = v_uid and day = v_day;

  return jsonb_build_object('granted', true, 'rewardCoins', v_reward_coins, 'activeMinutes', v_active_minutes);
end;
$$;
