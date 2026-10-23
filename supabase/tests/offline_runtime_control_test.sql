\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

select is((select count(*)::int from public.offline_feature_flags), 2, 'duas features controladas pelo servidor');
select is((select count(*)::int from public.offline_feature_flags where enabled or rollout_percentage <> 0), 0, 'padrão seguro: desligado e 0%');
select ok(not has_table_privilege('anon', 'public.offline_feature_flags', 'SELECT,UPDATE'), 'anon não lê/altera flags');
select ok(not has_table_privilege('authenticated', 'public.offline_feature_flags', 'SELECT,UPDATE'), 'cliente não altera flags');
select ok(has_function_privilege('authenticated', 'public.get_offline_feature_flags()', 'EXECUTE'), 'authenticated lê via RPC');
select ok(not has_function_privilege('anon', 'public.get_offline_feature_flags()', 'EXECUTE'), 'anon não lê RPC');
select ok((select relrowsecurity from pg_class where oid = 'public.offline_feature_flags'::regclass), 'flags têm RLS');
select ok((select relrowsecurity from pg_class where oid = 'public.offline_telemetry'::regclass), 'telemetria tem RLS');
select ok(not has_table_privilege('anon', 'public.offline_telemetry', 'SELECT,INSERT,UPDATE,DELETE'), 'anon não toca telemetria');
select ok(not has_table_privilege('authenticated', 'public.offline_telemetry', 'SELECT,INSERT,UPDATE,DELETE'), 'cliente não toca tabela diretamente');
select ok(has_function_privilege('authenticated', 'public.record_offline_telemetry(jsonb,uuid)', 'EXECUTE'), 'authenticated registra via RPC limitada');
select ok(not has_function_privilege('anon', 'public.record_offline_telemetry(jsonb,uuid)', 'EXECUTE'), 'anon não registra');
select ok(not has_function_privilege('authenticated', 'private.cleanup_offline_telemetry()', 'EXECUTE'), 'cliente não executa limpeza');
select ok((select count(*) = 2 from pg_indexes where tablename = 'offline_telemetry' and indexname in
  ('offline_telemetry_created_at_idx', 'offline_telemetry_user_created_idx')), 'índices de retenção e limite por usuário');
select ok((select count(*) = 0 from information_schema.columns where table_schema = 'public' and table_name = 'offline_telemetry'
  and column_name in ('token','email','payload','set_details','weight','reps','note','exercise_name')), 'schema não tem campos sensíveis');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('c5000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'telemetry-a@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('c5000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated',
  'telemetry-b@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

set local role authenticated;
select pg_temp.set_test_user( 'c5000000-0000-0000-0000-000000000001', true);
select is((public.get_offline_feature_flags()->'offline_write'->>'rollout_percentage')::numeric, 0::numeric, 'RPC retorna 0%');
select throws_ok($$update public.offline_feature_flags set enabled = true$$, '42501', null, 'cliente não liga flag');
select throws_ok($$select count(*) from public.offline_telemetry$$, '42501', null, 'cliente não lê tabela de telemetria');
select is(public.record_offline_telemetry('[{"event_type":"sync_retry","app_version":"1.0.0","schema_version":3,"pending_count":1}]'::jsonb), 1, 'evento técnico aceito');
select throws_ok($$select public.record_offline_telemetry('[{"event_type":"sync_retry"}]'::jsonb, 'c5000000-0000-0000-0000-000000000002')$$,
  'USER_MISMATCH', 'cliente A não envia telemetria como B');
select throws_ok($$select public.record_offline_telemetry('[{"event_type":"sync_retry","payload":{"set_details":[{"weight":80}]}}]'::jsonb)$$,
  'INVALID_TELEMETRY', 'payload extra é recusado');
select throws_ok($$select public.record_offline_telemetry('[{"event_type":"unknown"}]'::jsonb)$$,
  'INVALID_TELEMETRY', 'evento desconhecido é recusado');
select throws_ok($$select public.record_offline_telemetry('[{"event_type":"sync_failed","error_code":"token=abc"}]'::jsonb)$$,
  '23514', null, 'error_code livre é recusado');
reset role;
select is((select count(*)::int from public.offline_telemetry where user_id = 'c5000000-0000-0000-0000-000000000001'), 1, 'somente evento válido persiste');
select is((select event_type from public.offline_telemetry where user_id = 'c5000000-0000-0000-0000-000000000001'), 'sync_retry', 'somente tipo técnico persiste');

set local role authenticated;
select pg_temp.set_test_user( 'c5000000-0000-0000-0000-000000000002', true);
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B pode registrar primeiro lote limitado');
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B registra segundo lote');
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B registra terceiro lote');
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B registra quarto lote');
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B registra quinto lote');
select is(public.record_offline_telemetry((select jsonb_agg(jsonb_build_object('event_type','sync_started')) from generate_series(1,20))), 20, 'B registra sexto lote');
select is(public.record_offline_telemetry('[{"event_type":"sync_started"}]'::jsonb), 0, 'limite servidor de 120 por hora impede storm');
reset role;
select is((select count(*)::int from public.offline_telemetry where user_id = 'c5000000-0000-0000-0000-000000000001'), 1, 'eventos de B não alteram A');
select is((select count(*)::int from public.offline_telemetry where user_id = 'c5000000-0000-0000-0000-000000000002'), 120, 'eventos de B ficam isolados');

set local role service_role;
update public.offline_feature_flags set enabled = true, rollout_percentage = 5 where feature = 'offline_write';
reset role;
select ok((select updated_at is not null from public.offline_feature_flags where feature = 'offline_write'), 'service_role atualiza flag com timestamp');
select is((public.get_offline_feature_flags()->'offline_write'->>'rollout_percentage')::numeric, 5::numeric, 'mudança server-side visível sem build');
update public.offline_feature_flags set enabled = false where feature = 'offline_write';
select is((public.get_offline_feature_flags()->'offline_write'->>'enabled')::boolean, false, 'kill switch server-side');

update public.offline_telemetry set created_at = now() - interval '31 days';
select is(private.cleanup_offline_telemetry(), 121, 'limpeza remove eventos além de 30 dias');
select is((select count(*)::int from public.offline_telemetry), 0, 'telemetria expirada não permanece');
select ok(exists(select 1 from cron.job where jobname = 'cleanup-offline-telemetry'), 'limpeza agendada');

select * from finish();
rollback;
