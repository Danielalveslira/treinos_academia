-- Completa o fluxo de exclusão de contas com pendência financeira.
--
-- Problema: uma conta com saldo de EvoCash positivo (ou compra pendente) entrava em
-- deletion_jobs.state = 'blocked_financial_review' e NUNCA saía: a única ação admin era
-- "Revalidar bloqueio", que só reavalia -- e saldo positivo não some sozinho (não existe
-- estorno/perda de saldo, ver _compute_financial_block_reason).
--
-- Solução: o superadmin pode decidir "excluir a conta e manter a pendência financeira
-- separada". Isso NÃO zera EvoCash, NÃO apaga ledger, NÃO declara saldo quitado e NÃO
-- converte EvoCash em dinheiro -- só (1) grava um CASO FINANCEIRO auditável e independente
-- da conta (account_financial_cases), (2) aponta o ledger/compras do usuário para esse
-- caso (coluna financial_case_id) e (3) libera o job para o worker normal concluir a
-- exclusão. O saldo do usuário fica registrado no caso (snapshot + valor final na hora
-- da exclusão); a linha da carteira some junto com a conta (cascade de users) exatamente
-- como antes -- o que sobrevive é o caso + ledger + compras, não a carteira.
--
-- Estados de deletion_jobs (apenas para kind = 'account' há revisão financeira):
--   pending                  -- enfileirado; o worker (cron, 1/min) pega e avalia o portão
--   blocked_financial_review -- portão achou saldo positivo / compra pendente; aguarda admin
--   cancelled                -- NOVO: admin cancelou enquanto ainda reversível; conta reativada
--   complete                 -- conta apagada (irreversível)
-- "Pendência separada" NÃO é um estado novo: é pending + financial_case_id preenchido
-- (um estado próprio duraria < 1 minuto e seria redundante). 'processing' não existe
-- porque run_deletion_job apaga a conta inteira numa única transação -- nunca há estado
-- intermediário visível. 'failed' também não: o worker só retenta (last_error), e o
-- bloqueio financeiro já é o único motivo de um job ficar parado de forma indefinida.

-- ============================================================================
-- Caso financeiro
-- ============================================================================

create sequence public.financial_case_protocol_seq;
create sequence public.deletion_job_protocol_seq;

-- Retenção mínima: o caso guarda SOMENTE o uuid do usuário original (sem FK -- precisa
-- sobreviver à exclusão), valores em EvoCash e referências a compras/ledger. Nenhum
-- nome, e-mail, telefone ou perfil é copiado: quem precisa ser contatado é localizado
-- pelo protocolo (mostrado ao usuário na tela de exclusão e no atendimento) e, para o
-- dinheiro real, pelo mp_payment_id das compras vinculadas (o dado do pagador já está no
-- Mercado Pago). retain_until só é preenchido quando o caso é resolvido.
create table public.account_financial_cases (
  id uuid primary key default gen_random_uuid(),
  protocol text not null unique
    default 'FIN-' || lpad(nextval('public.financial_case_protocol_seq')::text, 6, '0'),
  original_user_id uuid not null,
  deletion_job_id uuid not null references public.deletion_jobs(id),
  status text not null default 'open' check (status in ('open', 'resolved', 'cancelled')),
  block_reason text not null,
  decision_note text not null check (char_length(decision_note) between 5 and 500),
  cash_balance_snapshot integer not null check (cash_balance_snapshot >= 0),
  pending_purchases_snapshot integer not null default 0 check (pending_purchases_snapshot >= 0),
  pending_purchase_ids uuid[] not null default '{}',
  ledger_entries_snapshot integer not null default 0 check (ledger_entries_snapshot >= 0),
  -- Preenchidos pelo worker no momento exato da exclusão (saldo que a carteira tinha ao
  -- ser apagada pelo cascade) -- trilha de que nada mexeu no saldo entre decisão e exclusão.
  cash_balance_final integer,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500),
  -- resolved_at + 5 anos (prazo usual de guarda de registros financeiros/consumidor no
  -- Brasil) -- valor a CONFIRMAR com o jurídico; nenhum job apaga casos hoje.
  retain_until timestamptz
);
-- Um job só pode ter um caso aberto (idempotência de retry/duplo clique). Um job cancelado
-- e reenfileirado depois pode gerar um segundo caso -- por isso parcial, não único puro.
create unique index account_financial_cases_open_per_job_idx
  on public.account_financial_cases(deletion_job_id) where status = 'open';
create unique index account_financial_cases_open_per_user_idx
  on public.account_financial_cases(original_user_id) where status = 'open';
create index account_financial_cases_user_idx on public.account_financial_cases(original_user_id);
alter table public.account_financial_cases enable row level security;
-- Sem policy nenhuma (mesmo padrão server_only de deletion_jobs): só RPCs security definer.

create table public.account_financial_case_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.account_financial_cases(id),
  kind text not null check (kind in (
    'separated', 'late_payment_held', 'purchase_cancelled', 'held_payment_restored', 'resolved', 'cancelled'
  )),
  admin_id uuid references public.users(id) on delete set null,
  note text check (note is null or char_length(note) <= 500),
  cash_amount numeric,
  purchase_id uuid references public.cash_purchases(id),
  mp_payment_id bigint,
  created_at timestamptz not null default now()
);
create index account_financial_case_events_case_idx on public.account_financial_case_events(case_id, created_at);
alter table public.account_financial_case_events enable row level security;

-- Caso/eventos são append-only: nunca apagados (nem pelo worker, nem por cascade).
create or replace function public._forbid_financial_case_delete() returns trigger
  language plpgsql as $$
begin
  raise exception 'FINANCIAL_CASE_IMMUTABLE';
end;
$$;
create trigger account_financial_cases_no_delete before delete on public.account_financial_cases
  for each row execute function public._forbid_financial_case_delete();
create trigger account_financial_case_events_no_delete before delete on public.account_financial_case_events
  for each row execute function public._forbid_financial_case_delete();

-- Referências do ledger/compras ao caso: sobrevivem à exclusão (user_id vira null, o caso
-- continua apontando). NÃO altera nenhum valor/movimentação -- só uma coluna nova.
alter table public.economy_transactions add column financial_case_id uuid references public.account_financial_cases(id);
alter table public.cash_purchases add column financial_case_id uuid references public.account_financial_cases(id);
create index economy_transactions_financial_case_idx on public.economy_transactions(financial_case_id)
  where financial_case_id is not null;
create index cash_purchases_financial_case_idx on public.cash_purchases(financial_case_id)
  where financial_case_id is not null;

-- Pagamento recebido DEPOIS da separação (PIX pendente pago tarde) fica retido no caso,
-- nunca creditado numa carteira (a conta está sendo excluída).
alter table public.cash_purchases drop constraint cash_purchases_status_check;
alter table public.cash_purchases add constraint cash_purchases_status_check
  check (status in ('pending', 'credited', 'cancelled', 'held_in_case'));

-- ============================================================================
-- deletion_jobs: protocolo, estado cancelled, vínculo com o caso
-- ============================================================================

alter table public.deletion_jobs
  add column protocol text not null default 'EXC-' || lpad(nextval('public.deletion_job_protocol_seq')::text, 6, '0'),
  add column financial_case_id uuid references public.account_financial_cases(id),
  -- queue_deletion sobrescreve account_status com 'deleting'; sem guardar o anterior, cancelar
  -- reativaria uma conta que já estava desativada por moderação.
  add column previous_account_status text;
create unique index deletion_jobs_protocol_idx on public.deletion_jobs(protocol);

alter table public.deletion_jobs drop constraint deletion_jobs_state_check;
alter table public.deletion_jobs add constraint deletion_jobs_state_check
  check (state in ('pending', 'complete', 'blocked_financial_review', 'cancelled'));

alter table public.deletion_financial_reviews drop constraint deletion_financial_reviews_resulting_state_check;
alter table public.deletion_financial_reviews add constraint deletion_financial_reviews_resulting_state_check
  check (resulting_state in ('still_blocked', 'resumed', 'case_separated', 'cancelled'));

-- ============================================================================
-- Pagamentos durante a exclusão
-- ============================================================================

-- Defesa em profundidade: toda RPC de gasto já recusa conta 'deleting', mas o débito em si
-- passa a recusar também -- nenhum caminho novo gasta EvoCash de conta em exclusão.
create or replace function public._wallet_debit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
declare
  v_next numeric;
begin
  if exists (select 1 from public.users where id = p_user_id and account_status = 'deleting') then
    raise exception 'ACCOUNT_DELETING';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance - p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 then
    raise exception 'Saldo de EvoCash insuficiente.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;

-- Nunca (re)cria carteira: crédito para um usuário que não existe mais falha explicitamente
-- aqui, em vez de depender do erro de FK de _wallet_ensure_row.
create or replace function public._wallet_credit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql as $$
declare
  v_next numeric;
begin
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance + p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 or v_next > 9007199254740991 then
    raise exception 'Saldo de EvoCash inválido após o crédito.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;

-- Marca a compra como recebida-e-retida no caso financeiro. Não toca carteira nem ledger.
create or replace function public._hold_purchase_in_case(
  p_purchase public.cash_purchases, p_admin_id uuid, p_mp_status text, p_note text
) returns void
  language plpgsql as $$
begin
  update public.cash_purchases set status = 'held_in_case',
    mp_status = coalesce(p_mp_status, mp_status),
    confirmation_note = coalesce(p_note, confirmation_note)
    where id = p_purchase.id;
  insert into public.account_financial_case_events (
    case_id, kind, admin_id, note, cash_amount, purchase_id, mp_payment_id
  ) values (
    p_purchase.financial_case_id, 'late_payment_held', p_admin_id, p_note,
    p_purchase.cash_amount, p_purchase.id, p_purchase.mp_payment_id
  );
end;
$$;
revoke execute on function public._hold_purchase_in_case(public.cash_purchases, uuid, text, text) from public, anon, authenticated;

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

  if v_purchase.cash_amount is null or v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000
     or v_purchase.amount_centavos is null or v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000
  then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;

  -- Conta com pendência financeira separada (em exclusão ou já excluída): o valor vai para
  -- o CASO, nunca para uma carteira -- não reativa nem recria a conta.
  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, null, p_mp_status, null);
    return jsonb_build_object('credited', false, 'reason', 'held_in_financial_case');
  end if;
  -- Compra sem dono e sem caso (só possível em exclusões anteriores a este fluxo): não há
  -- carteira para creditar. Mantida pendente, rastreável por mp_payment_id; nunca falha o
  -- webhook (um 5xx faria o Mercado Pago reentregar indefinidamente).
  if v_purchase.user_id is null then
    return jsonb_build_object('credited', false, 'reason', 'account_deleted_without_case');
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

  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, auth.uid(), null, p_admin_note);
    return jsonb_build_object('id', p_purchase_id, 'status', 'held_in_case');
  end if;
  if v_purchase.user_id is null then raise exception 'PURCHASE_ACCOUNT_DELETED'; end if;

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

  if v_purchase.financial_case_id is not null then
    insert into public.account_financial_case_events (case_id, kind, admin_id, note, cash_amount, purchase_id, mp_payment_id)
    values (v_purchase.financial_case_id, 'purchase_cancelled', auth.uid(), p_reason, v_purchase.cash_amount, v_purchase.id, v_purchase.mp_payment_id);
  end if;

  perform public._reactivate_deletion_if_clear(v_purchase.user_id);

  return jsonb_build_object('id', p_purchase_id, 'status', 'cancelled');
end;
$$;

-- ============================================================================
-- queue_deletion: guarda o status anterior e permite reenfileirar um job cancelado
-- ============================================================================

create or replace function public.queue_deletion(p_kind text, p_target_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
  v_previous_status text;
  v_existing public.deletion_jobs;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_kind not in ('account', 'community', 'status') then
    raise exception 'INVALID_KIND';
  end if;
  if p_kind = 'account' and p_target_id = v_admin_id then
    raise exception 'CANNOT_DELETE_SELF';
  end if;

  select * into v_existing from public.deletion_jobs where kind = p_kind and target_id = p_target_id for update;
  if v_existing.id is not null and v_existing.state <> 'cancelled' then
    return;
  end if;

  if p_kind = 'account' then
    select role, account_status into v_target_role, v_previous_status from public.users where id = p_target_id;
    if v_target_role is null then
      raise exception 'NOT_FOUND';
    end if;
    if v_target_role = 'superadmin' then
      raise exception 'CANNOT_DELETE_ADMIN';
    end if;
    if exists (select 1 from public.communities where owner_id = p_target_id and is_active) then
      raise exception 'OWNS_ACTIVE_COMMUNITY';
    end if;
    update public.users set account_status = 'deleting' where id = p_target_id;
  elsif p_kind = 'community' then
    if not exists (select 1 from public.communities where id = p_target_id) then
      raise exception 'NOT_FOUND';
    end if;
    update public.communities set is_active = false, deletion_status = 'pending' where id = p_target_id;
  end if;

  if v_existing.id is not null then
    -- Reenfileira o job cancelado (unique kind+target): nova solicitação, novo protocolo.
    update public.deletion_jobs set
      state = 'pending', stage = 0, block_reason = null, financial_case_id = null, last_error = null,
      requested_by = v_admin_id, previous_account_status = v_previous_status,
      protocol = 'EXC-' || lpad(nextval('public.deletion_job_protocol_seq')::text, 6, '0'),
      created_at = now(), updated_at = now()
      where id = v_existing.id;
  else
    insert into public.deletion_jobs (kind, target_id, requested_by, state, stage, previous_account_status)
    values (p_kind, p_target_id, v_admin_id, 'pending', 0, v_previous_status);
  end if;
end;
$$;

-- ============================================================================
-- Usuário: estado da própria exclusão (sem nenhum dado financeiro privado)
-- ============================================================================

create or replace function public.get_my_deletion_status() returns text
  language sql stable security definer set search_path = public as $$
    select state from public.deletion_jobs
    where kind = 'account' and target_id = auth.uid() and state not in ('complete', 'cancelled')
    limit 1
$$;

-- Só estado, protocolos e se a pendência foi separada -- nunca saldo, motivo do bloqueio ou
-- valores. Devolve null quando não há exclusão em andamento.
create or replace function public.get_my_deletion_review() returns jsonb
  language sql stable security definer set search_path = public as $$
    select jsonb_build_object(
      'state', j.state,
      'protocol', j.protocol,
      'requestedAt', j.created_at,
      'updatedAt', j.updated_at,
      'financialCaseSeparated', j.financial_case_id is not null,
      'financialCaseProtocol', c.protocol
    )
    from public.deletion_jobs j
    left join public.account_financial_cases c on c.id = j.financial_case_id
    where j.kind = 'account' and j.target_id = auth.uid() and j.state not in ('complete', 'cancelled')
    limit 1
$$;
revoke execute on function public.get_my_deletion_review() from public, anon;
grant execute on function public.get_my_deletion_review() to authenticated;

-- ============================================================================
-- Worker: o portão financeiro só vale se NÃO há caso separado; com caso, só amarra as
-- referências (ledger/compras) ao caso e registra o saldo final ANTES de apagar.
-- ============================================================================

create or replace function public.run_deletion_job(p_job_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_reason text;
  v_photo_paths text[] := '{}';
  v_case public.account_financial_cases;
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null or v_job.state <> 'pending' then
    return jsonb_build_object('skipped', true);
  end if;

  if v_job.kind = 'account' then
    if v_job.financial_case_id is null then
      -- Portão financeiro: só antes da primeira etapa destrutiva. Nunca reavaliado depois.
      v_reason := public._compute_financial_block_reason(v_job.target_id);
      if v_reason is not null then
        update public.deletion_jobs set state = 'blocked_financial_review', block_reason = v_reason,
          updated_at = now() where id = p_job_id;
        return jsonb_build_object('blocked', true, 'reason', v_reason);
      end if;
    else
      -- Pendência já separada por decisão de superadmin: o caso é a fonte da verdade.
      select * into v_case from public.account_financial_cases where id = v_job.financial_case_id for update;
      if v_case.status <> 'open' then
        raise exception 'FINANCIAL_CASE_NOT_OPEN';
      end if;
      -- Amarra tudo que o usuário ainda tem (inclusive lançamentos/compras criados depois da
      -- decisão) ao caso ANTES de user_id virar null abaixo -- senão a referência se perderia.
      update public.economy_transactions set financial_case_id = v_case.id
        where user_id = v_job.target_id and financial_case_id is null;
      update public.cash_purchases set financial_case_id = v_case.id
        where user_id = v_job.target_id and financial_case_id is null;
      update public.account_financial_cases set
        cash_balance_final = coalesce((select cash_balance from public.wallets where user_id = v_job.target_id), 0),
        finalized_at = now()
        where id = v_case.id;
    end if;

    select coalesce(array_agg(photo_path), '{}') into v_photo_paths
      from public.statuses where author_id = v_job.target_id and photo_path is not null;
    delete from public.statuses where author_id = v_job.target_id;

    update public.economy_transactions set user_id = null where user_id = v_job.target_id;
    update public.support_requests set user_id = null where user_id = v_job.target_id;
    update public.moderation_decisions set target_user_id = null where target_user_id = v_job.target_id;
    update public.cash_purchases set user_id = null where user_id = v_job.target_id;
    update public.cash_purchases set credited_by = null where credited_by = v_job.target_id;
    update public.cash_purchases set cancelled_by = null where cancelled_by = v_job.target_id;
    update public.promotions set owner_id = null where owner_id = v_job.target_id;
    update public.promotions set cancelled_by = null where cancelled_by = v_job.target_id;
    update public.users set disabled_by = null where disabled_by = v_job.target_id;
    update public.deletion_jobs set requested_by = null where requested_by = v_job.target_id;
    update public.community_restrictions set banned_by = null where banned_by = v_job.target_id;
    update public.professional_listings set suspended_by = null where suspended_by = v_job.target_id;
    update public.deletion_financial_reviews set admin_id = null where admin_id = v_job.target_id;

    delete from public.promotion_event_limits where user_id = v_job.target_id;
    delete from public.community_creation_requests where user_id = v_job.target_id;

    delete from public.users where id = v_job.target_id;

  elsif v_job.kind = 'community' then
    select coalesce(array_agg(photo_path), '{}') into v_photo_paths
      from public.statuses where community_id = v_job.target_id and photo_path is not null;
    delete from public.statuses where community_id = v_job.target_id;
    delete from public.communities where id = v_job.target_id;

  else -- status
    select photo_path into v_photo_paths from public.statuses where id = v_job.target_id;
    v_photo_paths := case when v_photo_paths[1] is not null then v_photo_paths else '{}' end;
    delete from public.statuses where id = v_job.target_id;
  end if;

  update public.deletion_jobs set state = 'complete', updated_at = now(),
    expire_at = case when v_job.kind <> 'account' then now() + interval '7 days' else null end
    where id = p_job_id;

  return jsonb_build_object(
    'complete', true, 'kind', v_job.kind, 'targetId', v_job.target_id,
    'photoPaths', to_jsonb(v_photo_paths), 'deleteAuthUser', v_job.kind = 'account'
  );
exception when others then
  update public.deletion_jobs set last_error = sqlerrm, updated_at = now() where id = p_job_id;
  raise;
end;
$$;
revoke execute on function public.run_deletion_job(uuid) from public, anon, authenticated;

-- ============================================================================
-- Admin: ações (todas superadmin-only, nota obrigatória, nunca alteram saldo/ledger)
-- ============================================================================

-- Revalidar bloqueio: igual à versão anterior, mas a nota agora é obrigatória.
create or replace function public.review_blocked_account_deletion(p_job_id uuid, p_note text default null) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_note text;
  v_pending_purchase_id uuid;
  v_cash_balance numeric;
  v_reason text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.kind <> 'account' or v_job.state <> 'blocked_financial_review' then
    raise exception 'NOT_BLOCKED';
  end if;

  select id into v_pending_purchase_id from public.cash_purchases
    where user_id = v_job.target_id and status = 'pending'
    order by created_at desc limit 1;
  select cash_balance into v_cash_balance from public.wallets where user_id = v_job.target_id;

  v_reason := case
    when v_pending_purchase_id is not null then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance'
    else null
  end;

  insert into public.deletion_financial_reviews (
    job_id, admin_id, note, block_reason_at_check, cash_balance_at_check,
    pending_purchase_id_at_check, resulting_state, resulting_block_reason
  ) values (
    p_job_id, auth.uid(), v_note, v_job.block_reason, coalesce(v_cash_balance, 0),
    v_pending_purchase_id, case when v_reason is null then 'resumed' else 'still_blocked' end, v_reason
  );

  if v_reason is null then
    update public.deletion_jobs set state = 'pending', block_reason = null, updated_at = now()
      where id = p_job_id;
    return jsonb_build_object('resumed', true);
  end if;

  update public.deletion_jobs set block_reason = v_reason, updated_at = now()
    where id = p_job_id;
  return jsonb_build_object('resumed', false, 'blockReason', v_reason);
end;
$$;

-- Prosseguir com a exclusão mantendo a pendência financeira em um caso separado.
--
-- Ordem de locks: compras -> carteira -> job (a mesma do webhook de pagamento, que trava a
-- compra, depois a carteira, depois o job via _reactivate_deletion_if_clear). Com as
-- compras/carteira travadas, o saldo e as compras lidos aqui são os mesmos que o caso
-- registra: um pagamento tardio concorrente ou termina antes (e entra no snapshot) ou
-- espera e, ao reler a compra já vinculada ao caso, vira "retido no caso".
-- Idempotente: repetir a chamada (duplo clique, retry de rede) devolve o mesmo caso.
create or replace function public.separate_financial_case_and_resume_deletion(p_job_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_case public.account_financial_cases;
  v_note text;
  v_reason text;
  v_balance integer;
  v_pending_ids uuid[];
  v_ledger_count integer;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_job from public.deletion_jobs where id = p_job_id;
  if v_job.id is null then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.kind <> 'account' then raise exception 'NOT_BLOCKED'; end if;

  perform 1 from public.cash_purchases where user_id = v_job.target_id for update;
  perform 1 from public.wallets where user_id = v_job.target_id for update;
  select * into v_job from public.deletion_jobs where id = p_job_id for update;

  if v_job.state = 'cancelled' then raise exception 'DELETION_CANCELLED'; end if;
  if v_job.financial_case_id is not null then
    select * into v_case from public.account_financial_cases where id = v_job.financial_case_id;
    return jsonb_build_object(
      'caseId', v_case.id, 'protocol', v_case.protocol, 'cashBalanceSnapshot', v_case.cash_balance_snapshot,
      'replay', true
    );
  end if;
  if v_job.state <> 'blocked_financial_review' then raise exception 'NOT_BLOCKED'; end if;

  v_reason := public._compute_financial_block_reason(v_job.target_id);
  if v_reason is null then raise exception 'NO_FINANCIAL_PENDING'; end if;

  select coalesce(cash_balance, 0) into v_balance from public.wallets where user_id = v_job.target_id;
  v_balance := coalesce(v_balance, 0);
  select coalesce(array_agg(id order by created_at), '{}') into v_pending_ids
    from public.cash_purchases where user_id = v_job.target_id and status = 'pending';
  select count(*) into v_ledger_count from public.economy_transactions where user_id = v_job.target_id;

  insert into public.account_financial_cases (
    original_user_id, deletion_job_id, block_reason, decision_note, cash_balance_snapshot,
    pending_purchases_snapshot, pending_purchase_ids, ledger_entries_snapshot, created_by
  ) values (
    v_job.target_id, v_job.id, v_reason, v_note, v_balance,
    coalesce(array_length(v_pending_ids, 1), 0), v_pending_ids, v_ledger_count, auth.uid()
  ) returning * into v_case;

  -- Só referências: saldo, ledger e compras mantêm TODOS os valores.
  update public.economy_transactions set financial_case_id = v_case.id where user_id = v_job.target_id;
  update public.cash_purchases set financial_case_id = v_case.id where user_id = v_job.target_id;

  insert into public.account_financial_case_events (case_id, kind, admin_id, note, cash_amount)
  values (v_case.id, 'separated', auth.uid(), v_note, v_balance);

  insert into public.deletion_financial_reviews (
    job_id, admin_id, note, block_reason_at_check, cash_balance_at_check,
    pending_purchase_id_at_check, resulting_state, resulting_block_reason
  ) values (
    v_job.id, auth.uid(), v_note, v_job.block_reason, v_balance, v_pending_ids[1], 'case_separated', v_reason
  );

  update public.deletion_jobs set state = 'pending', block_reason = null, financial_case_id = v_case.id,
    updated_at = now() where id = v_job.id;

  return jsonb_build_object(
    'caseId', v_case.id, 'protocol', v_case.protocol, 'cashBalanceSnapshot', v_balance, 'replay', false
  );
end;
$$;
revoke execute on function public.separate_financial_case_and_resume_deletion(uuid, text) from public, anon;
grant execute on function public.separate_financial_case_and_resume_deletion(uuid, text) to authenticated;

-- Cancelar a solicitação e reativar a conta -- só enquanto reversível (job ainda
-- pending/blocked: a conta ainda existe). Depois de 'complete' não há o que reativar.
-- Trava o job primeiro e só depois o resto, mesma ordem do worker: o worker segura o lock do
-- job até apagar a conta, então cancelar e excluir nunca se atropelam -- ou o cancelamento
-- vence (worker vê state 'cancelled' e pula) ou a exclusão vence (aqui: NOT_CANCELLABLE).
create or replace function public.cancel_account_deletion(p_job_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_case public.account_financial_cases;
  v_note text;
  v_status text;
  v_held record;
  v_balance numeric;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.kind <> 'account' then raise exception 'NOT_CANCELLABLE'; end if;
  if v_job.state = 'cancelled' then
    return jsonb_build_object('cancelled', true, 'replay', true);
  end if;
  if v_job.state not in ('pending', 'blocked_financial_review') then raise exception 'NOT_CANCELLABLE'; end if;

  select cash_balance into v_balance from public.wallets where user_id = v_job.target_id;

  if v_job.financial_case_id is not null then
    select * into v_case from public.account_financial_cases where id = v_job.financial_case_id for update;
    -- Pagamentos que chegaram depois da separação estão retidos no caso; como a conta fica,
    -- passam a ser creditados na carteira (com ledger), exatamente como o webhook faria.
    for v_held in
      select * from public.cash_purchases where financial_case_id = v_case.id and status = 'held_in_case' for update
    loop
      perform public._wallet_credit_cash(v_job.target_id, v_held.cash_amount);
      perform public._ledger_record(v_job.target_id, 'cash-purchase:' || v_held.id::text, 'cash', 'credit',
        v_held.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_held.id::text);
      update public.cash_purchases set status = 'credited', credited_at = now() where id = v_held.id;
      insert into public.account_financial_case_events (case_id, kind, admin_id, note, cash_amount, purchase_id, mp_payment_id)
      values (v_case.id, 'held_payment_restored', auth.uid(), v_note, v_held.cash_amount, v_held.id, v_held.mp_payment_id);
    end loop;

    update public.cash_purchases set financial_case_id = null where financial_case_id = v_case.id;
    update public.economy_transactions set financial_case_id = null where financial_case_id = v_case.id;
    update public.account_financial_cases set status = 'cancelled', resolved_at = now(), resolved_by = auth.uid(),
      resolution_note = v_note where id = v_case.id;
    insert into public.account_financial_case_events (case_id, kind, admin_id, note)
    values (v_case.id, 'cancelled', auth.uid(), v_note);
  end if;

  -- Nunca promove uma conta antes desativada por moderação a 'active'.
  select account_status into v_status from public.users where id = v_job.target_id;
  if v_status = 'deleting' then
    update public.users set account_status = case
      when v_job.previous_account_status in ('active', 'disabled') then v_job.previous_account_status
      when disabled_reason is not null then 'disabled'
      else 'active'
    end where id = v_job.target_id;
  end if;

  insert into public.deletion_financial_reviews (
    job_id, admin_id, note, block_reason_at_check, cash_balance_at_check, resulting_state
  ) values (v_job.id, auth.uid(), v_note, v_job.block_reason, coalesce(v_balance, 0), 'cancelled');

  update public.deletion_jobs set state = 'cancelled', block_reason = null, updated_at = now() where id = v_job.id;

  return jsonb_build_object('cancelled', true, 'replay', false);
end;
$$;
revoke execute on function public.cancel_account_deletion(uuid, text) from public, anon;
grant execute on function public.cancel_account_deletion(uuid, text) to authenticated;

-- Encerra um caso financeiro (depois de tratado fora do sistema: estorno, acordo etc.).
-- Não mexe em saldo/ledger: só registra a decisão e inicia a contagem de retenção.
create or replace function public.resolve_account_financial_case(p_case_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_case public.account_financial_cases;
  v_job_state text;
  v_note text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_case from public.account_financial_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.status = 'resolved' then return jsonb_build_object('resolved', true, 'replay', true); end if;
  if v_case.status <> 'open' then raise exception 'CASE_NOT_OPEN'; end if;
  select state into v_job_state from public.deletion_jobs where id = v_case.deletion_job_id;
  if v_job_state <> 'complete' then raise exception 'DELETION_NOT_COMPLETE'; end if;

  update public.account_financial_cases set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
    resolution_note = v_note, retain_until = now() + interval '5 years' where id = p_case_id;
  insert into public.account_financial_case_events (case_id, kind, admin_id, note)
  values (p_case_id, 'resolved', auth.uid(), v_note);
  return jsonb_build_object('resolved', true, 'replay', false);
end;
$$;
revoke execute on function public.resolve_account_financial_case(uuid, text) from public, anon;
grant execute on function public.resolve_account_financial_case(uuid, text) to authenticated;

-- ============================================================================
-- Admin: leitura
-- ============================================================================

-- p_scope 'open' = pending + blocked; 'closed' = complete + cancelled dos últimos 60 dias.
create or replace function public.admin_list_account_deletions(p_scope text default 'open') returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_scope not in ('open', 'closed') then raise exception 'INVALID_SCOPE'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'protocol', j.protocol,
    'targetId', j.target_id,
    'username', u.username,
    'accountExists', u.id is not null,
    'requestedBy', j.requested_by,
    'state', j.state,
    'blockReason', j.block_reason,
    'createdAt', j.created_at,
    'updatedAt', j.updated_at,
    'cashBalance', coalesce(w.cash_balance, c.cash_balance_final, c.cash_balance_snapshot, 0),
    'pendingPurchases', coalesce(pp.items, '[]'::jsonb),
    'history', coalesce(h.items, '[]'::jsonb),
    'financialCase', case when c.id is null then null else jsonb_build_object(
      'id', c.id, 'protocol', c.protocol, 'status', c.status,
      'cashBalanceSnapshot', c.cash_balance_snapshot, 'cashBalanceFinal', c.cash_balance_final,
      'createdAt', c.created_at, 'heldPaymentsCount', coalesce(hp.n, 0), 'heldCashAmount', coalesce(hp.amount, 0)
    ) end,
    'canSeparate', j.state = 'blocked_financial_review' and j.financial_case_id is null,
    'canRevalidate', j.state = 'blocked_financial_review',
    'canCancel', j.state in ('pending', 'blocked_financial_review')
  ) order by j.updated_at asc), '[]'::jsonb)
  into v_result
  from (
    select * from public.deletion_jobs
    where kind = 'account'
      and ((p_scope = 'open' and state in ('pending', 'blocked_financial_review'))
        or (p_scope = 'closed' and state in ('complete', 'cancelled') and updated_at > now() - interval '60 days'))
    order by updated_at asc
    limit 50
  ) j
  left join public.users u on u.id = j.target_id
  left join public.wallets w on w.user_id = j.target_id
  left join public.account_financial_cases c on c.id = j.financial_case_id
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'cashAmount', p.cash_amount, 'amountCentavos', p.amount_centavos,
      'mpPaymentId', p.mp_payment_id, 'createdAt', p.created_at
    ) order by p.created_at desc) as items
    from public.cash_purchases p
    where p.status = 'pending' and (p.user_id = j.target_id or (c.id is not null and p.financial_case_id = c.id))
  ) pp on true
  left join lateral (
    select count(*) as n, coalesce(sum(p.cash_amount), 0) as amount
    from public.cash_purchases p where c.id is not null and p.financial_case_id = c.id and p.status = 'held_in_case'
  ) hp on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'adminId', r.admin_id, 'note', r.note,
      'blockReasonAtCheck', r.block_reason_at_check, 'cashBalanceAtCheck', r.cash_balance_at_check,
      'pendingPurchaseIdAtCheck', r.pending_purchase_id_at_check,
      'resultingState', r.resulting_state, 'resultingBlockReason', r.resulting_block_reason,
      'checkedAt', r.checked_at
    ) order by r.checked_at desc) as items
    from (
      select * from public.deletion_financial_reviews where job_id = j.id order by checked_at desc limit 20
    ) r
  ) h on true;

  return v_result;
end;
$$;
revoke execute on function public.admin_list_account_deletions(text) from public, anon;
grant execute on function public.admin_list_account_deletions(text) to authenticated;

-- Histórico financeiro de uma solicitação: carteira atual, ledger e compras do usuário (por
-- user_id enquanto a conta existe, por caso depois), e o caso com seus eventos.
create or replace function public.admin_get_deletion_financial_history(p_job_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_job from public.deletion_jobs where id = p_job_id and kind = 'account';
  if v_job.id is null then raise exception 'JOB_NOT_FOUND'; end if;

  return jsonb_build_object(
    'wallet', (select jsonb_build_object('cashBalance', w.cash_balance, 'coinBalance', w.coin_balance)
               from public.wallets w where w.user_id = v_job.target_id),
    'ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'asset', t.asset, 'direction', t.direction, 'amount', t.amount, 'reason', t.reason,
        'referenceType', t.reference_type, 'referenceId', t.reference_id, 'createdAt', t.created_at
      ) order by t.created_at desc)
      from (
        select * from public.economy_transactions
        where user_id = v_job.target_id or (v_job.financial_case_id is not null and financial_case_id = v_job.financial_case_id)
        order by created_at desc limit 100
      ) t
    ), '[]'::jsonb),
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'packageLabel', p.package_label, 'cashAmount', p.cash_amount, 'amountCentavos', p.amount_centavos,
        'status', p.status, 'mpPaymentId', p.mp_payment_id, 'createdAt', p.created_at
      ) order by p.created_at desc)
      from (
        select * from public.cash_purchases
        where user_id = v_job.target_id or (v_job.financial_case_id is not null and financial_case_id = v_job.financial_case_id)
        order by created_at desc limit 50
      ) p
    ), '[]'::jsonb),
    'case', (
      select jsonb_build_object(
        'id', c.id, 'protocol', c.protocol, 'status', c.status, 'blockReason', c.block_reason,
        'decisionNote', c.decision_note, 'cashBalanceSnapshot', c.cash_balance_snapshot,
        'cashBalanceFinal', c.cash_balance_final, 'pendingPurchasesSnapshot', c.pending_purchases_snapshot,
        'ledgerEntriesSnapshot', c.ledger_entries_snapshot, 'createdAt', c.created_at, 'createdBy', c.created_by,
        'resolvedAt', c.resolved_at, 'resolvedBy', c.resolved_by, 'resolutionNote', c.resolution_note,
        'retainUntil', c.retain_until,
        'events', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', e.id, 'kind', e.kind, 'adminId', e.admin_id, 'note', e.note, 'cashAmount', e.cash_amount,
            'purchaseId', e.purchase_id, 'mpPaymentId', e.mp_payment_id, 'createdAt', e.created_at
          ) order by e.created_at desc)
          from public.account_financial_case_events e where e.case_id = c.id
        ), '[]'::jsonb)
      )
      from public.account_financial_cases c where c.id = v_job.financial_case_id
    )
  );
end;
$$;
revoke execute on function public.admin_get_deletion_financial_history(uuid) from public, anon;
grant execute on function public.admin_get_deletion_financial_history(uuid) to authenticated;
