-- Cancelamento de uma exclusão que já tinha caso financeiro (FIN-...): o caso é encerrado como
-- 'cancelled' (modelo atual) e agora também entra na retenção -- resolved_at já era preenchido, mas
-- retention_until ficava null para sempre (a constraint só aceitava 'resolved' e a lista de elegíveis
-- ignorava 'cancelled'). Regra: retention_until = resolved_at + 1 ano, igual a um caso resolvido.
-- Cancelamento ANTES de existir financial_case_id continua como antes: nenhum caso é criado.
-- Ledger, saldos, eventos e protocolo não são alterados nem apagados.

alter table public.account_financial_cases drop constraint account_financial_cases_retention_only_resolved;
alter table public.account_financial_cases add constraint account_financial_cases_retention_only_closed
  check (retention_until is null or status in ('resolved', 'cancelled'));

-- Backfill idempotente também para casos já cancelados (resolved_at já existe).
create or replace function public._backfill_financial_case_retention() returns integer
  language plpgsql as $$
declare
  v_count integer;
begin
  update public.account_financial_cases
    set retention_until = resolved_at + interval '1 year'
    where status in ('resolved', 'cancelled') and resolved_at is not null and retention_until is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke execute on function public._backfill_financial_case_retention() from public, anon, authenticated;
select public._backfill_financial_case_retention();

create or replace function public.cancel_account_deletion(p_job_id uuid, p_note text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_case public.account_financial_cases;
  v_note text;
  v_status text;
  v_held record;
  v_balance numeric;
  v_closed_at timestamptz := now();
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
    -- O caso é encerrado (status 'cancelled', conta mantida) e entra na MESMA retenção de um caso
    -- resolvido: resolved_at + 1 ano. Ledger/saldos/protocolo/eventos não são tocados.
    update public.account_financial_cases set status = 'cancelled', resolved_at = v_closed_at, resolved_by = auth.uid(),
      resolution_note = v_note, retention_until = v_closed_at + interval '1 year' where id = v_case.id;
    insert into public.account_financial_case_events (case_id, kind, admin_id, note)
    values (v_case.id, 'cancelled', auth.uid(), left('Caso encerrado por cancelamento da exclusão da conta: ' || v_note, 500));
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

-- Elegíveis a futuro descarte: casos encerrados (resolvidos OU cancelados), prazo vencido, sem hold.
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
      where status in ('resolved', 'cancelled') and retention_until is not null and retention_until <= now() and not retention_hold
      order by retention_until, id
      limit least(greatest(coalesce(p_limit, 100), 1), 500)
    ) d
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_list_financial_cases_retention_due(integer) from public, anon;
grant execute on function public.admin_list_financial_cases_retention_due(integer) to authenticated;
