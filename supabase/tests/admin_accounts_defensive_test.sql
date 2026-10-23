\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('78000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','accountdefensive'||n||'@example.invalid','unused',now(),'{}','{}',now(),now() from generate_series(1,4) n;
update public.users set role='superadmin' where id='78000000-0000-0000-0000-000000000001';
update public.users set account_status='disabled' where id='78000000-0000-0000-0000-000000000003';
create temp table account_calls(signature text, query text);
insert into account_calls values
('admin_accounts_snapshot()', 'select public.admin_accounts_snapshot()'),
('admin_account_communities(uuid)', $$select public.admin_account_communities('78000000-0000-0000-0000-000000000004')$$),
('admin_account_financial(uuid)', $$select public.admin_account_financial('78000000-0000-0000-0000-000000000004')$$),
('admin_list_audit_log(uuid,integer)', 'select public.admin_list_audit_log()'),
('admin_set_accounts_status(uuid[],boolean,text)', $$select public.admin_set_accounts_status(array['78000000-0000-0000-0000-000000000004']::uuid[],true,'fixture reason')$$),
('admin_request_account_deletion(uuid,text)', $$select public.admin_request_account_deletion('78000000-0000-0000-0000-000000000004','fixture reason')$$),
('set_account_status(uuid,boolean,text)', $$select public.set_account_status('78000000-0000-0000-0000-000000000004',true,'fixture reason')$$);
select ok(not has_function_privilege('anon','public.'||signature,'EXECUTE'), 'anon denied '||signature) from account_calls;
select ok(not has_function_privilege('public','public.'||signature,'EXECUTE'), 'PUBLIC denied '||signature) from account_calls;
select ok(p.prosecdef and p.proconfig @> array['search_path=public, pg_temp'], 'definer / controlled path '||signature) from account_calls c join pg_proc p on p.oid=('public.'||c.signature)::regprocedure;
grant select on account_calls to authenticated, anon;
set local role authenticated;
select pg_temp.set_test_user('78000000-0000-0000-0000-000000000002',true);
select throws_ok(query,'PERMISSION_DENIED','member denied '||signature) from account_calls;
select pg_temp.set_test_user('78000000-0000-0000-0000-000000000003',true);
select throws_ok(query,'PERMISSION_DENIED','disabled member denied '||signature) from account_calls;
select pg_temp.set_test_user('',true);
select throws_ok(query,'PERMISSION_DENIED','no session denied '||signature) from account_calls;
reset role;
set local role anon;
select throws_ok(query,'42501',null,'anon execute denied '||signature) from account_calls;
reset role;
set local role authenticated;
select is((select count(*)::integer from public.admin_audit_log),0,'RLS denies direct audit read');
select throws_ok($$update public.users set role='superadmin' where id='78000000-0000-0000-0000-000000000002'$$,'42501', 'permission denied for table users','cannot promote via generic update');
reset role;
select pg_temp.set_test_user('78000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.admin_account_financial('78000000-0000-0000-0000-000000000004')$$,'superadmin reads authorized other object');
select throws_ok($$select public.admin_set_accounts_status(array[null]::uuid[],true,'fixture reason')$$,'INVALID_ARGUMENT','null target rejected');
select throws_ok($$select public.admin_set_accounts_status(array[]::uuid[],true,'fixture reason')$$,'INVALID_ARGUMENT','empty rejected');
select throws_ok($$select public.admin_set_accounts_status(array_fill('78000000-0000-0000-0000-000000000004'::uuid,array[101]),true,'fixture reason')$$,'INVALID_ARGUMENT','101 rejected before deduplication');
select throws_ok($$select public.admin_set_accounts_status(array['78000000-0000-0000-0000-000000000004']::uuid[],null,'fixture reason')$$,'INVALID_ARGUMENT','null action rejected');
select throws_ok($$select public.set_account_status('78000000-0000-0000-0000-000000000004',false,repeat('x',501))$$,'INVALID_REASON','reactivation reason bounded');
select is(jsonb_array_length(public.admin_set_accounts_status(array['78000000-0000-0000-0000-000000000004','78000000-0000-0000-0000-000000000004']::uuid[],true,'fixture reason')),1,'duplicate IDs single result');
select lives_ok($$select public.set_account_status('78000000-0000-0000-0000-000000000004',true,'different reason')$$,'replay succeeds');
select is((select count(*)::int from public.admin_audit_log where target_user_id='78000000-0000-0000-0000-000000000004'),1,'replay no duplicate audit');
select is((select disabled_reason from public.users where id='78000000-0000-0000-0000-000000000004'),'fixture reason','replay preserves original evidence');
select is((public.admin_set_accounts_status(array['78000000-0000-0000-0000-000000000001','78000000-0000-0000-0000-000000000002']::uuid[],true,'fixture reason')->0->>'error'),'CANNOT_DISABLE_ADMIN','partial result protects superadmin');
select lives_ok($$select public.admin_request_account_deletion('78000000-0000-0000-0000-000000000004','fixture deletion')$$,'uses existing queue');
select lives_ok($$select public.admin_request_account_deletion('78000000-0000-0000-0000-000000000004','fixture deletion')$$,'deletion replay');
select is((select count(*)::int from public.admin_audit_log where target_user_id='78000000-0000-0000-0000-000000000004' and action='account_deletion_requested'),1,'deletion replay one audit');
select throws_ok($$select public.set_account_status('78000000-0000-0000-0000-000000000004',false)$$,'ACCOUNT_DELETING','deleting not reactivated');
select throws_ok($$update public.admin_audit_log set reason='tampered' where target_user_id='78000000-0000-0000-0000-000000000004'$$,'ADMIN_AUDIT_LOG_IMMUTABLE','audit immutable');
select throws_ok($$select public.admin_list_audit_log(null,101)$$,'INVALID_ARGUMENT','log bound');
select throws_ok($$select public.admin_list_audit_log(null,null)$$,'INVALID_ARGUMENT','null log limit denied');
select throws_ok($$select public.admin_set_accounts_status(array[['78000000-0000-0000-0000-000000000004'],['78000000-0000-0000-0000-000000000002']]::uuid[],true,'fixture reason')$$,'INVALID_ARGUMENT','multidimensional IDs denied');

-- ===== Sessão revogada (20261113000003 + 20261114000001): superadmin de verdade, mas o JWT já
-- não tem sessão em auth.sessions -- "sair de todos os dispositivos" em outro aparelho, ainda
-- dentro do prazo do access token. A checagem de sessão vem ANTES de qualquer mutação (nenhum
-- alvo é afetado). Desde 20261114000001, is_superadmin() JÁ embute private.current_session_active()
-- -- então o código observado aqui é PERMISSION_DENIED (o gate de is_superadmin() nega primeiro),
-- não o SESSION_REVOKED explícito destas 3 funções (que seguem como defesa em profundidade, mas
-- ficam inalcançáveis enquanto is_superadmin() for a ÚNICA porta de entrada de cada uma). O que
-- importa para este teste é o resultado -- nenhuma mutação acontece com a sessão revogada --, não
-- qual das duas camadas disparou.
select pg_temp.set_test_user('78000000-0000-0000-0000-000000000001',true);
select pg_temp.revoke_test_session('78000000-0000-0000-0000-000000000001');
select throws_ok($$select public.set_account_status('78000000-0000-0000-0000-000000000002',true,'fixture reason')$$,'PERMISSION_DENIED','set_account_status nega sessão revogada (is_superadmin() já embute a checagem)');
select throws_ok($$select public.admin_set_accounts_status(array['78000000-0000-0000-0000-000000000002']::uuid[],true,'fixture reason')$$,'PERMISSION_DENIED','admin_set_accounts_status nega sessão revogada no próprio gate, antes do lote');
select throws_ok($$select public.admin_request_account_deletion('78000000-0000-0000-0000-000000000002','fixture reason')$$,'PERMISSION_DENIED','admin_request_account_deletion nega sessão revogada');
select is((select account_status from public.users where id='78000000-0000-0000-0000-000000000002'),'active','alvo não foi afetado pela tentativa com sessão revogada');
-- Sessão de novo ativa (novo login): as mesmas chamadas voltam a funcionar, sem precisar de nenhum mecanismo extra.
select pg_temp.set_test_user('78000000-0000-0000-0000-000000000001',true);
select lives_ok($$select public.set_account_status('78000000-0000-0000-0000-000000000002',true,'fixture reason')$$,'sessão ativa de novo: volta a funcionar');

select * from finish();
rollback;
