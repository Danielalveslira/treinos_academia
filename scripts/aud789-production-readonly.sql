begin read only;
set local statement_timeout='30s';
select jsonb_build_object(
 'journal',(select jsonb_agg(jsonb_build_object('version',version,'name',name) order by version) from supabase_migrations.schema_migrations),
 'status_policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='statuses'),
 'vote_policies',(select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='status_votes'),
 'status_grants',(select jsonb_agg(to_jsonb(g)) from information_schema.column_privileges g where table_schema='public' and table_name='statuses' and grantee in ('anon','authenticated','service_role')),
 'quota_rls',(select relrowsecurity from pg_class where oid=to_regclass('private.status_publication_limits')),
 'quota_trigger',(select pg_get_triggerdef(oid) from pg_trigger where tgrelid='public.statuses'::regclass and tgname='statuses_check_publication_rate'),
 'quota_function',(select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and p.proname='enforce_status_publication_rate'),
 'invariant_functions',(select md5(string_agg(pg_get_functiondef(p.oid),E'\n' order by p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f' and p.proname<>'enforce_status_publication_rate'),
 'posts',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),''))) from public.statuses s),
 'votes',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by status_id,user_id),''))) from public.status_votes s),
 'ledger',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),''))) from public.economy_transactions s),
 'purchases',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),''))) from public.cash_purchases s),
 'wallets',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by user_id),''))) from public.wallets s),
 'promotions',(select jsonb_build_object('count',count(*),'digest',md5(coalesce(string_agg(row_to_json(s)::text,E'\n' order by id),''))) from public.promotions s),
 'crons',(select jsonb_agg(jsonb_build_object('name',jobname,'schedule',schedule,'active',active) order by jobid) from cron.job),
 'expiration',(select jsonb_build_object('enabled',enabled,'queue_errors',(select count(*) from public.status_expiration_queue where last_error is not null)) from public.status_expiration_control where id),
 'storage_cleanup',(select jsonb_build_object('pending',count(*) filter(where state='pending'),'failed',count(*) filter(where state='failed')) from public.storage_cleanup_tasks)
) as audit;
rollback;
