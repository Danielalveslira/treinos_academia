-- Historical payment snapshots for shared reversal/deletion/reminder regressions.
-- Inserts synthetic rows only; never a runtime API or a package-checkout adapter.
create or replace function pg_temp.cash_purchase_fixture(p_uid uuid,p_cash numeric default 25,p_centavos integer default 590)
returns jsonb language plpgsql as $$
declare p public.cash_purchases;
begin
  insert into public.cash_purchases(user_id,request_id,package_id,package_label,cash_amount,amount_centavos,payment_provider,provider_order_nsu,checkout_lease_until,checkout_valid_until)
  values(p_uid,gen_random_uuid()::text,'historical-fixture','Historical synthetic payment',p_cash,p_centavos,'infinitepay','evo_'||replace(gen_random_uuid()::text,'-',''),now()+interval '1 minute',now()+interval '7 days') returning * into p;
  return jsonb_build_object('id',p.id,'orderNsu',p.provider_order_nsu,'amountCentavos',p.amount_centavos,'cashAmount',p.cash_amount,'checkoutValidUntil',p.checkout_valid_until);
end $$;
