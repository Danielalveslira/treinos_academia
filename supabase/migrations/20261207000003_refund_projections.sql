-- Additional guarded projections; existing wallet representation and clients stay compatible.
create function public.get_refund_balance() returns jsonb language plpgsql security definer set search_path='' as $$
declare balance bigint; held bigint;
begin
 perform private.require_commercial_user();
 select cash_balance into balance from public.wallets where user_id=auth.uid();
 select coalesce(sum(reserved_units),0) into held from public.refund_requests where requester_id=auth.uid();
 return jsonb_build_object('balance',coalesce(balance,0)::text,'reserved',held::text,'available',greatest(coalesce(balance,0)-held,0)::text,'serverNow',clock_timestamp());
end $$;
create function public.list_refund_events(p_id uuid,p_before bigint default null,p_limit integer default 50) returns jsonb
language plpgsql security definer set search_path='' as $$
declare admin boolean;
begin
 perform private.require_commercial_user();
 admin:=coalesce(public.is_superadmin(),false);
 if not exists(select 1 from public.refund_requests where id=p_id and (requester_id=auth.uid() or admin)) then raise exception 'REFUND_NOT_FOUND'; end if;
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'INVALID_PAGE'; end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',x.id::text,'action',x.action,'message',x.message,'createdAt',x.created_at,
 'evidence',case when admin then x.evidence else null end) order by x.id),'[]') from
 (select * from public.refund_request_events where request_id=p_id and (p_before is null or id<p_before) order by id desc limit p_limit) x);
end $$;
revoke all on function public.get_refund_balance(),public.list_refund_events(uuid,bigint,integer) from public,anon,authenticated,service_role;
grant execute on function public.get_refund_balance(),public.list_refund_events(uuid,bigint,integer) to authenticated;
notify pgrst,'reload schema';
