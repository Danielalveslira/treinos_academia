-- Infraestrutura mínima pra WalletContext não quebrar enquanto a fase de economia
-- (EvoCoins/EvoCash) não é portada — só leitura do próprio saldo (sempre zerado até lá).
-- Nenhuma policy de escrita: crédito/débito só vai existir quando as RPCs de economia
-- forem implementadas (wallet-service.js do main), sempre security definer.
create table public.wallets (
  user_id uuid primary key references public.users(id) on delete cascade,
  coin_balance integer not null default 0,
  lifetime_coins_earned integer not null default 0,
  cash_balance integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.wallets enable row level security;
create policy wallets_select on public.wallets for select
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.wallets;

create or replace function public.get_my_wallet() returns public.wallets
  language plpgsql stable security definer set search_path = public as $$
declare
  v_wallet public.wallets;
begin
  select * into v_wallet from public.wallets where user_id = auth.uid();
  if v_wallet is null then
    v_wallet := row(auth.uid(), 0, 0, 0, now())::public.wallets;
  end if;
  return v_wallet;
end;
$$;
