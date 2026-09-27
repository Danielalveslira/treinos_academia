-- Economia (EvoCoins/EvoCash) — Fase 4: compra de EvoCash e promoções (post/comunidade).
-- Portado de functions/economy/{cash-purchase,promotion}-{core,service}.js.
--
-- Diferença deliberada em relação ao original: lá a confirmação de PIX era 100% manual
-- (superadmin, via painel). Aqui o Mercado Pago assume a confirmação automática (webhook
-- oficial, sempre revalidado buscando o pagamento de volta na API do Mercado Pago antes de
-- creditar — nunca confia no payload do webhook por si só) via Edge Functions
-- (supabase/functions/mercadopago-create-payment e mercadopago-webhook). confirm_cash_purchase/
-- cancel_cash_purchase (RPC, superadmin) continuam existindo como fallback operacional
-- (ex.: webhook falhou, pagamento resolvido fora do fluxo padrão) — nunca removidos, só
-- deixam de ser o caminho principal.
--
-- Preço/pacotes seguem fail-closed (ausente/inválido/inativo bloqueia, nunca cai num
-- default) — mesma disciplina de create_community_with_cash para dinheiro real.

alter table public.communities
  add column if not exists promoted boolean not null default false,
  add column if not exists promoted_until timestamptz;
-- active_promotion_id (uuid, sem FK ainda) é adicionada abaixo, depois que a tabela
-- promotions existir nesta mesma migration.

-- Pacotes de cash e de promoção entram por merge raso (||) em economy_config.config —
-- nunca sobrescrevendo chaves já configuradas por outra fase (ex. 'activity', 'voting',
-- 'privileges'). Valores confirmados no código/testes atuais (cash-purchase-service.test.js,
-- promotion-service.test.js) — não os de nenhum prompt/documento antigo.
update public.economy_config set config = config || jsonb_build_object(
  'cashPackages', jsonb_build_object(
    'pack_25', jsonb_build_object('cashAmount', 25, 'amountCentavos', 590, 'label', 'Essencial', 'active', true),
    'pack_50_v2', jsonb_build_object('cashAmount', 50, 'amountCentavos', 1090, 'label', 'Inicial', 'active', true),
    'pack_120', jsonb_build_object('cashAmount', 120, 'amountCentavos', 2390, 'label', 'Popular', 'active', true),
    'pack_300_v2', jsonb_build_object('cashAmount', 300, 'amountCentavos', 4990, 'label', 'Max', 'active', true)
  ),
  'promotionPackages', jsonb_build_object(
    'post_boost_3d', jsonb_build_object('targetType', 'post', 'cashAmount', 25, 'durationDays', 3, 'label', 'Destaque 3 dias', 'active', true),
    'post_boost_7d', jsonb_build_object('targetType', 'post', 'cashAmount', 50, 'durationDays', 7, 'label', 'Destaque 7 dias', 'active', true),
    'community_boost_7d', jsonb_build_object('targetType', 'community', 'cashAmount', 100, 'durationDays', 7, 'label', 'Destaque 7 dias', 'active', true),
    'community_boost_30d', jsonb_build_object('targetType', 'community', 'cashAmount', 300, 'durationDays', 30, 'label', 'Destaque 30 dias', 'active', true)
  )
), updated_at = now()
where id;

-- ============================================================================
-- Compra de EvoCash
-- ============================================================================

create table public.cash_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  request_id text not null,
  package_id text not null,
  package_label text not null,
  cash_amount numeric not null check (cash_amount > 0),
  amount_centavos integer not null check (amount_centavos > 0),
  currency text not null default 'BRL',
  status text not null default 'pending' check (status in ('pending', 'credited', 'cancelled')),
  mp_payment_id bigint,
  mp_status text,
  qr_code text,
  qr_code_base64 text,
  ticket_url text,
  created_at timestamptz not null default now(),
  credited_at timestamptz,
  credited_by uuid references public.users(id),
  confirmation_note text check (confirmation_note is null or char_length(confirmation_note) <= 500),
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  unique (user_id, request_id)
);
create index cash_purchases_user_created_idx on public.cash_purchases(user_id, created_at desc);
create index cash_purchases_status_created_idx on public.cash_purchases(status, created_at desc);
-- No máximo 1 compra pendente por usuário — mesmo papel de users/{uid}/wallet/cashPurchaseLock,
-- só que como invariante de índice em vez de um documento de lease dedicado.
create unique index cash_purchases_one_pending_idx on public.cash_purchases(user_id) where status = 'pending';
-- Um mp_payment_id só pode estar ligado a UMA compra (defesa extra, além do webhook já
-- buscar por ele).
create unique index cash_purchases_mp_payment_id_idx on public.cash_purchases(mp_payment_id) where mp_payment_id is not null;

alter table public.cash_purchases enable row level security;
create policy cash_purchases_select on public.cash_purchases for select
  using (user_id = auth.uid() or public.is_superadmin());
-- useCashPurchases.js escuta a transição pending -> credited/cancelled da própria
-- compra (nunca a tabela inteira) via Realtime, mesmo padrão de users/wallets.
alter publication supabase_realtime add table public.cash_purchases;

-- Equivalente a requestCashPurchase. NÃO fala com o Mercado Pago (isso é HTTP, cabe à
-- Edge Function mercadopago-create-payment, chamada pelo cliente depois desta RPC
-- devolver o id pendente) — aqui só reserva a linha, com toda a elegibilidade/preço
-- fail-closed já resolvidos.
create or replace function public.request_cash_purchase(p_package_id text, p_request_id text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.cash_purchases;
  v_config jsonb;
  v_pkg jsonb;
  v_cash_amount numeric;
  v_amount_centavos integer;
  v_label text;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_package_id is null or p_request_id is null or length(p_request_id) = 0 then
    raise exception 'INVALID_REQUEST';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_existing from public.cash_purchases where user_id = v_uid and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.package_id <> p_package_id then raise exception 'REQUEST_ID_CONFLICT'; end if;
    return jsonb_build_object(
      'id', v_existing.id, 'status', v_existing.status, 'packageId', v_existing.package_id,
      'cashAmount', v_existing.cash_amount, 'amountCentavos', v_existing.amount_centavos,
      'currency', v_existing.currency, 'qrCode', v_existing.qr_code, 'qrCodeBase64', v_existing.qr_code_base64,
      'ticketUrl', v_existing.ticket_url, 'replay', true
    );
  end if;

  if exists (select 1 from public.cash_purchases where user_id = v_uid and status = 'pending') then
    raise exception 'PENDING_CASH_PURCHASE_EXISTS';
  end if;

  select config into v_config from public.economy_config where id;
  v_pkg := v_config->'cashPackages'->p_package_id;
  v_cash_amount := (v_pkg->>'cashAmount')::numeric;
  v_amount_centavos := (v_pkg->>'amountCentavos')::integer;
  v_label := v_pkg->>'label';
  if v_pkg is null or v_cash_amount is null or v_cash_amount <= 0 or v_cash_amount > 1000000
     or v_amount_centavos is null or v_amount_centavos <= 0 or v_amount_centavos > 10000000
     or v_label is null or length(v_label) = 0 or length(v_label) > 80
     or coalesce((v_pkg->>'active')::boolean, false) <> true
  then
    raise exception 'CASH_PACKAGE_UNAVAILABLE';
  end if;

  v_new_id := gen_random_uuid();
  insert into public.cash_purchases (
    id, user_id, request_id, package_id, package_label, cash_amount, amount_centavos, currency, status
  ) values (
    v_new_id, v_uid, p_request_id, p_package_id, v_label, v_cash_amount, v_amount_centavos, 'BRL', 'pending'
  );

  return jsonb_build_object(
    'id', v_new_id, 'status', 'pending', 'packageId', p_package_id,
    'cashAmount', v_cash_amount, 'amountCentavos', v_amount_centavos, 'currency', 'BRL', 'replay', false
  );
end;
$$;

-- Chamada só pela Edge Function mercadopago-create-payment (service_role — nunca
-- exposta a authenticated/anon), imediatamente depois de criar o pagamento PIX na API do
-- Mercado Pago, para gravar o QR code/link retornados.
create or replace function public.attach_mercadopago_payment(
  p_purchase_id uuid, p_mp_payment_id bigint, p_mp_status text,
  p_qr_code text, p_qr_code_base64 text, p_ticket_url text
) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update public.cash_purchases set
    mp_payment_id = p_mp_payment_id, mp_status = p_mp_status,
    qr_code = p_qr_code, qr_code_base64 = p_qr_code_base64, ticket_url = p_ticket_url
  where id = p_purchase_id and status = 'pending';
end;
$$;
revoke execute on function public.attach_mercadopago_payment(uuid, bigint, text, text, text, text) from public, anon, authenticated;

-- Chamada só pela Edge Function mercadopago-webhook (service_role), depois de já ter
-- revalidado o pagamento direto na API do Mercado Pago (nunca confiar no corpo do
-- webhook). Idempotente: reentrega do mesmo webhook, ou reentrega depois de já
-- creditado/cancelado, nunca credita 2x.
create or replace function public.credit_cash_purchase_from_webhook(p_mp_payment_id bigint, p_mp_status text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.cash_purchases;
begin
  select * into v_purchase from public.cash_purchases where mp_payment_id = p_mp_payment_id for update;
  if v_purchase is null then raise exception 'PURCHASE_NOT_FOUND'; end if;

  if v_purchase.status <> 'pending' then
    return jsonb_build_object('credited', false, 'reason', 'already_' || v_purchase.status);
  end if;

  if p_mp_status <> 'approved' then
    update public.cash_purchases set mp_status = p_mp_status where id = v_purchase.id;
    return jsonb_build_object('credited', false, 'reason', 'not_approved');
  end if;

  -- Revalidação defensiva do snapshot antes de creditar — dinheiro real nunca confia
  -- cegamente num dado só porque já está gravado (mesma defesa do confirmCashPurchase
  -- original).
  if v_purchase.cash_amount is null or v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000
     or v_purchase.amount_centavos is null or v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000
  then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;

  if public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
    update public.cash_purchases set status = 'credited', credited_at = now(), mp_status = p_mp_status where id = v_purchase.id;
    return jsonb_build_object('credited', false, 'reason', 'already_ledgered');
  end if;

  perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
  perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text, 'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);

  update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = null, mp_status = p_mp_status
    where id = v_purchase.id;

  perform public._reactivate_deletion_if_clear(v_purchase.user_id);

  return jsonb_build_object('credited', true, 'cashAmount', v_purchase.cash_amount, 'userId', v_purchase.user_id);
end;
$$;
revoke execute on function public.credit_cash_purchase_from_webhook(bigint, text) from public, anon, authenticated;

-- Fallback operacional (superadmin) — equivalente a confirmCashPurchase, para quando o
-- webhook falhar ou o pagamento tenha sido resolvido fora do fluxo Mercado Pago.
create or replace function public.confirm_cash_purchase(p_purchase_id uuid, p_admin_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_admin_note is not null and length(p_admin_note) > 500 then raise exception 'ADMIN_NOTE_TOO_LONG'; end if;

  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;
  if v_purchase.cash_amount is null or v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000
     or v_purchase.amount_centavos is null or v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000
  then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;
  if public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
    raise exception 'ALREADY_CREDITED';
  end if;

  perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
  perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text, 'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);

  update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = auth.uid(), confirmation_note = p_admin_note
    where id = p_purchase_id;

  perform public._reactivate_deletion_if_clear(v_purchase.user_id);

  return jsonb_build_object('id', p_purchase_id, 'status', 'credited');
end;
$$;

-- Equivalente a cancelCashPurchase — nunca credita nada (nada foi creditado ainda).
create or replace function public.cancel_cash_purchase(p_purchase_id uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_purchase public.cash_purchases;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if length(p_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;

  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_PENDING'; end if;

  update public.cash_purchases set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = p_reason
    where id = p_purchase_id;

  perform public._reactivate_deletion_if_clear(v_purchase.user_id);

  return jsonb_build_object('id', p_purchase_id, 'status', 'cancelled');
end;
$$;

-- Equivalente a reactivateDeletionIfClear: libera (ou atualiza o motivo de) um job de
-- exclusão bloqueado por revisão financeira, usando o resultado HIPOTÉTICO já aplicado
-- na mesma transação (nunca relendo depois). O worker que efetivamente processa
-- deletion_jobs ainda não existe no Supabase — isto só mantém block_reason correto para
-- quando ele existir.
create or replace function public._reactivate_deletion_if_clear(p_user_id uuid) returns void
  language plpgsql as $$
declare
  v_pending_purchase boolean;
  v_cash_balance numeric;
  v_reason text;
begin
  select exists(select 1 from public.cash_purchases where user_id = p_user_id and status = 'pending') into v_pending_purchase;
  select cash_balance into v_cash_balance from public.wallets where user_id = p_user_id;
  v_reason := case
    when v_pending_purchase then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance'
    else null
  end;
  if v_reason is null then
    update public.deletion_jobs set state = 'pending', block_reason = null, updated_at = now()
      where kind = 'account' and target_id = p_user_id and state = 'blocked_financial_review';
  else
    update public.deletion_jobs set block_reason = v_reason, updated_at = now()
      where kind = 'account' and target_id = p_user_id and state = 'blocked_financial_review';
  end if;
end;
$$;
revoke execute on function public._reactivate_deletion_if_clear(uuid) from public, anon, authenticated;

-- ============================================================================
-- Promoções (post/comunidade)
-- ============================================================================

create table public.promotions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users(id),
  request_id text not null,
  target_type text not null check (target_type in ('post', 'community')),
  target_id uuid not null,
  -- Sem FK: pode sobreviver à exclusão da própria comunidade (histórico econômico
  -- permanente, nunca apagado -- mesmo tratamento de target_id, que também não tem FK
  -- por poder apontar para statuses OU communities).
  community_id uuid not null,
  package_id text not null,
  cash_amount numeric not null check (cash_amount > 0),
  duration_days integer not null check (duration_days > 0),
  status text not null default 'active' check (status in ('active', 'cancelled', 'target_removed')),
  started_at timestamptz not null default now(),
  expires_at timestamptz not null,
  cancelled_at timestamptz,
  cancelled_by uuid references public.users(id),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 500),
  click_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (owner_id, request_id)
);
create index promotions_owner_created_idx on public.promotions(owner_id, created_at desc);
create index promotions_target_status_idx on public.promotions(target_type, target_id, status);

alter table public.promotions enable row level security;
create policy promotions_select on public.promotions for select
  using (owner_id = auth.uid() or public.is_superadmin());

-- Agora que promotions existe, statuses/communities podem referenciar de fato a
-- promoção ativa (statuses.active_promotion_id nasceu uuid solto, sem FK, na Fase 4
-- adiantada — ver 20260927000003_economy_cast_vote.sql).
alter table public.statuses add column if not exists active_promotion_id uuid;
alter table public.statuses add constraint statuses_active_promotion_fk
  foreign key (active_promotion_id) references public.promotions(id);
alter table public.communities add column if not exists active_promotion_id uuid
  references public.promotions(id);

create table public.promotion_event_limits (
  user_id uuid not null references public.users(id),
  promotion_id uuid not null references public.promotions(id),
  last_click_at timestamptz not null,
  expire_at timestamptz not null,
  primary key (user_id, promotion_id)
);
alter table public.promotion_event_limits enable row level security;
create policy promotion_event_limits_select on public.promotion_event_limits for select
  using (user_id = auth.uid());

-- Equivalente a createPromotion. Ordem de validação idêntica ao original (ver relatório
-- de exploração): alvo existe → dono → conta habilitada/sem restrição → membro da
-- comunidade (mesmo para promover a própria comunidade) → comunidade sem restrição →
-- comunidade disponível → não já promovido → pacote válido/compatível → saldo
-- suficiente. Tudo atômico: débito + ledger + linha da promoção + flags no alvo.
create or replace function public.create_promotion(
  p_target_type text, p_target_id uuid, p_package_id text, p_request_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.promotions;
  v_status public.statuses;
  v_community public.communities;
  v_is_owner boolean;
  v_community_id uuid;
  v_promoted boolean;
  v_promoted_until timestamptz;
  v_config jsonb;
  v_pkg jsonb;
  v_cash_amount numeric;
  v_duration_days integer;
  v_wallet public.wallets;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target_type not in ('post', 'community') then raise exception 'INVALID_TARGET_TYPE'; end if;
  if p_target_id is null or p_package_id is null or p_request_id is null or length(p_request_id) = 0 then
    raise exception 'INVALID_REQUEST';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_existing from public.promotions where owner_id = v_uid and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.target_type <> p_target_type or v_existing.target_id <> p_target_id or v_existing.package_id <> p_package_id then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('id', v_existing.id, 'replay', true, 'expiresAt', v_existing.expires_at);
  end if;

  if p_target_type = 'post' then
    select * into v_status from public.statuses where id = p_target_id;
    if v_status is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_status.author_id = v_uid);
    v_community_id := v_status.community_id;
    v_promoted := v_status.promoted;
    v_promoted_until := v_status.promoted_until;
  else
    select * into v_community from public.communities where id = p_target_id;
    if v_community is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_community.owner_id = v_uid);
    v_community_id := v_community.id;
    v_promoted := v_community.promoted;
    v_promoted_until := v_community.promoted_until;
  end if;

  if not coalesce(v_is_owner, false) then raise exception 'NOT_OWNER'; end if;

  if (select account_status from public.users where id = v_uid) = 'disabled' then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  if not exists (select 1 from public.community_members where community_id = v_community_id and user_id = v_uid) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;

  if p_target_type = 'post' then
    select * into v_community from public.communities where id = v_community_id;
  end if;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind = 'community' and target_id = v_community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  if v_promoted and v_promoted_until is not null and v_promoted_until > v_now then
    raise exception 'ALREADY_PROMOTED';
  end if;

  select config into v_config from public.economy_config where id;
  v_pkg := v_config->'promotionPackages'->p_package_id;
  v_cash_amount := (v_pkg->>'cashAmount')::numeric;
  v_duration_days := (v_pkg->>'durationDays')::integer;
  if v_pkg is null or (v_pkg->>'targetType') <> p_target_type
     or v_cash_amount is null or v_cash_amount <= 0 or v_cash_amount > 1000000
     or v_duration_days is null or v_duration_days <= 0 or v_duration_days > 90
     or coalesce((v_pkg->>'active')::boolean, false) <> true
  then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if coalesce(v_wallet.cash_balance, 0) < v_cash_amount then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  v_expires_at := v_now + (v_duration_days || ' days')::interval;
  v_new_id := gen_random_uuid();

  perform public._wallet_debit_cash(v_uid, v_cash_amount);
  perform public._ledger_record(v_uid, 'promote:' || v_new_id::text, 'cash', 'debit', v_cash_amount, 'promotion_purchase', 'promotion', v_new_id::text);

  insert into public.promotions (
    id, owner_id, request_id, target_type, target_id, community_id, package_id,
    cash_amount, duration_days, status, started_at, expires_at
  ) values (
    v_new_id, v_uid, p_request_id, p_target_type, p_target_id, v_community_id, p_package_id,
    v_cash_amount, v_duration_days, 'active', v_now, v_expires_at
  );

  if p_target_type = 'post' then
    update public.statuses set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  else
    update public.communities set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  end if;

  return jsonb_build_object('id', v_new_id, 'replay', false, 'expiresAt', v_expires_at);
end;
$$;

-- Equivalente a cancelPromotion — nunca reembolsa (o EvoCash já foi gasto atomicamente
-- na criação). Dono cancela sem motivo; superadmin precisa de motivo (>=5 chars).
create or replace function public.cancel_promotion(p_promotion_id uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_promo public.promotions;
  v_is_owner boolean;
  v_is_admin boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_promo from public.promotions where id = p_promotion_id for update;
  if v_promo is null then raise exception 'PROMOTION_NOT_FOUND'; end if;
  v_is_owner := (v_promo.owner_id = v_uid);
  v_is_admin := public.is_superadmin();
  if not (v_is_owner or v_is_admin) then raise exception 'PERMISSION_DENIED'; end if;
  if v_promo.status <> 'active' then raise exception 'PROMOTION_NOT_ACTIVE'; end if;
  if v_is_admin and not v_is_owner then
    if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;
  end if;
  if p_reason is not null and length(p_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;

  update public.promotions set status = 'cancelled', cancelled_at = now(), cancelled_by = v_uid, cancel_reason = p_reason
    where id = p_promotion_id;

  if v_promo.target_type = 'post' then
    update public.statuses set promoted = false, promoted_until = null, active_promotion_id = null
      where id = v_promo.target_id and active_promotion_id = p_promotion_id;
  else
    update public.communities set promoted = false, promoted_until = null, active_promotion_id = null
      where id = v_promo.target_id and active_promotion_id = p_promotion_id;
  end if;

  return jsonb_build_object('id', p_promotion_id, 'status', 'cancelled');
end;
$$;

-- Equivalente a recordPromotionEvent — só 'click' na v1 (impressão geraria volume de
-- writes a cada render/scroll, deliberadamente adiada). Métrica informativa, nunca afeta
-- preço/ranking. Clique repetido na janela de 10s devolve {recorded:false} silenciosamente
-- (não é erro do usuário).
create or replace function public.record_promotion_event(
  p_target_type text, p_target_id uuid, p_promotion_id uuid, p_type text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_promo public.promotions;
  v_now timestamptz := now();
  v_limit public.promotion_event_limits;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_type <> 'click' then raise exception 'INVALID_EVENT_TYPE'; end if;

  select * into v_promo from public.promotions where id = p_promotion_id;
  if v_promo is null or v_promo.target_type <> p_target_type or v_promo.target_id <> p_target_id then
    raise exception 'PROMOTION_MISMATCH';
  end if;
  if v_promo.status <> 'active' or v_promo.expires_at <= v_now then
    return jsonb_build_object('recorded', false, 'reason', 'not_active');
  end if;

  select * into v_limit from public.promotion_event_limits where user_id = v_uid and promotion_id = p_promotion_id for update;
  if v_limit is not null and v_limit.last_click_at > v_now - interval '10 seconds' then
    return jsonb_build_object('recorded', false);
  end if;

  update public.promotions set click_count = click_count + 1 where id = p_promotion_id;
  insert into public.promotion_event_limits (user_id, promotion_id, last_click_at, expire_at)
    values (v_uid, p_promotion_id, v_now, v_now + interval '24 hours')
  on conflict (user_id, promotion_id) do update set last_click_at = v_now, expire_at = v_now + interval '24 hours';

  return jsonb_build_object('recorded', true);
end;
$$;

-- Equivalente a markTargetRemoved — dispara nos mesmos triggers AFTER DELETE que já
-- existem para queue_deletion_on_delete (server_only.sql), fechando qualquer promoção
-- ativa do alvo como 'target_removed' (nunca apaga o histórico econômico).
create or replace function public.mark_promotions_target_removed() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  update public.promotions set status = 'target_removed', cancelled_at = now(), cancelled_by = null, cancel_reason = 'Alvo removido.'
    where target_id = old.id and status = 'active';
  return old;
end;
$$;

create trigger promotions_status_target_removed
  after delete on public.statuses
  for each row execute function public.mark_promotions_target_removed();

create trigger promotions_community_target_removed
  after delete on public.communities
  for each row execute function public.mark_promotions_target_removed();

-- Equivalente a purgeExpiredPromotionEventLimits (every 24h) — só limpa o throttle de
-- cliques, nunca a promoção em si (que nunca vira 'expired' sozinha; isso é sempre
-- derivado na leitura comparando expires_at com now()).
select cron.schedule('purge-promotion-event-limits', '0 3 * * *', $$delete from public.promotion_event_limits where expire_at < now()$$);
