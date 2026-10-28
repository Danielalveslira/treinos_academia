-- Only historical fixture reconstruction; never installed as a production RPC.
create function pg_temp.legacy_promotion_fixture(p_owner uuid,p_type text,p_target uuid,p_community uuid,p_request text) returns void
language plpgsql as $$declare pid uuid:=gen_random_uuid();amount integer:=case when p_type='post' then 25 else 100 end;begin
 perform public._wallet_debit_cash(p_owner,amount);
 perform public._ledger_record(p_owner,'legacy-fixture:'||pid::text,'cash','debit',amount,'promotion_purchase','promotion',pid::text);
 insert into public.promotions(id,owner_id,request_id,target_type,target_id,community_id,package_id,cash_amount,duration_days,status,expires_at)
 values(pid,p_owner,p_request,p_type,p_target,p_community,case when p_type='post' then 'post_boost_3d' else 'community_boost_7d' end,amount,3,'active',now()+interval '3 days');
 if p_type='post' then update public.statuses set promoted=true,promoted_until=now()+interval '3 days',active_promotion_id=pid where id=p_target;
 else update public.communities set promoted=true,promoted_until=now()+interval '3 days',active_promotion_id=pid where id=p_target;end if;
end$$;
