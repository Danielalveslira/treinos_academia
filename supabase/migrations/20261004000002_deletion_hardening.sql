-- Hardening final da exclusão de contas (3 pontos). Complementa
-- 20261004000001_account_deletion_financial_case.sql, ainda não publicada.
--
-- 1. last_error persistente: o handler antigo de run_deletion_job fazia UPDATE last_error e
--    depois RAISE -- o RAISE aborta a transação inteira, então o UPDATE nunca era gravado.
--    Agora o corpo roda num sub-bloco: se falhar, a sub-transação (todas as escritas do
--    corpo) é desfeita, last_error é gravado e a função RETORNA {error: true} normalmente,
--    deixando a transação externa commitar só o diagnóstico. O job continua 'pending' (será
--    retentado) e nada foi apagado pela metade.
--
-- 2. Auth com retry: o job de conta não vai mais direto a 'complete'. Depois que o banco é
--    limpo ele fica em 'auth_cleanup' (estado técnico) até a Edge Function CONFIRMAR a
--    remoção no Auth (confirm_auth_deletion). 'auth_cleanup' é reprocessado pelo mesmo cron;
--    reexecutar run_deletion_job nesse estado não toca em nenhuma tabela -- só devolve
--    "falta remover o Auth" -- então nada é recriado nem repetido (nem a exclusão
--    financeira). "Usuário já inexistente no Auth" conta como sucesso (tratado na Edge
--    Function). public.users/wallets nunca voltam: só são criados pelo trigger de INSERT em
--    auth.users, e um login não os recria.
--
-- 3. Retenção financeira: RETENÇÃO PENDENTE DE DEFINIÇÃO (jurídico/contábil). O prazo de 5
--    anos era uma suposição minha: coluna retain_until removida e nenhuma regra/purge
--    depende de prazo. Casos financeiros são preservados indefinidamente; nada apaga um
--    caso (trigger FINANCIAL_CASE_IMMUTABLE) e nenhum dado financeiro é alterado aqui.

alter table public.deletion_jobs drop constraint deletion_jobs_state_check;
alter table public.deletion_jobs add constraint deletion_jobs_state_check
  check (state in ('pending', 'complete', 'blocked_financial_review', 'cancelled', 'auth_cleanup'));

comment on table public.account_financial_cases is
  'Casos financeiros de contas excluídas com pendência. RETENÇÃO PENDENTE DE DEFINIÇÃO (jurídico/contábil): preservados indefinidamente, sem purge automático.';
alter table public.account_financial_cases drop column retain_until;


-- ============================================================================
-- run_deletion_job: last_error persistente + estado auth_cleanup
-- ============================================================================
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
revoke execute on function public.run_deletion_job(uuid) from public, anon, authenticated;

-- Chamada só pela Edge Function (service role) DEPOIS de o Auth confirmar a remoção (ou
-- informar que o usuário já não existe). Idempotente.
create or replace function public.confirm_auth_deletion(p_job_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.kind <> 'account' then raise exception 'JOB_NOT_FOUND'; end if;
  if v_job.state = 'complete' then return jsonb_build_object('confirmed', true, 'replay', true); end if;
  if v_job.state <> 'auth_cleanup' then raise exception 'NOT_AWAITING_AUTH_CLEANUP'; end if;
  update public.deletion_jobs set state = 'complete', last_error = null, updated_at = now() where id = p_job_id;
  return jsonb_build_object('confirmed', true, 'replay', false);
end;
$$;
revoke execute on function public.confirm_auth_deletion(uuid) from public, anon, authenticated;

-- Falha do Auth (ou de qualquer passo externo à transação): grava o diagnóstico sem mudar o
-- estado -- o job segue em auth_cleanup e é retentado no próximo ciclo.
create or replace function public.record_deletion_job_error(p_job_id uuid, p_error text) returns void
  language sql security definer set search_path = public as $$
  update public.deletion_jobs set last_error = left(coalesce(p_error, 'unknown error'), 500), updated_at = now()
    where id = p_job_id and state in ('pending', 'auth_cleanup')
$$;
revoke execute on function public.record_deletion_job_error(uuid, text) from public, anon, authenticated;

create or replace function public.list_pending_deletion_jobs() returns setof public.deletion_jobs
  language sql stable security definer set search_path = public as $$
  select * from public.deletion_jobs where state in ('pending', 'auth_cleanup') order by updated_at asc limit 10
$$;
revoke execute on function public.list_pending_deletion_jobs() from public, anon, authenticated;

-- O titular não vê mais nada depois que o banco foi limpo (a conta já não existe).
create or replace function public.get_my_deletion_status() returns text
  language sql stable security definer set search_path = public as $$
    select state from public.deletion_jobs
    where kind = 'account' and target_id = auth.uid() and state not in ('complete', 'cancelled', 'auth_cleanup')
    limit 1
$$;

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
    where j.kind = 'account' and j.target_id = auth.uid()
      and j.state not in ('complete', 'cancelled', 'auth_cleanup')
    limit 1
$$;

-- ============================================================================
-- Admin: auth_cleanup aparece em "em andamento"; retenção sem prazo fixo
-- ============================================================================
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
      and ((p_scope = 'open' and state in ('pending', 'blocked_financial_review', 'auth_cleanup'))
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
    resolution_note = v_note where id = p_case_id;
  insert into public.account_financial_case_events (case_id, kind, admin_id, note)
  values (p_case_id, 'resolved', auth.uid(), v_note);
  return jsonb_build_object('resolved', true, 'replay', false);
end;
$$;

revoke execute on function public.admin_list_account_deletions(text) from public, anon;
grant execute on function public.admin_list_account_deletions(text) to authenticated;
revoke execute on function public.admin_get_deletion_financial_history(uuid) from public, anon;
grant execute on function public.admin_get_deletion_financial_history(uuid) to authenticated;
revoke execute on function public.resolve_account_financial_case(uuid, text) from public, anon;
grant execute on function public.resolve_account_financial_case(uuid, text) to authenticated;
