set local lock_timeout='5s';
set local statement_timeout='30s';
-- A versão anterior agregava antes de LIMIT, devolvendo todo o histórico.
-- A paginação ocorre antes da agregação, mantendo a mesma autorização e projeção.
create or replace function public.get_advertising_operations_for_advertiser(p_id uuid, p_before bigint default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare account uuid;
begin
 select account_id into account from private.advertising_drafts where ad_id=p_id;
 if account is null then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_advertising_editor(account);
 return coalesce((
  select jsonb_agg(jsonb_build_object(
   'id',o.id,'action',o.action,'reason',o.reason,'occurredAt',o.occurred_at,
   'actorKind',case
    when o.action in('approve','reject','admin_suspend','advertising_suspension_recovered','resume','suspend') then 'admin'
    when o.actor_user_id=auth.uid() then 'self'
    else 'other' end
  ) order by o.id desc)
  from (
   select id,action,reason,occurred_at,actor_user_id
   from public.advertising_operations
   where resource_id=p_id
    and action in('create','submit','approve','reject','admin_suspend','suspend',
     'suspend_pause_limit','advertiser_pause','advertiser_resume','resume',
     'advertising_suspension_recovered','archive')
    and (p_before is null or id<p_before)
   order by id desc limit 20
  ) o
 ),'[]'::jsonb);
end $$;
revoke all on function public.get_advertising_operations_for_advertiser(uuid,bigint) from public,anon,service_role;
grant execute on function public.get_advertising_operations_for_advertiser(uuid,bigint) to authenticated;
