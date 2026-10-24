-- Privilege/shape checks for the future SECURITY DEFINER owner; no session data read.
begin read only;
set local statement_timeout='10s';
set local lock_timeout='2s';
set local search_path=pg_catalog;
select jsonb_build_object(
 'migration_owner','postgres',
 'owner_auth_usage',has_schema_privilege('postgres','auth','usage'),
 'owner_sessions_select',has_table_privilege('postgres','auth.sessions','select'),
 'owner_uid_execute',has_function_privilege('postgres','auth.uid()','execute'),
 'owner_jwt_execute',has_function_privilege('postgres','auth.jwt()','execute'),
 'owner_storage_usage',has_schema_privilege('postgres','storage','usage'),
 'owner_objects_select',has_table_privilege('postgres','storage.objects','select'),
 'session_columns',(select jsonb_agg(jsonb_build_object('name',attname,'type',format_type(atttypid,atttypmod),'notnull',attnotnull) order by attname) from pg_attribute where attrelid='auth.sessions'::regclass and attname in ('id','user_id','not_after') and not attisdropped),
 'authenticated_create_public',has_schema_privilege('authenticated','public','create'),
 'anon_create_public',has_schema_privilege('anon','public','create'),
 'authenticated_wallet_update',has_table_privilege('authenticated','public.wallets','update'),
 'authenticated_ledger_insert',has_table_privilege('authenticated','public.economy_transactions','insert'),
 'anon_confirmation_execute',has_function_privilege('anon','public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)','execute'),
 'authenticated_confirmation_execute',has_function_privilege('authenticated','public.confirm_infinitepay_cash_purchase(uuid,text,text,text,integer,text,text)','execute'),
 'authenticated_credit_helper_execute',has_function_privilege('authenticated','public._wallet_credit_cash(uuid,numeric)','execute'),
 'service_role_wallet_update',has_table_privilege('service_role','public.wallets','update'),
 'reversals_flag',(select coalesce((config#>>'{financialControls,reversalsEnabled}')='true',false) from public.economy_config where id)
) as finance_dependencies;
rollback;
