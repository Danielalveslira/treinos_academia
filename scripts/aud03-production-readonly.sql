-- Run only against confirmed ywrjojrjgozdfpddkkuy. Quantities only, no identities.
begin read only;
select version,name from supabase_migrations.schema_migrations order by version;
select policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename='status_votes';
select grantee,privilege_type from information_schema.role_table_grants
where table_schema='public' and table_name='status_votes';
select grantee,column_name,privilege_type from information_schema.column_privileges
where table_schema='public' and table_name='status_votes';
select count(*) as total_votes,
  count(*) filter(where s.id is null) as missing_status,
  count(*) filter(where s.type <> 'poll') as non_poll,
  count(*) filter(where not exists(
    select 1 from jsonb_array_elements(case when jsonb_typeof(s.poll_options)='array'
      then s.poll_options else '[]'::jsonb end) o
    where jsonb_typeof(o->'id')='string' and jsonb_typeof(o->'label')='string'
      and o->>'id'=v.option_id)) as invalid_option,
  count(*) filter(where not exists(select 1 from public.community_members m
    where m.community_id=s.community_id and m.user_id=v.user_id)) as currently_nonmember,
  count(*) filter(where v.created_at>s.expires_at and s.retention_mode<>'no_auto_expiration') as after_base_expiry_needs_promotion_review
from public.status_votes v left join public.statuses s on s.id=v.status_id;
-- Membership and promotion history at vote time cannot be inferred from present state.
select count(*) as duplicate_groups from (
  select status_id,user_id from public.status_votes group by status_id,user_id having count(*)>1
) duplicates;
select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('get_poll_results','get_poll_results_batch','is_community_member','has_app_access','community_access_allowed'))
or (n.nspname='private' and p.proname in ('status_interaction_expiry','status_promotion_until','comments_open'));
select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.status_votes'::regclass and not tgisinternal;
rollback;
