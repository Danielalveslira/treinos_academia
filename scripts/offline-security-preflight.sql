-- Somente leitura. Executar com papel administrativo no banco já migrado.
-- Falha com exception se uma das garantias críticas do release estiver ausente.
do $$
declare
  v_mark oid := to_regprocedure('public.mark_infinitepay_checkout_uncertain(uuid)');
  v_review oid := to_regprocedure('public.review_blocked_account_deletion(uuid,text)');
  v_sync oid := to_regprocedure('public.sync_workout_mutations(jsonb,uuid)');
  v_receipts oid := to_regclass('public.offline_mutation_receipts');
  v_workouts oid := to_regclass('public.workouts');
  v_flags oid := to_regclass('public.offline_feature_flags');
  v_telemetry oid := to_regclass('public.offline_telemetry');
begin
  if v_mark is null or v_review is null or v_sync is null or v_receipts is null or v_workouts is null
     or v_flags is null or v_telemetry is null then
    raise exception 'SECURITY_PREFLIGHT_MISSING_OBJECT';
  end if;

  if has_function_privilege('anon', v_mark, 'EXECUTE')
     or has_function_privilege('authenticated', v_mark, 'EXECUTE')
     or not has_function_privilege('service_role', v_mark, 'EXECUTE')
     or exists (
       select 1 from pg_proc p,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_mark and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     ) then
    raise exception 'SECURITY_PREFLIGHT_INFINITEPAY_GRANTS';
  end if;

  if not exists (
       select 1 from pg_proc p, unnest(p.proconfig) setting
       where p.oid = v_review and setting in ('search_path=', 'search_path=""')
     )
     or has_function_privilege('anon', v_review, 'EXECUTE')
     or not has_function_privilege('authenticated', v_review, 'EXECUTE') then
    raise exception 'SECURITY_PREFLIGHT_ACCOUNT_DELETION';
  end if;

  if has_function_privilege('anon', v_sync, 'EXECUTE')
     or not has_function_privilege('authenticated', v_sync, 'EXECUTE')
     or exists (
       select 1 from pg_proc p,
         lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
       where p.oid = v_sync and a.grantee = 0 and a.privilege_type = 'EXECUTE'
     )
     or position('has_app_access' in pg_get_functiondef(v_sync)) = 0
     or position('award_evocoins' in pg_get_functiondef(v_sync)) > 0
     or position('complete_workout_session' in pg_get_functiondef(v_sync)) > 0 then
    raise exception 'SECURITY_PREFLIGHT_OFFLINE_SYNC';
  end if;

  if has_table_privilege('anon', v_receipts, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_receipts, 'SELECT,INSERT,UPDATE,DELETE')
     or not exists (select 1 from pg_class where oid = v_receipts and relrowsecurity)
     or exists (select 1 from pg_policy where polrelid = v_receipts)
     or not exists (select 1 from pg_class where oid = v_workouts and relrowsecurity)
     or not exists (
       select 1 from pg_attribute
       where attrelid = v_workouts and attname = 'updated_at' and attnotnull
     )
     or not exists (
       select 1 from pg_trigger
       where tgrelid = v_workouts and tgname = 'workouts_touch_updated_at' and not tgisinternal
     ) then
    raise exception 'SECURITY_PREFLIGHT_RECEIPTS_OR_WORKOUTS';
  end if;

  if has_table_privilege('anon', v_flags, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_flags, 'SELECT,INSERT,UPDATE,DELETE')
     or not has_function_privilege('authenticated', 'public.get_offline_feature_flags()', 'EXECUTE')
     or has_function_privilege('anon', 'public.get_offline_feature_flags()', 'EXECUTE')
     or has_table_privilege('anon', v_telemetry, 'SELECT,INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', v_telemetry, 'SELECT,INSERT,UPDATE,DELETE')
     or not has_function_privilege('authenticated', 'public.record_offline_telemetry(jsonb,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_offline_telemetry(jsonb,uuid)', 'EXECUTE')
     or not exists (select 1 from pg_class where oid = v_flags and relrowsecurity)
     or not exists (select 1 from pg_class where oid = v_telemetry and relrowsecurity)
     or not exists (select 1 from cron.job where jobname = 'cleanup-offline-telemetry') then
    raise exception 'SECURITY_PREFLIGHT_OFFLINE_RUNTIME';
  end if;
end;
$$;
select 'SECURITY_PREFLIGHT_OK' as result;
