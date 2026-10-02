-- Rastreabilidade após cancelar uma exclusão que já tinha caso FIN-...
--
-- Achado: cancel_account_deletion zera financial_case_id em economy_transactions e cash_purchases
-- (necessário: uma compra ainda ligada ao caso seria tratada como 'held_in_case' pelo webhook). Depois
-- disso o admin continuava vendo ledger/compras/eventos/motivo, mas NÃO conseguia mais saber QUAIS
-- linhas pertenciam ao FIN -- o caso só guardava uma contagem (ledger_entries_snapshot) e os ids das
-- compras pendentes (pending_purchase_ids).
--
-- Correção mínima: account_financial_case_items, vínculo HISTÓRICO e imutável (só ids, sem dado
-- pessoal) gravado quando o caso é criado (e quando o worker amarra retardatários). NÃO tem efeito
-- funcional: nem o webhook nem o worker leem esta tabela -- só financial_case_id decide "held_in_case".
-- O cancelamento segue zerando financial_case_id; os itens permanecem. Nada é apagado nem duplicado.

create table public.account_financial_case_items (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.account_financial_cases(id),
  ledger_id uuid references public.economy_transactions(id),
  purchase_id uuid references public.cash_purchases(id),
  linked_at timestamptz not null default now(),
  check ((ledger_id is null) <> (purchase_id is null))
);
create unique index account_financial_case_items_ledger_idx on public.account_financial_case_items(case_id, ledger_id) where ledger_id is not null;
create unique index account_financial_case_items_purchase_idx on public.account_financial_case_items(case_id, purchase_id) where purchase_id is not null;
create index account_financial_case_items_case_idx on public.account_financial_case_items(case_id);
alter table public.account_financial_case_items enable row level security;
-- Sem policy (server-only, como os demais): só RPCs security definer. Append-only como o caso.
create trigger account_financial_case_items_no_delete before delete on public.account_financial_case_items
  for each row execute function public._forbid_financial_case_delete();

-- Backfill: casos que hoje ainda têm linhas vinculadas (abertos/resolvidos) ganham o vínculo histórico.
-- Casos já cancelados antes desta migration não são recuperáveis (o vínculo já tinha sido zerado) --
-- só restam a contagem e pending_purchase_ids do próprio caso. Idempotente.
create or replace function public._backfill_financial_case_items() returns integer
  language plpgsql as $$
declare
  v_ledger integer;
  v_purchases integer;
begin
  insert into public.account_financial_case_items (case_id, ledger_id)
    select financial_case_id, id from public.economy_transactions where financial_case_id is not null
    on conflict do nothing;
  get diagnostics v_ledger = row_count;
  insert into public.account_financial_case_items (case_id, purchase_id)
    select financial_case_id, id from public.cash_purchases where financial_case_id is not null
    on conflict do nothing;
  get diagnostics v_purchases = row_count;
  return v_ledger + v_purchases;
end;
$$;
revoke execute on function public._backfill_financial_case_items() from public, anon, authenticated;
select public._backfill_financial_case_items();

-- Separar: grava os itens históricos junto com o vínculo.
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
  -- Vínculo HISTÓRICO imutável (sobrevive ao cancelamento, que zera financial_case_id).
  insert into public.account_financial_case_items (case_id, ledger_id)
    select v_case.id, id from public.economy_transactions where user_id = v_job.target_id
    on conflict do nothing;
  insert into public.account_financial_case_items (case_id, purchase_id)
    select v_case.id, id from public.cash_purchases where user_id = v_job.target_id
    on conflict do nothing;

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

-- Worker: amarra também os retardatários e registra os itens.
create or replace function public.run_deletion_job(p_job_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_reason text;
  v_photo_paths text[] := '{}';
  v_case public.account_financial_cases;
  v_error text;
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null then
    return jsonb_build_object('skipped', true);
  end if;

  -- Banco já limpo, só falta confirmar a remoção no Auth: nenhuma tabela é tocada (nem a
  -- exclusão financeira nem nada é repetido) -- só reentrega à Edge Function o que falta.
  if v_job.kind = 'account' and v_job.state = 'auth_cleanup' then
    return jsonb_build_object(
      'authPending', true, 'retry', true, 'kind', 'account', 'targetId', v_job.target_id,
      'photoPaths', '[]'::jsonb, 'deleteAuthUser', true
    );
  end if;
  if v_job.state <> 'pending' then
    return jsonb_build_object('skipped', true);
  end if;

  begin
    if v_job.kind = 'account' then
      if v_job.financial_case_id is null then
        v_reason := public._compute_financial_block_reason(v_job.target_id);
        if v_reason is not null then
          update public.deletion_jobs set state = 'blocked_financial_review', block_reason = v_reason,
            updated_at = now() where id = p_job_id;
          return jsonb_build_object('blocked', true, 'reason', v_reason);
        end if;
      else
        select * into v_case from public.account_financial_cases where id = v_job.financial_case_id for update;
        if v_case.status <> 'open' then
          raise exception 'FINANCIAL_CASE_NOT_OPEN';
        end if;
        update public.economy_transactions set financial_case_id = v_case.id
          where user_id = v_job.target_id and financial_case_id is null;
        update public.cash_purchases set financial_case_id = v_case.id
          where user_id = v_job.target_id and financial_case_id is null;
        insert into public.account_financial_case_items (case_id, ledger_id)
          select v_case.id, id from public.economy_transactions where user_id = v_job.target_id
          on conflict do nothing;
        insert into public.account_financial_case_items (case_id, purchase_id)
          select v_case.id, id from public.cash_purchases where user_id = v_job.target_id
          on conflict do nothing;
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

    -- Conta: o banco está limpo, mas o job só vira 'complete' quando o Auth for confirmado.
    update public.deletion_jobs set
      state = case when v_job.kind = 'account' then 'auth_cleanup' else 'complete' end,
      last_error = null, updated_at = now(),
      expire_at = case when v_job.kind <> 'account' then now() + interval '7 days' else null end
      where id = p_job_id;

    return jsonb_build_object(
      'complete', v_job.kind <> 'account', 'authPending', v_job.kind = 'account',
      'kind', v_job.kind, 'targetId', v_job.target_id,
      'photoPaths', to_jsonb(v_photo_paths), 'deleteAuthUser', v_job.kind = 'account'
    );
  exception when others then
    -- A sub-transação acima (todas as escritas do corpo) já foi desfeita; só o diagnóstico
    -- é gravado, e a função retorna normalmente para a transação externa commitá-lo.
    v_error := left(sqlstate || ': ' || sqlerrm, 500);
    update public.deletion_jobs set last_error = v_error, updated_at = now() where id = p_job_id;
    return jsonb_build_object('error', true, 'message', v_error);
  end;
end;
$$;

-- Histórico: o caso lista os itens que lhe pertenceram, mesmo depois do cancelamento.
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
        'items', jsonb_build_object(
          'ledger', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', t.id, 'asset', t.asset, 'direction', t.direction, 'amount', t.amount, 'reason', t.reason,
              'referenceType', t.reference_type, 'referenceId', t.reference_id, 'createdAt', t.created_at
            ) order by t.created_at desc)
            from public.account_financial_case_items i
            join public.economy_transactions t on t.id = i.ledger_id
            where i.case_id = c.id
          ), '[]'::jsonb),
          'purchases', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', p.id, 'packageLabel', p.package_label, 'cashAmount', p.cash_amount,
              'amountCentavos', p.amount_centavos, 'status', p.status, 'mpPaymentId', p.mp_payment_id,
              'createdAt', p.created_at
            ) order by p.created_at desc)
            from public.account_financial_case_items i
            join public.cash_purchases p on p.id = i.purchase_id
            where i.case_id = c.id
          ), '[]'::jsonb)
        ),
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
revoke execute on function public.separate_financial_case_and_resume_deletion(uuid, text) from public, anon;
grant execute on function public.separate_financial_case_and_resume_deletion(uuid, text) to authenticated;
revoke execute on function public.run_deletion_job(uuid) from public, anon, authenticated;
revoke execute on function public.admin_get_deletion_financial_history(uuid) from public, anon;
grant execute on function public.admin_get_deletion_financial_history(uuid) to authenticated;
