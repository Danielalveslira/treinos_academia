alter table public.cash_purchases add column reversed_centavos integer not null default 0 check (reversed_centavos >= 0 and reversed_centavos <= amount_centavos);
-- Verified reversals of ALREADY credited purchases. No gateway endpoints invented.
-- Operational activation requires approval of proportional allocation / debt policy.
-- Fail closed by default; tests explicitly activate only their transaction.
update public.economy_config set config = config || jsonb_build_object('financialControls',
 coalesce(config->'financialControls','{}'::jsonb) || '{"reversalsEnabled":false}'::jsonb) where id;

-- Purchase is the owner of the financial identity; ON DELETE RESTRICT retains evidence.
-- No copied name/email/user_id. Case association follows cash_purchases.financial_case_id.
create table public.cash_purchase_reversals (
 id uuid primary key default gen_random_uuid(),
 purchase_id uuid not null references public.cash_purchases(id),
 provider_event_id text not null unique check (length(provider_event_id) between 1 and 128),
 kind text not null check (kind in ('refund','chargeback')),
 amount_centavos integer not null check (amount_centavos > 0),
 cash_units integer not null check (cash_units >= 0),
 recovered_units integer not null default 0 check (recovered_units >= 0 and recovered_units <= cash_units),
 evidence_reference text not null check (length(btrim(evidence_reference)) between 5 and 200),
 note text not null check (length(btrim(note)) between 5 and 500),
 confirmed_by uuid references public.users(id) on delete set null,
 confirmed_at timestamptz not null default now()
);
create index cash_reversals_purchase_idx on public.cash_purchase_reversals(purchase_id,confirmed_at,id);
create index cash_reversals_outstanding_idx on public.cash_purchase_reversals(purchase_id,confirmed_at,id) where recovered_units < cash_units;
alter table public.cash_purchase_reversals enable row level security;
revoke all on public.cash_purchase_reversals from public, anon, authenticated, service_role;

-- No direct read policy: authorized RPC exposes administrative evidence; buyers
-- receive only the aggregate reversal amount on their existing purchase row.
comment on table public.cash_purchase_reversals is 'Evidence retained with the purchase/financial case. No automated purge; existing retention review applies. Event/amount immutable; recovered_units only increases via compensation.';

create or replace function private.protect_cash_reversal() returns trigger
language plpgsql set search_path = '' as $$
begin
 if tg_op = 'DELETE' then raise exception 'REVERSAL_IMMUTABLE'; end if;
 if (to_jsonb(new) - 'confirmed_by' - 'recovered_units') is distinct from (to_jsonb(old) - 'confirmed_by' - 'recovered_units')
    or new.recovered_units < old.recovered_units then raise exception 'REVERSAL_IMMUTABLE'; end if;
 if new.confirmed_by is distinct from old.confirmed_by and new.confirmed_by is not null then raise exception 'REVERSAL_IMMUTABLE'; end if;
 return new;
end;
$$;
revoke all on function private.protect_cash_reversal() from public, anon, authenticated;
create trigger cash_reversals_immutable before update or delete on public.cash_purchase_reversals for each row execute function private.protect_cash_reversal();

create or replace function private.cash_debt(p_user_id uuid) returns bigint
language sql stable security definer set search_path = '' as $$
 select coalesce(sum(r.cash_units-r.recovered_units),0)::bigint
 from public.cash_purchases p join public.cash_purchase_reversals r on r.purchase_id=p.id
 where p.user_id=p_user_id and r.cash_units > r.recovered_units
$$;
revoke all on function private.cash_debt(uuid) from public, anon, authenticated;

-- Wallet first, then reversal rows in stable order. Does not acquire purchase locks.
-- Every recovery has an immutable ledger row keyed by event and cumulative recovery.
create or replace function private.recover_cash_debt(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_balance integer; v_take integer; v_total integer := 0; v_reversal public.cash_purchase_reversals;
begin
 select cash_balance into v_balance from public.wallets where user_id=p_user_id for update;
 for v_reversal in select r.* from public.cash_purchase_reversals r join public.cash_purchases p on p.id=r.purchase_id
   where p.user_id=p_user_id and r.recovered_units < r.cash_units
   order by r.confirmed_at,r.id for update of r
 loop
  exit when coalesce(v_balance,0) <= 0;
  v_take := least(v_balance,v_reversal.cash_units-v_reversal.recovered_units);
  perform public._ledger_record(p_user_id,'cash-reversal:'||v_reversal.id::text||':'||(v_reversal.recovered_units+v_take)::text,
   'cash','debit',v_take,'cash_purchase_reversal','cash_purchase',v_reversal.purchase_id::text);
  update public.wallets set cash_balance=cash_balance-v_take, updated_at=now() where user_id=p_user_id;
  update public.cash_purchase_reversals set recovered_units=recovered_units+v_take where id=v_reversal.id;
  v_total := v_total+v_take; v_balance := v_balance-v_take;
 end loop;
 return v_total;
end;
$$;
revoke all on function private.recover_cash_debt(uuid) from public, anon, authenticated;

create or replace function public.admin_record_cash_reversal(
 p_purchase_id uuid, p_provider_event_id text, p_kind text, p_amount_centavos integer,
 p_evidence_reference text, p_note text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.cash_purchases; r public.cash_purchase_reversals; v_previous integer; v_units integer; v_id uuid;
begin
 if not public.is_superadmin() or not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED'; end if;
 if not coalesce((select (config->'financialControls'->>'reversalsEnabled')::boolean from public.economy_config where id),false) then raise exception 'REVERSALS_NOT_ENABLED'; end if;
 if p_provider_event_id is null or length(p_provider_event_id) not between 1 and 128
    or p_kind is null or p_kind not in ('refund','chargeback') or p_amount_centavos is null or p_amount_centavos <= 0
    or p_evidence_reference is null or length(btrim(p_evidence_reference)) not between 5 and 200
    or p_note is null or length(btrim(p_note)) not between 5 and 500 then raise exception 'INVALID_REVERSAL'; end if;
 select * into p from public.cash_purchases where id=p_purchase_id for update;
 if p.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
 select * into r from public.cash_purchase_reversals where provider_event_id=p_provider_event_id;
 if found then
  if r.purchase_id <> p_purchase_id or r.kind <> p_kind or r.amount_centavos <> p_amount_centavos
    or r.evidence_reference <> p_evidence_reference then raise exception 'REVERSAL_EVENT_CONFLICT'; end if;
  return jsonb_build_object('id',r.id,'replay',true,'cashUnits',r.cash_units,'outstanding',r.cash_units-r.recovered_units);
 end if;
 if p.status <> 'credited' or p.payment_provider <> 'infinitepay' or p.currency <> 'BRL' or p.provider_transaction_nsu is null then raise exception 'PURCHASE_NOT_CREDITED'; end if;
 perform private.require_money_units(p.cash_amount);
 if p.user_id is not null then
  perform public._wallet_ensure_row(p.user_id);
  perform 1 from public.wallets where user_id=p.user_id for update;
 end if;
 select coalesce(sum(amount_centavos),0) into v_previous from public.cash_purchase_reversals where purchase_id=p.id;
 if p_amount_centavos > p.amount_centavos-v_previous then raise exception 'REVERSAL_EXCEEDS_PAYMENT'; end if;
 -- Cumulative integer allocation avoids double rounding across partial refunds.
 v_units := floor(p.cash_amount*(v_previous+p_amount_centavos)/p.amount_centavos)::integer
            - floor(p.cash_amount*v_previous/p.amount_centavos)::integer;
 insert into public.cash_purchase_reversals(purchase_id,provider_event_id,kind,amount_centavos,cash_units,evidence_reference,note,confirmed_by)
 values(p.id,p_provider_event_id,p_kind,p_amount_centavos,v_units,p_evidence_reference,p_note,auth.uid()) returning id into v_id;
 if p.user_id is not null then perform private.recover_cash_debt(p.user_id); end if;
 update public.cash_purchases set reversed_centavos=v_previous+p_amount_centavos where id=p.id;
 return jsonb_build_object('id',v_id,'replay',false,'cashUnits',v_units,
   'outstanding',(select cash_units-recovered_units from public.cash_purchase_reversals where id=v_id));
end;
$$;
revoke all on function public.admin_record_cash_reversal(uuid,text,text,integer,text,text) from public, anon;
grant execute on function public.admin_record_cash_reversal(uuid,text,text,integer,text,text) to authenticated;

-- Recovery first means a spend can never consume credits owed to a verified reversal.
-- Partial recovery is rolled back if a following spend fails, preserving atomicity.

create or replace function public._wallet_credit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
declare
  v_next numeric;
begin
  perform private.require_money_units(p_amount);
  if p_user_id is null or not exists (select 1 from public.users where id = p_user_id) then
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  select cash_balance + p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 or v_next > 9007199254740991 then
    raise exception 'Saldo de EvoCash inválido após o crédito.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
  perform private.recover_cash_debt(p_user_id);
end;
$$;

create or replace function public._wallet_debit_cash(p_user_id uuid, p_amount numeric) returns void
  language plpgsql set search_path = '' as $$
declare
  v_next numeric;
begin
  perform private.require_money_units(p_amount);
  if exists (select 1 from public.users where id = p_user_id and account_status = 'deleting') then
    raise exception 'ACCOUNT_DELETING';
  end if;
  perform public._wallet_ensure_row(p_user_id);
  perform private.recover_cash_debt(p_user_id);
  select cash_balance - p_amount into v_next from public.wallets where user_id = p_user_id for update;
  if v_next < 0 then
    raise exception 'Saldo de EvoCash insuficiente.';
  end if;
  update public.wallets set cash_balance = v_next, updated_at = now() where user_id = p_user_id;
end;
$$;
create or replace function public._compute_financial_block_reason(p_user_id uuid) returns text
  language plpgsql stable as $$
declare v_payable_purchase boolean; v_cash_balance numeric;
begin
  select exists(select 1 from public.cash_purchases where user_id = p_user_id and
    (status in ('pending', 'needs_review') or (payment_provider = 'infinitepay' and status = 'cancelled' and
      (checkout_url is not null or checkout_uncertain)))) into v_payable_purchase;
  select cash_balance into v_cash_balance from public.wallets where user_id = p_user_id;
  if private.cash_debt(p_user_id) > 0 then return 'cash_reversal_debt'; end if;
  return case when v_payable_purchase then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance' else null end;
end;
$$;

create or replace function public.admin_cash_reversal_events(p_purchase_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
 if not public.is_superadmin() or not coalesce(public.has_app_access(),false) then raise exception 'PERMISSION_DENIED'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (select * from public.cash_purchase_reversals where purchase_id=p_purchase_id order by confirmed_at,id limit 100) x);
end;
$$;
revoke all on function public.admin_cash_reversal_events(uuid) from public,anon;
grant execute on function public.admin_cash_reversal_events(uuid) to authenticated;
