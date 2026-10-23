\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('f1000000-0000-0000-0000-000000000001','authenticated','authenticated','finance-one@example.invalid','x',now(),'{}','{}',now(),now()),
('f1000000-0000-0000-0000-000000000002','authenticated','authenticated','finance-two@example.invalid','x',now(),'{}','{}',now(),now());
select ok(not has_table_privilege('service_role','public.wallets','update'), 'service API uses authorized RPC, not direct balance writes');
select ok(not has_table_privilege('anon','public.wallets','update'), 'anon cannot write wallet');
select ok(not has_table_privilege('authenticated','public.cash_purchases','insert'), 'client cannot create purchase directly');
select ok(not has_function_privilege('authenticated','public._wallet_credit_cash(uuid,numeric)','execute'), 'internal credit denied');
select ok(not has_function_privilege('anon','public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)','execute'), 'anon cannot confirm');
select is(to_regprocedure('public.request_cash_purchase(text,text)'),null::regprocedure,'legacy gateway reservation removed');
create function pg_temp.bad_amounts() returns integer language plpgsql as $$
declare v numeric; n integer := 0; fn text;
begin
 foreach fn in array array['_wallet_credit_coins','_wallet_debit_coins','_wallet_credit_cash','_wallet_debit_cash'] loop
 foreach v in array array[0,-1,0.1,1.5,'NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric,2147483648,null] loop
  begin
   execute format('select public.%I($1,$2)',fn) using 'f1000000-0000-0000-0000-000000000001'::uuid,v;
   raise exception 'test accepted %/%', fn,v;
  exception when raise_exception then
   if sqlerrm <> 'INVALID_MONEY_UNITS' then raise; end if;
   n := n+1;
  end;
 end loop; end loop;
 return n;
end $$;
select is(pg_temp.bad_amounts(),36,'all helpers reject fractions, nonfinite, negative, NULL, zero and overflow');
select public._wallet_credit_cash('f1000000-0000-0000-0000-000000000001',25);
select public._ledger_record('f1000000-0000-0000-0000-000000000001','fixture','cash','credit',25,'test','test','fixture');
select throws_ok($$select public._wallet_debit_cash('f1000000-0000-0000-0000-000000000001',26)$$,'Saldo de EvoCash insuficiente.','insufficient balance');
select is((select cash_balance from public.wallets where user_id='f1000000-0000-0000-0000-000000000001'),25,'failed debit leaves wallet intact');
select throws_ok($$update public.economy_transactions set amount=26 where natural_key='fixture'$$,'LEDGER_IMMUTABLE','ledger amount immutable');
select throws_ok($$delete from public.economy_transactions where natural_key='fixture'$$,'LEDGER_IMMUTABLE','ledger deletion denied');
select throws_ok($$select public._ledger_record('f1000000-0000-0000-0000-000000000001','fixture','cash','credit',25,'test','test','fixture')$$,'Esta operação já foi registrada.','duplicate key rejected');
-- Force rollback after a wallet change and before the ledger insert completes.
create function pg_temp.force_rollback() returns boolean language plpgsql as $$
begin
 begin
  perform public._wallet_credit_cash('f1000000-0000-0000-0000-000000000001',25);
  perform public._ledger_record('f1000000-0000-0000-0000-000000000001','fixture','cash','credit',25,'test','test','fixture');
 exception when others then return true;
 end;
 return false;
end $$;
select ok(pg_temp.force_rollback(),'forced failure rolled back subtransaction');
select is((select cash_balance from public.wallets where user_id='f1000000-0000-0000-0000-000000000001'),25,'wallet rolled back together with ledger');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.wallets where user_id='f1000000-0000-0000-0000-000000000001'),0,'A cannot see B wallet');
select throws_ok($$select public._wallet_credit_cash('f1000000-0000-0000-0000-000000000002',10)$$,'42501',null,'direct RPC credit denied');
reset role;
select throws_ok($$select public._wallet_credit_cash('f1000000-0000-0000-0000-000000000001',2147483647)$$,'22003',null,'storage overflow rejected atomically');
select * from finish();
rollback;
