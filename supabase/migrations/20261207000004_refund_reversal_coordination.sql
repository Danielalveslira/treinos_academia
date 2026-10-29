-- Preserve registration of an independently verified chargeback/refund while a
-- claim holds credits. Recover only unreserved units, keeping the existing debt
-- and ledger mechanism. A known provider event must never disappear because a
-- wallet hold made its immediate recovery impossible.
set local lock_timeout='5s';
create or replace function private.recover_cash_debt(p_user_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_balance integer; v_take integer; v_total integer := 0; v_reversal public.cash_purchase_reversals;
begin
 select cash_balance-coalesce((select sum(reserved_units) from public.refund_requests where requester_id=p_user_id),0)
 into v_balance from public.wallets where user_id=p_user_id for update;
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
revoke all on function private.recover_cash_debt(uuid) from public,anon,authenticated,service_role;
create function private.refund_external_reversal() returns trigger language plpgsql security definer set search_path='' as $$
declare r public.refund_requests; result jsonb;
begin
 for r in select * from public.refund_requests where purchase_id=new.purchase_id and status not in('completed','rejected','canceled_by_requester') for update loop
  -- A completion from this module has already released its OWN hold in the same
  -- transaction and carries the exact immutable provider evidence being recorded.
  if r.status='provider_refund_confirmed' and r.reserved_units=0 and r.resolution->>'externalId'=new.provider_event_id then continue; end if;
  update public.refund_requests set status='disputed',revision=revision+1 where id=r.id returning * into r;
  result:=private.refund_json(r);
  insert into public.refund_request_events(request_id,actor_id,intent_id,action,message,evidence,input,result)
  values(r.id,coalesce(auth.uid(),r.requester_id),gen_random_uuid(),'external_reversal_detected',
  'Foi registrada devolução ou contestação externa. O pedido requer conciliação antes de qualquer nova restituição.',
  jsonb_build_object('reversalId',new.id,'kind',new.kind),'{}',result);
 end loop;
 return new;
end $$;
revoke all on function private.refund_external_reversal() from public,anon,authenticated,service_role;
create trigger refund_external_reversal after insert on public.cash_purchase_reversals for each row execute function private.refund_external_reversal();
create or replace function public.get_refund_balance() returns jsonb language plpgsql security definer set search_path='' as $$
declare balance bigint; held bigint; debt bigint;
begin
 perform private.require_commercial_user();
 select cash_balance into balance from public.wallets where user_id=auth.uid();
 select coalesce(sum(reserved_units),0) into held from public.refund_requests where requester_id=auth.uid();
 debt:=private.cash_debt(auth.uid());
 return jsonb_build_object('balance',coalesce(balance,0)::text,'reserved',held::text,'available',greatest(coalesce(balance,0)-held-debt,0)::text,'serverNow',clock_timestamp());
end $$;
revoke all on function public.get_refund_balance() from public,anon,service_role;
grant execute on function public.get_refund_balance() to authenticated;
notify pgrst,'reload schema';
