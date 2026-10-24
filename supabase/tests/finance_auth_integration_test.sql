\ir _helpers/auth_session.sql
begin;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('f5000000-0000-0000-0000-000000000001','authenticated','authenticated','financial-auth@example.invalid','x',now(),'{}','{}',now(),now());
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000001',true);
select ok(public.is_session_active(),'real fixture session is active');
-- pg_temp is implicitly searched before pg_catalog for relations, even with path ''.
-- A SECURITY DEFINER must qualify this catalog view rather than trust a shadow table.
create temp table pg_timezone_names(name text);
insert into pg_timezone_names values('Finance/Fake');
select throws_ok($$select public.set_training_preferences('{"plannedTrainingDays":["monday"],"reminderEnabled":false,"timezone":"Finance/Fake","effectiveFrom":"2026-10-23"}')$$,'INVALID_TIMEZONE','temporary shadow cannot inject an invalid timezone');
select lives_ok($$select public.set_training_preferences('{"plannedTrainingDays":["monday"],"reminderEnabled":false,"timezone":"UTC","effectiveFrom":"2026-10-23"}')$$,'catalog timezone remains available despite temporary shadow');
select ok(not has_function_privilege('anon','public.set_training_preferences(jsonb)','execute'),'anonymous preferences RPC denied');
select set_config('request.jwt.claims','{"sub":"f5000000-0000-0000-0000-000000000001","role":"authenticated","session_id":"malformed"}',true);
select is(public.is_session_active(),false,'malformed session identifier safely rejected');
select throws_ok($$select public.get_my_wallet()$$,'SESSION_REVOKED','malformed session cannot read wallet');
select throws_ok($$select public.set_training_preferences('{"plannedTrainingDays":[],"reminderEnabled":false,"timezone":"UTC","effectiveFrom":"2026-10-23"}')$$,'FORBIDDEN','malformed session cannot change preferences');
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000001',true);
update auth.sessions set not_after=now()-interval '1 second' where user_id='f5000000-0000-0000-0000-000000000001';
select is(public.is_session_active(),false,'expired database session rejected while JWT remains unexpired');
select throws_ok($$select public.get_my_wallet()$$,'SESSION_REVOKED','expired database session cannot read wallet');
select * from finish();
rollback;
