-- Local cancellation releases the checkout slot. A previously issued link can
-- still be paid, so its verified payment must remain reconcilable.
alter table public.cash_purchases add column if not exists paid_after_cancel_at timestamptz;

-- Preserve the already recorded requests as completed local cancellations.
update public.cash_purchases set status = 'cancelled', cancelled_at = cancel_requested_at,
  cancelled_by = user_id, checkout_lease_until = null,
  checkout_uncertain = checkout_uncertain or checkout_url is null
where payment_provider = 'infinitepay' and status = 'pending' and cancel_requested_at is not null;

create or replace function public.cancel_my_cash_purchase(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null or v_purchase.user_id is distinct from auth.uid() then
    raise exception 'PURCHASE_NOT_FOUND';
  end if;
  if v_purchase.payment_provider <> 'infinitepay' then raise exception 'INVALID_PROVIDER'; end if;
  if v_purchase.status = 'cancelled' then
    return jsonb_build_object('id', v_purchase.id, 'status', 'cancelled', 'replay', true);
  end if;
  if v_purchase.status <> 'pending' then raise exception 'PURCHASE_NOT_CANCELLABLE'; end if;
  update public.cash_purchases set status = 'cancelled', cancelled_at = now(),
    cancelled_by = auth.uid(), checkout_lease_until = null,
    checkout_uncertain = checkout_uncertain or checkout_url is null
    where id = v_purchase.id;
  return jsonb_build_object('id', v_purchase.id, 'status', 'cancelled', 'replay', false);
end;
$$;
revoke all on function public.cancel_my_cash_purchase(uuid) from public, anon;
grant execute on function public.cancel_my_cash_purchase(uuid) to authenticated;

-- Older open clients still call this name. Give them the same immediate result.
create or replace function public.request_infinitepay_cash_purchase_cancellation(p_purchase_id uuid)
returns jsonb language sql security definer set search_path = public, pg_temp as $$
  select public.cancel_my_cash_purchase(p_purchase_id);
$$;
revoke all on function public.request_infinitepay_cash_purchase_cancellation(uuid) from public, anon;
grant execute on function public.request_infinitepay_cash_purchase_cancellation(uuid) to authenticated;

create or replace function public.confirm_infinitepay_cash_purchase(
  p_purchase_id uuid, p_order_nsu text, p_transaction_nsu text,
  p_invoice_slug text, p_amount_centavos integer, p_capture_method text,
  p_receipt_url text default null
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_purchase public.cash_purchases;
begin
  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider <> 'infinitepay' or
     v_purchase.provider_order_nsu is distinct from p_order_nsu or
     v_purchase.amount_centavos is distinct from p_amount_centavos or
     v_purchase.currency <> 'BRL' or
     p_transaction_nsu is null or length(p_transaction_nsu) not between 1 and 128 or
     p_invoice_slug is null or length(p_invoice_slug) not between 1 and 128 or
     p_capture_method is null or p_capture_method not in ('pix', 'credit_card') or
     (p_receipt_url is not null and length(p_receipt_url) > 2048) then
    raise exception 'PAYMENT_MISMATCH';
  end if;
  if v_purchase.provider_transaction_nsu is not null and
     v_purchase.provider_transaction_nsu <> p_transaction_nsu then raise exception 'TRANSACTION_MISMATCH'; end if;
  if v_purchase.provider_invoice_slug is not null and
     v_purchase.provider_invoice_slug <> p_invoice_slug then raise exception 'INVOICE_MISMATCH'; end if;
  if v_purchase.status not in ('pending', 'cancelled') then
    return jsonb_build_object('credited', false, 'reason', 'already_' || v_purchase.status);
  end if;
  if v_purchase.cash_amount <= 0 or v_purchase.cash_amount > 1000000 or
     v_purchase.amount_centavos <= 0 or v_purchase.amount_centavos > 10000000 then
    raise exception 'INVALID_PURCHASE_SNAPSHOT';
  end if;
  update public.cash_purchases set
    provider_transaction_nsu = p_transaction_nsu,
    provider_invoice_slug = p_invoice_slug,
    provider_capture_method = p_capture_method,
    receipt_url = p_receipt_url,
    paid_after_cancel_at = case when v_purchase.status = 'cancelled' then now() else paid_after_cancel_at end
    where id = v_purchase.id;
  if v_purchase.financial_case_id is not null then
    perform public._hold_purchase_in_case(v_purchase, null, null, null);
    return jsonb_build_object('credited', false, 'reason', 'held_in_financial_case');
  end if;
  if v_purchase.user_id is null then
    raise exception 'PURCHASE_ACCOUNT_DELETED_WITHOUT_CASE';
  end if;
  if not public._ledger_already_recorded(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text) then
    perform public._wallet_credit_cash(v_purchase.user_id, v_purchase.cash_amount);
    perform public._ledger_record(v_purchase.user_id, 'cash-purchase:' || v_purchase.id::text,
      'cash', 'credit', v_purchase.cash_amount, 'cash_purchase_confirmed', 'cash_purchase', v_purchase.id::text);
  end if;
  update public.cash_purchases set status = 'credited', credited_at = now(), credited_by = null
    where id = v_purchase.id;
  perform public._reactivate_deletion_if_clear(v_purchase.user_id);
  return jsonb_build_object('credited', true, 'status', 'credited');
end;
$$;
revoke all on function public.confirm_infinitepay_cash_purchase(uuid, text, text, text, integer, text, text)
  from public, anon, authenticated;
grant execute on function public.confirm_infinitepay_cash_purchase(uuid, text, text, text, integer, text, text)
  to service_role;

-- A cancelled purchase no longer blocks a new checkout. It still blocks account
-- deletion while its issued link might collect money, until a financial case is
-- separated and can retain any late verified payment.
create or replace function public._compute_financial_block_reason(p_user_id uuid) returns text
  language plpgsql stable as $$
declare v_payable_purchase boolean; v_cash_balance numeric;
begin
  select exists(select 1 from public.cash_purchases where user_id = p_user_id and
    (status = 'pending' or (payment_provider = 'infinitepay' and status = 'cancelled' and
      (checkout_url is not null or checkout_uncertain)))) into v_payable_purchase;
  select cash_balance into v_cash_balance from public.wallets where user_id = p_user_id;
  return case when v_payable_purchase then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance' else null end;
end;
$$;

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
  if v_job.kind <> 'account' or v_job.state <> 'blocked_financial_review' then raise exception 'NOT_BLOCKED'; end if;
  select id into v_pending_purchase_id from public.cash_purchases where user_id = v_job.target_id and
    (status = 'pending' or (payment_provider = 'infinitepay' and status = 'cancelled' and
      (checkout_url is not null or checkout_uncertain))) order by created_at desc limit 1;
  select cash_balance into v_cash_balance from public.wallets where user_id = v_job.target_id;
  v_reason := public._compute_financial_block_reason(v_job.target_id);
  insert into public.deletion_financial_reviews (
    job_id, admin_id, note, block_reason_at_check, cash_balance_at_check,
    pending_purchase_id_at_check, resulting_state, resulting_block_reason
  ) values (
    p_job_id, auth.uid(), v_note, v_job.block_reason, coalesce(v_cash_balance, 0),
    v_pending_purchase_id, case when v_reason is null then 'resumed' else 'still_blocked' end, v_reason
  );
  if v_reason is null then
    update public.deletion_jobs set state = 'pending', block_reason = null, updated_at = now() where id = p_job_id;
    return jsonb_build_object('resumed', true);
  end if;
  update public.deletion_jobs set block_reason = v_reason, updated_at = now() where id = p_job_id;
  return jsonb_build_object('resumed', false, 'blockReason', v_reason);
end;
$$;
