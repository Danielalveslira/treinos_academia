select jsonb_pretty(jsonb_build_object(
 'functions',(select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'definition',pg_get_functiondef(p.oid),'acl',
   (select jsonb_agg((a.grantee::regrole::text||':'||a.privilege_type) order by a.grantee::regrole::text,a.privilege_type)
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner)))a)) order by p.oid::regprocedure::text)
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and
 (p.proname ~ 'wallet|ledger|cash_purchase|cash_reversal|cash_debt|finance_recon|finance_findings|infinitepay|award_evocoins|has_reward_activity|reward_fingerprint|post_is_rewardable|record_activity_checkpoint|register_qualified_activity|create_promotion')),
 'relations',(select jsonb_agg(jsonb_build_object('name',c.oid::regclass::text,'rls',c.relrowsecurity,
 'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum)
   from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
 'constraints',(select jsonb_agg(jsonb_build_object('name',co.conname,'definition',pg_get_constraintdef(co.oid),'validated',co.convalidated) order by co.conname) from pg_constraint co where co.conrelid=c.oid),
 'indexes',(select jsonb_agg(pg_get_indexdef(i.indexrelid) order by ci.relname) from pg_index i join pg_class ci on ci.oid=i.indexrelid where i.indrelid=c.oid),
 'policies',(select jsonb_agg(jsonb_build_object('name',pol.polname,'using',pg_get_expr(pol.polqual,pol.polrelid),'check',pg_get_expr(pol.polwithcheck,pol.polrelid)) order by pol.polname) from pg_policy pol where pol.polrelid=c.oid),
 'grants',(select jsonb_agg((a.grantee::regrole::text||':'||a.privilege_type) order by a.grantee::regrole::text,a.privilege_type) from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner)))a)) order by c.oid::regclass::text)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'
 and c.relname in('wallets','economy_transactions','economy_daily','economy_config','cash_purchases','promotions','cash_purchase_reversals','finance_reconciliation_state','finance_reconciliation_findings'))
));
