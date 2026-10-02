-- Retenção financeira de casos (account_financial_cases) -- política definida:
--   * caso ABERTO: preservado enquanto pendente; retention_until = null (o prazo só começa na resolução);
--   * caso RESOLVIDO: preservado por 1 ano contado de resolved_at (retention_until = resolved_at + 1 ano);
--   * depois disso o caso fica ELEGÍVEL a futuro descarte/anonimização -- este migration NÃO apaga,
--     anonimiza nem agenda nada (nenhum cron de purge), e o trigger FINANCIAL_CASE_IMMUTABLE
--     continua proibindo qualquer DELETE;
--   * legal hold (retention_hold) mantém o caso além do prazo (obrigação legal/disputa); só superadmin
--     liga/desliga, sempre com motivo, e tudo é registrado em account_financial_case_events.
-- Casos cancelados (conta mantida; nunca foram pendência financeira de conta excluída) não ganham prazo.

alter table public.account_financial_cases
  add column retention_until timestamptz,
  add column retention_hold boolean not null default false,
  add column retention_hold_reason text check (retention_hold_reason is null or char_length(retention_hold_reason) <= 500);

-- Backfill seguro (idempotente): só preenche retention_until de casos resolvidos que ainda não têm
-- prazo. Não toca em saldo, ledger, compras, protocolo nem eventos. Mantida como função interna para
-- poder ser exercitada nos testes; roda uma vez aqui.
create or replace function public._backfill_financial_case_retention() returns integer
  language plpgsql as $$
declare
  v_count integer;
begin
  update public.account_financial_cases
    set retention_until = resolved_at + interval '1 year'
    where status = 'resolved' and resolved_at is not null and retention_until is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public._backfill_financial_case_retention() from public, anon, authenticated;
select public._backfill_financial_case_retention();

-- Invariantes: prazo só existe em caso resolvido (aberto = null); hold exige motivo.
alter table public.account_financial_cases
  add constraint account_financial_cases_retention_only_resolved
    check (retention_until is null or status = 'resolved'),
  add constraint account_financial_cases_hold_needs_reason
    check (not retention_hold or (retention_hold_reason is not null and char_length(trim(retention_hold_reason)) >= 5));

alter table public.account_financial_case_events drop constraint account_financial_case_events_kind_check;
alter table public.account_financial_case_events add constraint account_financial_case_events_kind_check
  check (kind in (
    'separated', 'late_payment_held', 'purchase_cancelled', 'held_payment_restored', 'resolved', 'cancelled',
    'retention_hold_set', 'retention_hold_released'
  ));

-- Resolver: resolved_at + retention_until = resolved_at + 1 ano. Idempotente (reexecução devolve
-- replay sem tocar em nada nem duplicar evento) e nunca encurta um prazo existente.
create or replace function public.resolve_account_financial_case(p_case_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_case public.account_financial_cases;
  v_job_state text;
  v_note text;
  v_resolved_at timestamptz := now();
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if v_note is null or length(v_note) < 5 then raise exception 'NOTE_REQUIRED'; end if;
  if length(v_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;

  select * into v_case from public.account_financial_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'CASE_NOT_FOUND'; end if;
  if v_case.status = 'resolved' then
    return jsonb_build_object('resolved', true, 'replay', true, 'retentionUntil', v_case.retention_until);
  end if;
  if v_case.status <> 'open' then raise exception 'CASE_NOT_OPEN'; end if;
  select state into v_job_state from public.deletion_jobs where id = v_case.deletion_job_id;
  if v_job_state <> 'complete' then raise exception 'DELETION_NOT_COMPLETE'; end if;

  update public.account_financial_cases set
    status = 'resolved', resolved_at = v_resolved_at, resolved_by = auth.uid(), resolution_note = v_note,
    retention_until = greatest(coalesce(retention_until, v_resolved_at + interval '1 year'), v_resolved_at + interval '1 year')
    where id = p_case_id;
  insert into public.account_financial_case_events (case_id, kind, admin_id, note)
  values (p_case_id, 'resolved', auth.uid(), v_note);
  return jsonb_build_object(
    'resolved', true, 'replay', false, 'retentionUntil', v_resolved_at + interval '1 year'
  );
end;
$$;
revoke execute on function public.resolve_account_financial_case(uuid, text) from public, anon;
grant execute on function public.resolve_account_financial_case(uuid, text) to authenticated;

-- Legal hold: preserva o caso além de retention_until. Só superadmin; motivo obrigatório ao ligar
-- E ao desligar (fica no evento); idempotente. NUNCA apaga ou altera dado financeiro -- só as três
-- colunas de retenção e um evento append-only.
create or replace function public.set_financial_case_retention_hold(p_case_id uuid, p_hold boolean, p_reason text)
  returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_case public.account_financial_cases;
  v_reason text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if p_hold is null then raise exception 'INVALID_HOLD'; end if;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');
  if v_reason is null or length(v_reason) < 5 then raise exception 'REASON_REQUIRED'; end if;
  if length(v_reason) > 500 then raise exception 'REASON_TOO_LONG'; end if;

  select * into v_case from public.account_financial_cases where id = p_case_id for update;
  if v_case.id is null then raise exception 'CASE_NOT_FOUND'; end if;

  if p_hold then
    if v_case.retention_hold and v_case.retention_hold_reason = v_reason then
      return jsonb_build_object('retentionHold', true, 'replay', true);
    end if;
    update public.account_financial_cases set retention_hold = true, retention_hold_reason = v_reason
      where id = p_case_id;
    insert into public.account_financial_case_events (case_id, kind, admin_id, note)
    values (p_case_id, 'retention_hold_set', auth.uid(), v_reason);
    return jsonb_build_object('retentionHold', true, 'replay', false);
  end if;

  if not v_case.retention_hold then
    return jsonb_build_object('retentionHold', false, 'replay', true);
  end if;
  update public.account_financial_cases set retention_hold = false, retention_hold_reason = null
    where id = p_case_id;
  insert into public.account_financial_case_events (case_id, kind, admin_id, note)
  values (p_case_id, 'retention_hold_released', auth.uid(), v_reason);
  return jsonb_build_object('retentionHold', false, 'replay', false);
end;
$$;
revoke execute on function public.set_financial_case_retention_hold(uuid, boolean, text) from public, anon;
grant execute on function public.set_financial_case_retention_hold(uuid, boolean, text) to authenticated;

-- Somente leitura, preparação para um FUTURO processo de descarte: casos resolvidos, com prazo
-- vencido e SEM hold. Não apaga, anonimiza nem modifica nada; só lista. Campos mínimos.
create or replace function public.admin_list_financial_cases_retention_due(p_limit integer default 100)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', d.id, 'protocol', d.protocol, 'resolvedAt', d.resolved_at, 'retentionUntil', d.retention_until,
      'cashBalanceSnapshot', d.cash_balance_snapshot, 'cashBalanceFinal', d.cash_balance_final
    ) order by d.retention_until, d.id)
    from (
      select * from public.account_financial_cases
      where status = 'resolved' and retention_until is not null and retention_until <= now() and not retention_hold
      order by retention_until, id
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_list_financial_cases_retention_due(integer) from public, anon;
grant execute on function public.admin_list_financial_cases_retention_due(integer) to authenticated;

-- Histórico financeiro: agora com a situação de retenção do caso.
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
        'retentionUntil', c.retention_until, 'retentionHold', c.retention_hold,
        'retentionHoldReason', c.retention_hold_reason,
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

comment on table public.account_financial_cases is
  'Casos financeiros de contas excluídas com pendência. Aberto: preservado enquanto pendente. Resolvido: retido por 1 ano a partir de resolved_at (retention_until); após isso elegível a FUTURO descarte/anonimização (sem purge automático). retention_hold mantém além do prazo.';
