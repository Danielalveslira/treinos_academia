-- Porta o painel "Exclusão de contas" (PR #55, mesclado ainda 100% Firebase) para
-- Supabase -- equivalente a listBlockedForReview/reviewFinancialBlock em
-- functions/deletion-service.js. O lado Postgres já tinha a base pronta desde a Fase 4
-- (deletion_jobs.block_reason, estado 'blocked_financial_review',
-- _reactivate_deletion_if_clear) -- só faltava listar e decidir.

-- Equivalente a deletionJobs/{jobId}/financialReviews (subcoleção). deletion_jobs não
-- tem policy nenhuma (server_only, ver 20260926000008) -- esta tabela segue o mesmo
-- padrão: só acessível via as duas RPCs abaixo (security definer).
create table public.deletion_financial_reviews (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.deletion_jobs(id) on delete cascade,
  admin_id uuid references public.users(id),
  note text check (note is null or char_length(note) <= 500),
  block_reason_at_check text,
  cash_balance_at_check numeric,
  pending_purchase_id_at_check uuid references public.cash_purchases(id),
  resulting_state text not null check (resulting_state in ('still_blocked', 'resumed')),
  resulting_block_reason text,
  checked_at timestamptz not null default now()
);
create index deletion_financial_reviews_job_idx on public.deletion_financial_reviews(job_id, checked_at desc);
alter table public.deletion_financial_reviews enable row level security;

-- Equivalente a listBlockedForReview. Só jobs de conta entram aqui -- é o único kind que
-- o portão financeiro avalia. cashBalance/pendingPurchaseId são lidos aqui (não deixados
-- para uma leitura separada do cliente) porque são exatamente os dois valores que a
-- revisão abaixo usa para decidir o bloqueio -- o admin vê os MESMOS dados que seriam
-- reavaliados.
create or replace function public.list_blocked_account_deletions() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_result jsonb;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', j.id,
    'targetId', j.target_id,
    'requestedBy', j.requested_by,
    'blockReason', j.block_reason,
    'createdAt', j.created_at,
    'updatedAt', j.updated_at,
    'cashBalance', coalesce(w.cash_balance, 0),
    'pendingPurchaseId', cp.id,
    'history', coalesce(h.history, '[]'::jsonb)
  ) order by j.updated_at asc), '[]'::jsonb)
  into v_result
  from (
    select * from public.deletion_jobs
    where kind = 'account' and state = 'blocked_financial_review'
    order by updated_at asc
    limit 50
  ) j
  left join public.wallets w on w.user_id = j.target_id
  left join lateral (
    select id from public.cash_purchases
    where user_id = j.target_id and status = 'pending'
    order by created_at desc
    limit 1
  ) cp on true
  left join lateral (
    select jsonb_agg(jsonb_build_object(
      'id', r.id,
      'adminId', r.admin_id,
      'note', r.note,
      'blockReasonAtCheck', r.block_reason_at_check,
      'cashBalanceAtCheck', r.cash_balance_at_check,
      'pendingPurchaseIdAtCheck', r.pending_purchase_id_at_check,
      'resultingState', r.resulting_state,
      'resultingBlockReason', r.resulting_block_reason,
      'checkedAt', r.checked_at
    ) order by r.checked_at desc) as history
    from (
      select * from public.deletion_financial_reviews
      where job_id = j.id
      order by checked_at desc
      limit 20
    ) r
  ) h on true;

  return v_result;
end;
$$;

-- Equivalente a reviewFinancialBlock -- NUNCA altera saldo/ledger, só reavalia
-- financialBlockReason com os valores REAIS e atuais e, se já não houver motivo de
-- bloqueio, retoma o job. Mesma lógica de _reactivate_deletion_if_clear, exposta como
-- ação avulsa (para quando a pendência foi resolvida por outro caminho, ou só para
-- registrar que um admin revisou e o bloqueio continua válido). Sempre grava a revisão,
-- bloqueado-ou-não -- é o histórico que o painel expõe.
--
-- Corridas: a checagem de state = 'blocked_financial_review' acontece com o job travado
-- (for update) na mesma transação que grava o resultado -- se
-- confirm_cash_purchase/cancel_cash_purchase já tiver destravado o job entre a leitura
-- da lista e esta chamada, a linha é vista já 'pending' e a função recusa com
-- NOT_BLOCKED, sem duplicar nem sobrescrever nada.
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
  if p_note is not null and length(p_note) > 500 then raise exception 'NOTE_TOO_LONG'; end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');

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
