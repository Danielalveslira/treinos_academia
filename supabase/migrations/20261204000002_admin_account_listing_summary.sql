-- Phase 5.1: preserve current guards and one account row; aggregate multiple resources.
set local lock_timeout='5s';
set local statement_timeout='60s';
CREATE OR REPLACE FUNCTION public.admin_accounts_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  c_max constant integer := 1000;
  v_result jsonb;
begin
  if auth.uid() is not null and not private.current_session_active() then raise exception 'SESSION_REVOKED'; end if;
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  with base as (
    select
      u.id, u.username, u.role, u.created_at, u.legal_acceptance_version, u.disabled_reason,
      r.action as restriction_action, r.until as restriction_until,
      j.state as job_state,
      case
        when u.account_status = 'deleting' or j.state is not null then 'deleting'
        when u.account_status = 'disabled' then 'disabled'
        when r.user_id is not null then 'suspended'
        else 'active'
      end as status
    from public.users u
    left join public.account_restrictions r
      on r.user_id = u.id and not (r.action = 'temporary_suspension' and r.until <= now())
    left join public.deletion_jobs j
      on j.kind = 'account' and j.target_id = u.id
     and j.state in ('pending', 'blocked_financial_review', 'auth_cleanup')
  ),
  metrics as (
    select
      count(*) as total_accounts,
      count(*) filter (where status = 'active') as active_accounts,
      count(*) filter (where status = 'suspended') as suspended_accounts,
      count(*) filter (where created_at >= now() - interval '7 days') as new_accounts_7d,
      count(*) filter (where job_state is not null) as pending_deletions
    from base
  ),
  page as (
    select * from base order by created_at desc, id limit c_max
  ),
  community_counts as (
    select m.user_id, count(*) as total
    from public.community_members m
    where m.user_id in (select id from page)
    group by m.user_id
  ),
  flag_counts as (
    select d.target_user_id as user_id, count(*) as total
    from public.moderation_decisions d
    where d.target_user_id in (select id from page) and d.action not in ('no_action', 'restore')
    group by d.target_user_id
  ),
  pending_purchases as (
    select distinct p.user_id
    from public.cash_purchases p
    where p.status = 'pending' and p.user_id in (select id from page)
  ),
  listings as (
    select l.owner_id,case when count(*)=1 then min(l.lifecycle_state) else 'multiple' end lifecycle_state,count(*) total
    from public.professional_listings l
    where l.owner_id in (select id from page)
    group by l.owner_id
  ),
  rows_json as (
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'email', au.email,
        'role', p.role,
        'status', p.status,
        'created_at', p.created_at,
        -- Dois conceitos distintos: login (Auth) x uso (user_activity, ver touch_user_activity).
        'last_sign_in_at', au.last_sign_in_at,
        'last_active_at', ua.last_active_at,
        'community_count', coalesce(cc.total, 0),
        'financial_status', case
          when pp.user_id is not null or p.job_state = 'blocked_financial_review' then 'pending'
          when coalesce(w.cash_balance, 0) > 0 then 'balance'
          else 'none'
        end,
        'flags_count', coalesce(fc.total, 0),
        'showcase_status', coalesce(l.lifecycle_state, 'none'),
        'showcase_count', coalesce(l.total,0),
        'deletion_status', coalesce(p.job_state, 'none'),
        'accepted_legal_version', p.legal_acceptance_version,
        'disabled_reason', case when p.status = 'disabled' then p.disabled_reason end,
        -- Restrição vigente mesmo com a conta desativada/em exclusão: o cliente precisa dela para
        -- derivar o status certo ao reativar localmente (desativada + restrição => suspensa).
        'restriction_action', p.restriction_action,
        'restriction_until', p.restriction_until
      )
      order by p.created_at desc, p.id
    ) as accounts
    from page p
    join auth.users au on au.id = p.id
    left join community_counts cc on cc.user_id = p.id
    left join flag_counts fc on fc.user_id = p.id
    left join pending_purchases pp on pp.user_id = p.id
    left join public.wallets w on w.user_id = p.id
    left join public.user_activity ua on ua.user_id = p.id
    left join listings l on l.owner_id = p.id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'metrics', (select to_jsonb(metrics) from metrics),
    'accounts', coalesce((select accounts from rows_json), '[]'::jsonb),
    'meta', jsonb_build_object(
      'total', (select total_accounts from metrics),
      'returned', coalesce(jsonb_array_length((select accounts from rows_json)), 0),
      'truncated', (select total_accounts from metrics) > c_max,
      'max_snapshot_rows', c_max
    )
  )
  into v_result;

  return v_result;
end;
$function$;


revoke all on function public.admin_accounts_snapshot() from public,anon,service_role;
grant execute on function public.admin_accounts_snapshot() to authenticated;
