-- Historical provider identifiers, purchases, ledger and financial cases stay intact.
-- Production had no non-finalized Mercado Pago purchases before removing its runtime.
do $$
begin
  if exists (
    select 1 from public.cash_purchases
    where payment_provider = 'mercadopago' and status not in ('credited', 'cancelled', 'held_in_case')
  ) then
    raise exception 'MERCADOPAGO_UNFINISHED_PURCHASES';
  end if;
end;
$$;

-- Guard against accidental use of the historical provider for a new row.
alter table public.cash_purchases alter column payment_provider set default 'infinitepay';

drop function if exists public.request_cash_purchase(text, text);
drop function if exists public.attach_mercadopago_payment(uuid, bigint, text, text, text, text);
drop function if exists public.credit_cash_purchase_from_webhook(bigint, text);
drop function if exists public.confirm_cash_purchase(uuid, text);
drop function if exists public.cancel_cash_purchase(uuid, text);
