alter table public.cash_purchases
 add column reconciliation_attempts smallint not null default 0 check(reconciliation_attempts between 0 and 10),
 add column reconciliation_after timestamptz,
 add column reconciliation_claim_token uuid;
-- Small persistent cursor plus bounded findings; no second wallet or balance.
-- A finding is NOT a repair. All runs remain read-only with respect to money.
create table private.finance_reconciliation_state (
 id boolean primary key default true check(id),
 wallet_cursor uuid,
 purchase_cursor uuid,
 ledger_cursor uuid,
 last_run_at timestamptz,
 checked_wallets bigint not null default 0,
 checked_ledger bigint not null default 0,
 checked_purchases bigint not null default 0
);
insert into private.finance_reconciliation_state(id) values(true);
create table private.finance_reconciliation_findings (
 kind text not null,
 reference_id uuid not null,
 evidence jsonb not null,
 first_seen_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now(),
 primary key(kind,reference_id)
);
create index finance_findings_page_idx on private.finance_reconciliation_findings(first_seen_at desc,reference_id desc,kind desc);
-- References are pseudonymous, do not hold personal profiles; findings are retained
-- 30 days after last observation, except verified payment evidence (no automatic purge).
-- Cursor is operational metadata, retained while active.
alter table private.finance_reconciliation_state enable row level security;
alter table private.finance_reconciliation_findings enable row level security;
revoke all on private.finance_reconciliation_state,private.finance_reconciliation_findings from public,anon,authenticated;

-- Indexes support bounded reconciliation of cash credits and purchase compensation.
create index economy_transactions_cash_credit_scan_idx on public.economy_transactions(id)
 where asset='cash' and direction='credit';
create index economy_transactions_purchase_reference_idx on public.economy_transactions(reference_id)
 where asset='cash' and reference_type='cash_purchase';
create or replace function private.finance_reconcile_shadow(p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s private.finance_reconciliation_state; w record; p record; t record;
 v_wallets integer := 0; v_purchases integer := 0; v_ledger integer := 0; v_differences integer := 0;
 v_issues text[];
begin
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_BATCH_SIZE'; end if;
 select * into s from private.finance_reconciliation_state where id for update skip locked;
 if not found then return jsonb_build_object('skipped',true); end if;
 -- One SQL statement/snapshot for balance and ledger. No wallet locks are acquired:
 -- ordinary financial writers are never blocked by a slow history scan.
 for w in select wallet_src.*, a.coin, a.cash, a.lifetime from public.wallets wallet_src
  cross join lateral(select
   coalesce(sum(case when asset='coin' then case direction when 'credit' then amount else -amount end else 0 end),0) coin,
   coalesce(sum(case when asset='cash' then case direction when 'credit' then amount else -amount end else 0 end),0) cash,
   coalesce(sum(amount) filter(where asset='coin' and direction='credit'),0) lifetime
   from public.economy_transactions where user_id=wallet_src.user_id) a
  where s.wallet_cursor is null or wallet_src.user_id > s.wallet_cursor order by wallet_src.user_id limit p_limit
 loop
  if (w.coin_balance,w.cash_balance,w.lifetime_coins_earned) is distinct from (w.coin,w.cash,w.lifetime) then
   insert into private.finance_reconciliation_findings(kind,reference_id,evidence)
   values('wallet_ledger_difference',w.user_id,jsonb_build_object('walletCoin',w.coin_balance,'ledgerCoin',w.coin,
    'walletCash',w.cash_balance,'ledgerCash',w.cash,'walletLifetime',w.lifetime_coins_earned,'ledgerLifetime',w.lifetime,
    'requiresOpeningBalanceReview',true))
   on conflict(kind,reference_id) do update set evidence=excluded.evidence,last_seen_at=now();
   v_differences:=v_differences+1;
  end if;
  s.wallet_cursor:=w.user_id; v_wallets:=v_wallets+1;
 end loop;
 if v_wallets < p_limit then s.wallet_cursor:=null; end if;
 for p in select purchase_src.*, l.credits, l.credit_units, l.compensated, r.reversed, r.recovered, r.outstanding
  from public.cash_purchases purchase_src
  cross join lateral(select count(*) filter(where direction='credit' and reason='cash_purchase_confirmed') credits,
   coalesce(sum(amount) filter(where direction='credit' and reason='cash_purchase_confirmed'),0) credit_units,
   coalesce(sum(amount) filter(where direction='debit' and reason='cash_purchase_reversal'),0) compensated
   from public.economy_transactions where reference_type='cash_purchase' and reference_id=purchase_src.id::text and asset='cash') l
  cross join lateral(select coalesce(sum(amount_centavos),0) reversed,coalesce(sum(recovered_units),0) recovered,
   coalesce(sum(cash_units-recovered_units),0) outstanding from public.cash_purchase_reversals where purchase_id=purchase_src.id) r
  where s.purchase_cursor is null or purchase_src.id>s.purchase_cursor order by purchase_src.id limit p_limit
 loop
  v_issues:='{}';
  if p.status='credited' and (p.credits<>1 or p.credit_units<>p.cash_amount) then v_issues:=array_append(v_issues,'credit_ledger_mismatch'); end if;
  if p.status='credited' and p.payment_provider='infinitepay' and (p.provider_transaction_nsu is null or p.provider_invoice_slug is null) then v_issues:=array_append(v_issues,'missing_payment_identity'); end if;
  if p.credits>1 then v_issues:=array_append(v_issues,'duplicate_credit'); end if;
  if p.status='needs_review' then v_issues:=array_append(v_issues,'payment_in_review'); end if;
  if p.status in ('pending','cancelled') and p.review_resolution is distinct from 'refunded_externally'
   and (p.checkout_uncertain or ((p.checkout_url is not null or p.provider_transaction_nsu is not null) and p.created_at<now()-interval '1 day')) then
   v_issues:=array_append(v_issues,'unsettled_payment');
  end if;
  if p.reversed_centavos<>p.reversed or p.compensated<>p.recovered then v_issues:=array_append(v_issues,'reversal_compensation_mismatch'); end if;
  if p.reconciliation_attempts>=10 and p.status in ('pending','cancelled') then v_issues:=array_append(v_issues,'provider_retries_exhausted'); end if;
  if p.outstanding>0 then v_issues:=array_append(v_issues,'reversal_obligation_pending'); end if;
  if cardinality(v_issues)>0 then
   insert into private.finance_reconciliation_findings(kind,reference_id,evidence)
    values('purchase_requires_reconciliation',p.id,jsonb_build_object('status',p.status,'provider',p.payment_provider,
     'issues',to_jsonb(v_issues),'outstandingUnits',p.outstanding,'hasPaymentIdentity',p.provider_transaction_nsu is not null and p.provider_invoice_slug is not null,'checkoutUncertain',p.checkout_uncertain))
    on conflict(kind,reference_id) do update set evidence=excluded.evidence,last_seen_at=now();
   v_differences:=v_differences+1;
  end if;
  s.purchase_cursor:=p.id; v_purchases:=v_purchases+1;
 end loop;
 if v_purchases < p_limit then s.purchase_cursor:=null; end if;
 -- Credits with no matching verified purchase are scanned independently, including
 -- credits whose reference points to a nonexistent purchase (invisible to a purchase scan).
 for t in select ledger_src.id,
  (purchase_match.id is not null and ledger_src.reason='cash_purchase_confirmed' and ledger_src.reference_type='cash_purchase'
   and ledger_src.amount=purchase_match.cash_amount and purchase_match.status='credited'
   and (purchase_match.payment_provider<>'infinitepay' or (purchase_match.provider_transaction_nsu is not null and purchase_match.provider_invoice_slug is not null))) origin_verified
  from public.economy_transactions ledger_src left join public.cash_purchases purchase_match
   on purchase_match.id=case when ledger_src.reference_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then ledger_src.reference_id::uuid else null end
  where ledger_src.asset='cash' and ledger_src.direction='credit' and (s.ledger_cursor is null or ledger_src.id>s.ledger_cursor)
  order by ledger_src.id limit p_limit
 loop
  if not coalesce(t.origin_verified,false) then
   insert into private.finance_reconciliation_findings(kind,reference_id,evidence)
    values('cash_credit_without_verified_purchase',t.id,jsonb_build_object('ledgerId',t.id,'requiresOriginReview',true))
    on conflict(kind,reference_id) do update set last_seen_at=now();
   v_differences:=v_differences+1;
  end if;
  s.ledger_cursor:=t.id; v_ledger:=v_ledger+1;
 end loop;
 if v_ledger<p_limit then s.ledger_cursor:=null; end if;
 update private.finance_reconciliation_state set wallet_cursor=s.wallet_cursor,purchase_cursor=s.purchase_cursor,ledger_cursor=s.ledger_cursor,
  last_run_at=now(),checked_wallets=checked_wallets+v_wallets,checked_purchases=checked_purchases+v_purchases,checked_ledger=checked_ledger+v_ledger where id;
 -- Bounded operational retention; verified provider evidence is never purged here.
 delete from private.finance_reconciliation_findings where (kind,reference_id) in
  (select kind,reference_id from private.finance_reconciliation_findings where kind<>'verified_payment_conflict'
   and last_seen_at<now()-interval '30 days' order by last_seen_at limit p_limit);
 return jsonb_build_object('wallets',v_wallets,'purchases',v_purchases,'ledger',v_ledger,'differences',v_differences,'mode','shadow');
end;
$$;
revoke all on function private.finance_reconcile_shadow(integer) from public,anon,authenticated;
grant execute on function private.finance_reconcile_shadow(integer) to service_role;
-- No automatic scheduling before staging approval; existing expiry cron is preserved.
create or replace function public.admin_finance_findings(p_cursor jsonb default null,p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_superadmin() or not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED'; end if;
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'INVALID_BATCH_SIZE'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
  select * from private.finance_reconciliation_findings where p_cursor is null or (first_seen_at,reference_id,kind) < ((p_cursor->>'at')::timestamptz,(p_cursor->>'id')::uuid,p_cursor->>'kind')
  order by first_seen_at desc,reference_id desc,kind desc limit p_limit) x);
end;
$$;
revoke all on function public.admin_finance_findings(jsonb,integer) from public,anon;
grant execute on function public.admin_finance_findings(jsonb,integer) to authenticated;

-- External reconciliation reuses existing verified confirmation; only orders whose
-- identity has been learned can be queried. Missing identities remain in shadow alerts.
create index cash_purchases_reconciliation_due_idx on public.cash_purchases(reconciliation_after,id)
 where payment_provider='infinitepay' and status in ('pending','cancelled')
 and provider_transaction_nsu is not null and provider_invoice_slug is not null;
create or replace function public.claim_infinitepay_reconciliation_batch(p_limit integer default 2) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r record; v_token uuid; v_items jsonb := '[]';
begin
 if p_limit is null or p_limit not between 1 and 3 then raise exception 'INVALID_BATCH_SIZE'; end if;
 for r in select * from public.cash_purchases
  where payment_provider='infinitepay' and status in ('pending','cancelled')
   and review_resolution is distinct from 'refunded_externally'
   and provider_transaction_nsu is not null and provider_invoice_slug is not null
   and reconciliation_attempts < 10 and (payment_check_after is null or payment_check_after <= clock_timestamp())
   and (reconciliation_after is null or reconciliation_after <= now())
  order by reconciliation_after nulls first,id limit p_limit for update skip locked
 loop
  v_token:=gen_random_uuid();
  update public.cash_purchases set reconciliation_attempts=reconciliation_attempts+1, reconciliation_claim_token=v_token,
   reconciliation_after=clock_timestamp()+interval '2 minutes'
   where id=r.id;
  v_items:=v_items||jsonb_build_array(jsonb_build_object('orderNsu',r.provider_order_nsu,'transactionNsu',r.provider_transaction_nsu,'invoiceSlug',r.provider_invoice_slug,'claimToken',v_token));
 end loop;
 return v_items;
end;
$$;
revoke all on function public.claim_infinitepay_reconciliation_batch(integer) from public,anon,authenticated;
grant execute on function public.claim_infinitepay_reconciliation_batch(integer) to service_role;

-- A legacy reusable link may collect a SECOND real payment with a different NSU.
-- Preserve the verified event for operators instead of silently ignoring it or
-- attaching it to the already-credited purchase. This NEVER grants more cash.
create or replace function public.record_infinitepay_verified_conflict(
 p_purchase_id uuid,p_order_nsu text,p_transaction_nsu text,p_invoice_slug text,p_amount_centavos integer
) returns void language plpgsql security definer set search_path = '' as $$
declare p public.cash_purchases; v_id uuid;
begin
 select * into p from public.cash_purchases where id=p_purchase_id;
 if p.id is null or p.payment_provider <> 'infinitepay' or p.provider_order_nsu is distinct from p_order_nsu
    or p.amount_centavos is distinct from p_amount_centavos or p.currency <> 'BRL'
    or p_transaction_nsu is null or p_transaction_nsu !~ '^[a-zA-Z0-9_-]{1,128}$'
    or p_invoice_slug is null or p_invoice_slug !~ '^[a-zA-Z0-9_-]{1,128}$' then raise exception 'PAYMENT_MISMATCH'; end if;
 v_id := md5(p_order_nsu||':'||p_transaction_nsu||':'||p_invoice_slug)::uuid;
 insert into private.finance_reconciliation_findings(kind,reference_id,evidence)
 values('verified_payment_conflict',v_id,jsonb_build_object('purchaseId',p.id,'orderNsu',p_order_nsu,
   'transactionNsu',p_transaction_nsu,'invoiceSlug',p_invoice_slug,'amountCentavos',p_amount_centavos,'originalStatus',p.status))
 on conflict(kind,reference_id) do update set last_seen_at=now();
end;
$$;
revoke all on function public.record_infinitepay_verified_conflict(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.record_infinitepay_verified_conflict(uuid,text,text,text,integer) to service_role;

-- Fencing token prevents a delayed old worker from overwriting a newer worker's lease.
create or replace function public.finish_infinitepay_reconciliation_item(p_order_nsu text,p_claim_token uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
 update public.cash_purchases set reconciliation_claim_token=null,
 reconciliation_after=clock_timestamp()+make_interval(secs=>least(3600,30*power(2,reconciliation_attempts)::integer)+floor(random()*15)::integer)
 where payment_provider='infinitepay' and provider_order_nsu=p_order_nsu and reconciliation_claim_token=p_claim_token;
end;
$$;
revoke all on function public.finish_infinitepay_reconciliation_item(text,uuid) from public,anon,authenticated;
grant execute on function public.finish_infinitepay_reconciliation_item(text,uuid) to service_role;
