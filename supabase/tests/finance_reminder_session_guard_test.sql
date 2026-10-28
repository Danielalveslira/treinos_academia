\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f6000000-0000-0000-0000-000000000001','authenticated','authenticated','reminder-session-admin@example.invalid','x',now(),'{}','{}',now(),now()),
('f6000000-0000-0000-0000-000000000002','authenticated','authenticated','reminder-session-buyer@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='f6000000-0000-0000-0000-000000000001';
create temp table reminder_purchase as select (pg_temp.cash_purchase_fixture('f6000000-0000-0000-0000-000000000002')->>'id')::uuid id;
insert into public.cash_purchase_reminder_emails(purchase_id,user_id,requested_by)
select id,'f6000000-0000-0000-0000-000000000002','f6000000-0000-0000-0000-000000000001' from reminder_purchase;
grant select on reminder_purchase to authenticated;
select pg_temp.set_test_user('f6000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),1,'active superadmin retains the existing batched read');
reset role;
select pg_temp.revoke_test_session('f6000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),0,'revoked JWT cannot read purchase reminder metadata');
reset role;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),1,'revocation never deletes reminder history');
select pg_temp.set_test_user('f6000000-0000-0000-0000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"f6000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"malformed"}',true);
set local role authenticated;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),0,'malformed session cannot read purchase reminder metadata');
reset role;
select pg_temp.set_test_user('f6000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),1,'new active session restores authorized access');
reset role;
select pg_temp.set_test_user('f6000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::integer from public.cash_purchase_reminder_emails where purchase_id=(select id from reminder_purchase)),0,'buyer cannot read administrative reminders');
reset role;
select ok(not has_table_privilege('anon','public.cash_purchase_reminder_emails','select'),'anonymous table read remains denied');
select * from finish();
rollback;
