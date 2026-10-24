-- Catalog/operational metadata only; no application RPCs, payloads, tokens or job commands.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
select jsonb_build_object(
 'triggers',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid,true),'function',t.tgfoid::regprocedure::text) order by c.oid::regclass::text,t.tgname)
  from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace join pg_proc f on f.oid=t.tgfoid join pg_namespace fn on fn.oid=f.pronamespace
  where not t.tgisinternal and (n.nspname in ('public','private') or fn.nspname in ('public','private'))),
 'function_security',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),'definer',p.prosecdef,'config',p.proconfig,'language',l.lanname,
   'grants',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) order by p.oid::regprocedure::text)
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang where n.nspname in ('public','private') and p.prokind='f'),
 'schemas',(select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),'grants',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type) order by a.grantee,a.privilege_type) from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)) order by n.nspname) from pg_namespace n where n.nspname in ('public','private','auth','storage')),
 'relation_security',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'kind',c.relkind,'force_rls',c.relforcerowsecurity,
  'grants',(select jsonb_agg(jsonb_build_object('role',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 's'::"char" else 'r'::"char" end,c.relowner))) a)) order by c.oid::regclass::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('r','v','m','S')),
 'disabled_fk_triggers',(select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and t.tgisinternal and t.tgenabled not in ('O','A')),
 'column_grants',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'column',a.attname,'acl',a.attacl::text) order by c.oid::regclass::text,a.attname) from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and a.attacl is not null),
 'views',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'definition',pg_get_viewdef(c.oid,true),'options',c.reloptions,'acl',c.relacl::text) order by c.oid::regclass::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind in ('v','m')),
 'enums',(select jsonb_agg(jsonb_build_object('type',t.oid::regtype::text,'labels',(select jsonb_agg(e.enumlabel order by e.enumsortorder) from pg_enum e where e.enumtypid=t.oid)) order by t.oid::regtype::text) from pg_type t join pg_namespace n on n.oid=t.typnamespace where n.nspname in ('public','private') and t.typtype='e'),
 'extensions',(select jsonb_agg(jsonb_build_object('name',extname,'version',extversion) order by extname) from pg_extension),
 'relation_sizes',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'bytes',pg_total_relation_size(c.oid),'estimated_rows',c.reltuples::bigint) order by c.oid::regclass::text) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'),
 'jobs',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active,'command_md5',md5(command)) order by jobname) from cron.job),
 'purchase_statuses',(select jsonb_agg(x order by x.status) from (select status,count(*) from public.cash_purchases group by status) x),
 'pending_purchase_age',(select jsonb_build_object('over_7_days',count(*) filter(where created_at<now()-interval '7 days'),'uncertain',count(*) filter(where checkout_uncertain),'missing_identity',count(*) filter(where provider_transaction_nsu is null or provider_invoice_slug is null)) from public.cash_purchases where status='pending'),
 'invalid_purchase_snapshots',(select count(*) from public.cash_purchases where amount_centavos<=0 or amount_centavos>10000000 or (payment_provider='infinitepay' and currency<>'BRL')),
 'duplicate_provider_transactions',(select count(*) from (select provider_transaction_nsu from public.cash_purchases where payment_provider='infinitepay' and provider_transaction_nsu is not null group by provider_transaction_nsu having count(*)>1) d),
 'orphan_wallets',(select count(*) from public.wallets w where not exists(select 1 from public.users u where u.id=w.user_id)),
 'orphan_ledger_users',(select count(*) from public.economy_transactions t where t.user_id is not null and not exists(select 1 from public.users u where u.id=t.user_id)),
 'orphan_purchase_users',(select count(*) from public.cash_purchases p where p.user_id is not null and not exists(select 1 from public.users u where u.id=p.user_id)),
 'orphan_ledger_cases',(select count(*) from public.economy_transactions t where t.financial_case_id is not null and not exists(select 1 from public.account_financial_cases c where c.id=t.financial_case_id)),
 'orphan_purchase_cases',(select count(*) from public.cash_purchases p where p.financial_case_id is not null and not exists(select 1 from public.account_financial_cases c where c.id=p.financial_case_id)),
 'daily_cap_excess',(select count(*) from public.economy_daily where earned_total>10),
 'invalid_constraints',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'name',conname) order by conrelid::regclass::text,conname) from pg_constraint k join pg_namespace n on n.oid=k.connamespace where n.nspname in ('public','private') and not convalidated),
 'active_transactions',(select count(*) from pg_stat_activity where datname=current_database() and state<>'idle' and pid<>pg_backend_pid()),
 'deadlocks',(select deadlocks from pg_stat_database where datname=current_database())
) as finance_catalog;
rollback;
