begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated',
  'reminder-test@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());

select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/reminder-phone',
  repeat('p', 32), repeat('a', 16), 'test', 'phone', 'android');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/reminder-laptop',
  repeat('p', 32), repeat('a', 16), 'test', 'laptop', 'windows');
select set_config('request.jwt.claim.sub', '', true);

update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  'reminderEnabled', true, 'reminderTime', '18:00', 'timezone', 'UTC',
  'effectiveFrom', current_date::text, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.workout_reminder_jobs where status = 'pending'), 2,
  'plano semanal agenda uma etapa antecipada e outra no horário');
select ok((select bool_and(timezone = 'UTC') from public.workout_reminder_jobs),
  'horários são calculados com o fuso salvo');
select is((select to_char(scheduled_at at time zone 'UTC', 'HH24:MI')
  from public.workout_reminder_jobs where kind = 'before' and status = 'pending'), '17:00',
  'lembrete antecipado usa o horário local menos uma hora');

update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute'
where kind = 'before' and status = 'pending';
select is(private.dispatch_due_workout_reminders(100), 1, 'cron cria o aviso antecipado');
select is((select count(*)::int from public.notifications where type = 'workout_reminder_before'), 1,
  'aviso entra na Central');
select is((select count(*)::int from public.notification_push_outbox o
  join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before'), 1, 'aviso entra na outbox de Push');
select is((select count(*)::int from public.claim_push_jobs('workout-reminder-test', 25)
  where notification_type = 'workout_reminder_before'), 2,
  'um job gera entrega para os dois dispositivos ativos');
select ok((select action_url like '/novo-treino?planejado=%'
  from public.notifications where type = 'workout_reminder_before'),
  'deep link abre o fluxo de treino');
select is(private.dispatch_due_workout_reminders(100), 0, 'retry não duplica o aviso');

update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute'
where kind = 'start' and status = 'pending';
select is(private.dispatch_due_workout_reminders(100), 1, 'cron cria aviso no horário');
select is((select count(*)::int from public.notifications where type = 'workout_reminder_start'), 1,
  'aviso no horário entra na Central');
select is((select count(*)::int from public.workout_reminder_jobs where status = 'pending'), 2,
  'após o envio, as próximas ocorrências são agendadas');

update public.users set training_preferences = training_preferences || jsonb_build_object(
  'reminderTime', '19:00', 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000001';
select ok((select bool_and(to_char(scheduled_at at time zone 'UTC', 'HH24:MI') =
  case when kind = 'before' then '18:00' else '19:00' end)
  from public.workout_reminder_jobs where status = 'pending'),
  'reagendar substitui os horários pendentes');

update public.users set training_preferences = training_preferences || jsonb_build_object(
  'reminderEnabled', false, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.workout_reminder_jobs where status = 'pending'), 0,
  'desligar lembrete cancela jobs futuros');

update public.users set training_preferences = training_preferences || jsonb_build_object(
  'reminderEnabled', true, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000001';
insert into public.exercises (id, user_id, name, muscle_group)
values ('a9000000-0000-0000-0000-000000000002', 'a9000000-0000-0000-0000-000000000001',
  'Exercício teste', 'Peito');
insert into public.workouts (user_id, exercise_id, set_details, sets, date)
select 'a9000000-0000-0000-0000-000000000001',
  'a9000000-0000-0000-0000-000000000002', '[{"weight":1,"reps":5}]'::jsonb, 1,
  planned_date from public.workout_reminder_jobs where kind = 'start' and status = 'pending'
  order by scheduled_at limit 1;
select is((select count(*)::int from public.workout_reminder_jobs j
  join public.workouts w on w.user_id = j.user_id and w.date = j.planned_date
  where j.status = 'pending'), 0, 'iniciar o treino cancela lembretes do dia');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a9000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated',
  'reminder-no-push@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  'reminderEnabled', true, 'reminderTime', '18:00', 'timezone', 'UTC',
  'effectiveFrom', current_date::text, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000003';
update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute'
where user_id = 'a9000000-0000-0000-0000-000000000003' and kind = 'before' and status = 'pending';
select is(private.dispatch_due_workout_reminders(100), 1, 'sem Push ativo ainda gera aviso na Central');
select is((select count(*)::int from public.notifications
  where recipient_id = 'a9000000-0000-0000-0000-000000000003' and type = 'workout_reminder_before'), 1,
  'aviso permanece na Central');
select is((select count(*)::int from public.notification_push_outbox
  where user_id = 'a9000000-0000-0000-0000-000000000003'), 0,
  'sem subscription não cria outbox');

update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['sunday']), 'reminderEnabled', true,
  'reminderTime', '02:30', 'timezone', 'America/New_York',
  'effectiveFrom', '2026-03-01', 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000003';
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000003',
  'start', '2026-03-08 00:00:00+00');
select is((select scheduled_at from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000003'
    and planned_date = '2026-03-08' and kind = 'start'),
  '2026-03-08 07:30:00+00'::timestamptz,
  'hora inexistente no início do DST avança para 03:30 local');

-- 18:00 -> 17:00 was sent -> workout starts at 17:30 -> 18:00 must not send.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a9000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated',
  'reminder-started@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  'reminderEnabled', true, 'reminderTime', '18:00', 'timezone', 'UTC',
  'effectiveFrom', current_date::text, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000004';
select is((select to_char(scheduled_at at time zone 'UTC', 'HH24:MI')
  from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000004'
    and kind = 'start' and status = 'pending'), '18:00', 'aviso final estava marcado para 18:00');
update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute'
where user_id = 'a9000000-0000-0000-0000-000000000004' and kind = 'before' and status = 'pending';
select is(private.dispatch_due_workout_reminders(100), 1, 'aviso das 17:00 enviado');
insert into public.exercises (id, user_id, name, muscle_group)
values ('a9000000-0000-0000-0000-000000000005', 'a9000000-0000-0000-0000-000000000004',
  'Exercício antecipado', 'Peito');
insert into public.workouts (user_id, exercise_id, set_details, sets, date)
select 'a9000000-0000-0000-0000-000000000004',
  'a9000000-0000-0000-0000-000000000005', '[{"weight":1,"reps":5}]'::jsonb, 1,
  planned_date from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000004' and kind = 'start' and status = 'pending';
select is((select count(*)::int from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000004' and kind = 'start' and status = 'pending'), 0,
  'treino iniciado às 17:30 cancela o job das 18:00');
select is((select count(*)::int from public.notifications
  where recipient_id = 'a9000000-0000-0000-0000-000000000004'
    and type = 'workout_reminder_start'), 0, 'aviso das 18:00 não foi gerado');

-- 18:00 -> 20:00 replaces both pending reminders, preserving the same planned day.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a9000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated',
  'reminder-rescheduled@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  'reminderEnabled', true, 'reminderTime', '18:00', 'timezone', 'UTC',
  'effectiveFrom', current_date::text, 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000006';
select is((select count(*)::int from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000006' and status = 'pending'), 2,
  'agenda inicial contém 17:00 e 18:00');
update public.users set training_preferences = training_preferences || jsonb_build_object(
  'reminderTime', '20:00', 'updatedAt', now())
where id = 'a9000000-0000-0000-0000-000000000006';
select is((select count(*)::int from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000006' and status = 'cancelled'), 2,
  'reagendamento cancela 17:00 e 18:00');
select is((select count(*)::int from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000006' and status = 'pending'
    and to_char(scheduled_at at time zone 'UTC', 'HH24:MI') in ('19:00', '20:00')), 2,
  'reagendamento cria 19:00 e 20:00');


-- ===================================================================================================
-- Cenários completos (independentes da hora em que o teste roda: comparam só horário local e contagens)
-- ===================================================================================================
create or replace function pg_temp.mk_user(p_id uuid, p_email text) returns void language sql as $$
  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (p_id, 'authenticated', 'authenticated', p_email, 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now())
$$;
create or replace function pg_temp.plan(p_id uuid, p_time text, p_tz text default 'UTC',
  p_enabled boolean default true, p_from text default '2026-01-01') returns void language sql as $$
  update public.users set training_preferences = jsonb_build_object(
    'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
    'reminderEnabled', p_enabled, 'reminderTime', case when p_enabled then p_time end, 'timezone', p_tz,
    'effectiveFrom', p_from, 'updatedAt', clock_timestamp())
  where id = p_id
$$;
create or replace function pg_temp.device(p_id uuid, p_name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', p_id::text, true);
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/' || p_name, repeat('p', 32), repeat('a', 16), 'test', p_name, 'android');
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
create or replace function pg_temp.due(p_id uuid, p_kind text) returns void language sql as $$
  update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute'
  where user_id = p_id and kind = p_kind and status = 'pending'
$$;
create or replace function pg_temp.work(p_id uuid, p_ex uuid, p_kind text default 'start') returns void language sql as $$
  insert into public.exercises (id, user_id, name, muscle_group) values (p_ex, p_id, 'Exercício ' || p_ex, 'Peito');
  insert into public.workouts (user_id, exercise_id, set_details, sets, date)
  select p_id, p_ex, '[{"weight":1,"reps":5}]'::jsonb, 1, planned_date
  from public.workout_reminder_jobs where user_id = p_id and kind = p_kind and status = 'pending' order by scheduled_at limit 1
$$;

-- (A) Push das 17:00 já ACEITO pelo provedor -> treino começa 17:30 -> o das 18:00 NÃO existe/sai
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000010', 'rem-a@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000010', 'a-phone');
select pg_temp.plan('a9000000-0000-0000-0000-000000000010', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000010', 'before');
select private.dispatch_due_workout_reminders(100);
create temp table a_claim as select * from public.claim_push_jobs('rem-a', 100)
  where notification_type = 'workout_reminder_before' and endpoint like '%a-phone';
select is((select count(*)::int from a_claim), 1, '(A) o Push das 17:00 foi entregue ao worker');
select public.finish_push_batch('rem-a', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'sent', 'http_status', 201, 'error', null)) from a_claim));
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before' and o.user_id = 'a9000000-0000-0000-0000-000000000010'), 'sent', '(A) Push das 17:00 enviado (201)');
select pg_temp.work('a9000000-0000-0000-0000-000000000010', 'a9000000-0000-0000-0000-0000000000a1');  -- 17:30: usuário inicia
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000010' and status = 'pending' and kind = 'start'), 0,
  '(A) iniciar às 17:30 cancela o job das 18:00');
update public.workout_reminder_jobs set scheduled_at = now() - interval '1 minute' where user_id = 'a9000000-0000-0000-0000-000000000010' and kind = 'start';
select is(private.dispatch_due_workout_reminders(100), 0, '(A) mesmo vencido, o das 18:00 não é despachado');
select is((select count(*)::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000010' and type = 'workout_reminder_start'), 0,
  '(A) nenhuma notificação "hora do treino" para treino já iniciado');
select is((select count(*)::int from public.claim_push_jobs('rem-a2', 100) where notification_type = 'workout_reminder_start' and endpoint like '%a-phone'), 0,
  '(A) o worker não recebe Push das 18:00');

-- (B) Push das 18:00 já ENFILEIRADO (ainda não enviado) -> usuário inicia -> sai da fila e some do sino
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000011', 'rem-b@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000011', 'b-phone');
select pg_temp.plan('a9000000-0000-0000-0000-000000000011', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000011', 'start');
select private.dispatch_due_workout_reminders(100);
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_start' and o.user_id = 'a9000000-0000-0000-0000-000000000011'), 'pending', '(B) Push das 18:00 enfileirado, ainda não enviado');
select pg_temp.work('a9000000-0000-0000-0000-000000000011', 'a9000000-0000-0000-0000-0000000000b1', 'before');
select is((select o.status || '/' || coalesce(o.last_error, '') from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_start' and o.user_id = 'a9000000-0000-0000-0000-000000000011'), 'cancelled/WORKOUT_PLAN_CHANGED', '(B) iniciar cancela o Push pendente');
select ok((select n.archived_at is not null from public.notifications n where n.type = 'workout_reminder_start' and n.recipient_id = 'a9000000-0000-0000-0000-000000000011'),
  '(B) e arquiva o aviso obsoleto da Central');
select is((select count(*)::int from public.claim_push_jobs('rem-b', 100) where notification_type = 'workout_reminder_start' and endpoint like '%b-phone'), 0,
  '(B) o worker não envia o Push cancelado');

-- (C) 18:00 -> 20:00 com Push do 17:00 JÁ enfileirado: antigos cancelados, novos 19:00 e 20:00
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000012', 'rem-c@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000012', 'c-phone');
select pg_temp.plan('a9000000-0000-0000-0000-000000000012', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000012', 'before');
select private.dispatch_due_workout_reminders(100);
select pg_temp.plan('a9000000-0000-0000-0000-000000000012', '20:00');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000012' and status = 'pending'
  and ((kind = 'before' and to_char(scheduled_at, 'HH24:MI') = '19:00') or (kind = 'start' and to_char(scheduled_at, 'HH24:MI') = '20:00'))), 2,
  '(C) novos lembretes: 19:00 (antes) e 20:00 (horário)');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000012' and status = 'pending'), 2,
  '(C) só os dois novos estão pendentes: nenhum resto do plano das 18:00');
select ok((select bool_and(status = 'cancelled') from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000012' and to_char(scheduled_at, 'HH24:MI') in ('17:00', '18:00') and status <> 'sent'),
  '(C) os jobs antigos (17:00/18:00) foram cancelados');
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before' and o.user_id = 'a9000000-0000-0000-0000-000000000012'), 'cancelled', '(C) o Push antigo ainda na fila foi cancelado');
select is((select count(*)::int from public.claim_push_jobs('rem-c', 100) where notification_type like 'workout_reminder%' and endpoint like '%c-phone'), 0, '(C) o worker não envia nada do plano antigo');

-- (D) preferência por categoria e Push global desligados: aviso na Central, sem Push
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000013', 'rem-d@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000013', 'd-phone');
update public.push_notification_preferences set categories = '{"workouts": false}'::jsonb where user_id = 'a9000000-0000-0000-0000-000000000013';
select pg_temp.plan('a9000000-0000-0000-0000-000000000013', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000013', 'before');
select private.dispatch_due_workout_reminders(100);
select is((select count(*)::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000013' and type = 'workout_reminder_before'), 1, '(D) categoria "treinos" desligada: o aviso continua na Central');
select is((select count(*)::int from public.notification_push_outbox where user_id = 'a9000000-0000-0000-0000-000000000013'), 0, '(D) …mas não gera Push');
update public.push_notification_preferences set categories = '{}'::jsonb, enabled = false where user_id = 'a9000000-0000-0000-0000-000000000013';
select pg_temp.due('a9000000-0000-0000-0000-000000000013', 'start');
select private.dispatch_due_workout_reminders(100);
select is((select count(*)::int from public.notification_push_outbox where user_id = 'a9000000-0000-0000-0000-000000000013'), 0, '(D) Push global desligado: nenhum job');

-- (E) fuso: viagem, horário de verão (ida e volta) e fuso sem DST
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000014', 'rem-e@example.invalid');
select pg_temp.plan('a9000000-0000-0000-0000-000000000014', '18:00', 'America/Sao_Paulo');
select is((select to_char(scheduled_at at time zone 'UTC', 'HH24:MI') from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000014' and kind = 'start' and status = 'pending'), '21:00',
  '(E) 18:00 em São Paulo = 21:00 UTC');
select pg_temp.plan('a9000000-0000-0000-0000-000000000014', '18:00', 'Asia/Tokyo');
select is((select to_char(scheduled_at at time zone 'UTC', 'HH24:MI') from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000014' and kind = 'start' and status = 'pending'), '09:00',
  '(E) viagem: ao salvar com outro fuso, o mesmo 18:00 passa a 09:00 UTC (Tóquio)');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending'), 2, '(E) o fuso antigo não deixa jobs pendentes');
select pg_temp.plan('a9000000-0000-0000-0000-000000000014', '18:00', 'America/New_York');
update public.workout_reminder_jobs set status = 'cancelled' where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending';
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000014', 'start', '2026-07-01 00:00:00+00');
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000014', 'start', '2026-12-01 00:00:00+00');
select is((select string_agg(to_char(scheduled_at at time zone 'UTC', 'MM-DD HH24:MI'), ' | ' order by scheduled_at) from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending'), '07-01 22:00 | 12-01 23:00',
  '(E) Nova York: 18:00 = 22:00 UTC no verão e 23:00 UTC no inverno');
update public.workout_reminder_jobs set status = 'cancelled' where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending';
update public.users set training_preferences = training_preferences || '{"reminderTime":"01:30"}'::jsonb where id = 'a9000000-0000-0000-0000-000000000014';
update public.workout_reminder_jobs set status = 'cancelled' where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending';
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000014', 'start', '2026-11-01 04:00:00+00');
select ok((select scheduled_at between '2026-11-01 05:00:00+00' and '2026-11-01 07:00:00+00' from public.workout_reminder_jobs
  where user_id = 'a9000000-0000-0000-0000-000000000014' and status = 'pending' and planned_date = '2026-11-01'),
  '(E) 01:30 ambíguo na volta do horário de verão resolve para uma única instância válida');

-- (F) salvar o MESMO plano não cancela nem reagenda; mudar algo relevante, sim
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000015', 'rem-f@example.invalid');
select pg_temp.plan('a9000000-0000-0000-0000-000000000015', '18:00');
create temp table f_before as select id from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000015' and status = 'pending';
select pg_temp.plan('a9000000-0000-0000-0000-000000000015', '18:00');  -- só muda updatedAt
select ok((select array_agg(id order by id) from f_before) = (select array_agg(id order by id) from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000015' and status = 'pending'),
  '(F) salvar o mesmo plano mantém exatamente os mesmos jobs');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000015' and status = 'cancelled'), 0, '(F) e não cancela nada');
-- o efeito que importa: um Push JÁ enfileirado não pode ser cancelado por um "salvar" sem mudança
select pg_temp.device('a9000000-0000-0000-0000-000000000015', 'f-phone');
select pg_temp.due('a9000000-0000-0000-0000-000000000015', 'before');
select private.dispatch_due_workout_reminders(100);
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before' and o.user_id = 'a9000000-0000-0000-0000-000000000015'), 'pending', '(F) aviso enfileirado aguardando o worker');
select pg_temp.plan('a9000000-0000-0000-0000-000000000015', '18:00');  -- salvar de novo, nada mudou
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before' and o.user_id = 'a9000000-0000-0000-0000-000000000015'), 'pending', '(F) salvar o mesmo plano NÃO cancela o Push já enfileirado');
select pg_temp.plan('a9000000-0000-0000-0000-000000000015', '19:00');
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'workout_reminder_before' and o.user_id = 'a9000000-0000-0000-0000-000000000015'), 'cancelled', '(F) mudar o horário cancela o Push enfileirado do horário antigo');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000015' and status = 'pending'), 2, '(F) e agenda os dois novos');

-- (G) idempotência: agendar de novo, duplicar a linha, despachar duas vezes
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000016', 'rem-g@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000016', 'g-phone');
select pg_temp.plan('a9000000-0000-0000-0000-000000000016', '18:00');
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000016', 'start');
select private.schedule_next_workout_reminder('a9000000-0000-0000-0000-000000000016', 'start');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000016' and kind = 'start' and status = 'pending'), 1, '(G) agendar duas vezes não duplica o job');
select throws_ok($$insert into public.workout_reminder_jobs (user_id, planned_date, kind, scheduled_at, timezone)
  select user_id, planned_date, kind, scheduled_at, timezone from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000016' limit 1$$,
  '23505', null, '(G) chave (usuário, dia, tipo, horário) é única');
select pg_temp.due('a9000000-0000-0000-0000-000000000016', 'start');
select is(private.dispatch_due_workout_reminders(100), 1, '(G) despacha uma vez');
select is(private.dispatch_due_workout_reminders(100), 0, '(G) o retry do cron não despacha de novo');
select is((select count(*)::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000016' and type = 'workout_reminder_start'), 1, '(G) exatamente uma notificação');
update public.workout_reminder_jobs set status = 'pending', processed_at = null where user_id = 'a9000000-0000-0000-0000-000000000016' and kind = 'start' and notification_id is not null;
select private.dispatch_due_workout_reminders(100);
select is((select count(*)::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000016' and type = 'workout_reminder_start'), 1,
  '(G) mesmo reprocessando o job, a chave da notificação impede duplicata');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.recipient_id = 'a9000000-0000-0000-0000-000000000016' and n.type = 'workout_reminder_start'), 1, '(G) e um único job de Push');

-- (H) atraso > 15 min é descartado; conta bloqueada não recebe
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000017', 'rem-h@example.invalid');
select pg_temp.plan('a9000000-0000-0000-0000-000000000017', '18:00');
update public.workout_reminder_jobs set scheduled_at = now() - interval '20 minutes' where user_id = 'a9000000-0000-0000-0000-000000000017' and kind = 'start' and status = 'pending';
select is(private.dispatch_due_workout_reminders(100), 0, '(H) lembrete atrasado em 20 min não é enviado');
select is((select status from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000017' and kind = 'start' and processed_at is not null order by id limit 1), 'skipped', '(H) fica registrado como skipped');
select is((select count(*)::int from public.workout_reminder_jobs where user_id = 'a9000000-0000-0000-0000-000000000017' and status = 'pending'), 2, '(H) e o próximo ciclo continua agendado');
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000018', 'rem-i@example.invalid');
select pg_temp.plan('a9000000-0000-0000-0000-000000000018', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000018', 'before');
update public.users set account_status = 'disabled' where id = 'a9000000-0000-0000-0000-000000000018';
select is(private.dispatch_due_workout_reminders(100), 0, '(H) conta desativada não recebe lembretes');

-- (I) variedade: dias consecutivos usam variantes diferentes; antes/horário também diferem
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000019', 'rem-j@example.invalid');
select pg_temp.plan('a9000000-0000-0000-0000-000000000019', '18:00');
update public.workout_reminder_jobs set status = 'cancelled' where user_id = 'a9000000-0000-0000-0000-000000000019';
insert into public.workout_reminder_jobs (user_id, planned_date, kind, scheduled_at, timezone)
select 'a9000000-0000-0000-0000-000000000019', d::date, 'start', now() - interval '1 minute' - (n || ' seconds')::interval, 'UTC'
from generate_series(date '2026-10-01', date '2026-10-06', interval '1 day') with ordinality as g(d, n);
select is(private.dispatch_due_workout_reminders(100), 6, '(I) seis dias consecutivos despachados');
select is((select count(distinct (metadata->>'variant'))::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000019'), 6,
  '(I) seis dias seguidos = seis variantes diferentes (sem repetir a frase)');
select ok(not exists (select 1 from (select (metadata->>'variant')::int v, lag((metadata->>'variant')::int) over (order by (metadata->>'plannedDate')) pv
  from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000019') x where v = pv),
  '(I) dias consecutivos nunca repetem a variante');

-- (J) integração: claim com urgência/TTL do catálogo, dois dispositivos, Realtime e RLS
select pg_temp.mk_user('a9000000-0000-0000-0000-000000000020', 'rem-k@example.invalid');
select pg_temp.device('a9000000-0000-0000-0000-000000000020', 'k-phone');
select pg_temp.device('a9000000-0000-0000-0000-000000000020', 'k-laptop');
select pg_temp.plan('a9000000-0000-0000-0000-000000000020', '18:00');
select pg_temp.due('a9000000-0000-0000-0000-000000000020', 'before');
select pg_temp.due('a9000000-0000-0000-0000-000000000020', 'start');
select is(private.dispatch_due_workout_reminders(100), 2, '(J) os dois lembretes saem');
create temp table k_claim as select * from public.claim_push_jobs('rem-k', 100) where endpoint like '%k-%';
select is((select count(*)::int from k_claim), 4, '(J) 2 avisos x 2 dispositivos = 4 entregas');
select is((select urgency || ':' || ttl_seconds from k_claim where notification_type = 'workout_reminder_before' limit 1), 'normal:3600', '(J) antecipado: urgência normal, TTL 1h');
select is((select urgency || ':' || ttl_seconds from k_claim where notification_type = 'workout_reminder_start' limit 1), 'high:900', '(J) no horário: urgência alta, TTL 15 min');
select ok((select bool_and(action_url like '/novo-treino?planejado=____-__-__') from k_claim), '(J) deep link abre o fluxo do treino planejado');
select ok(exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'), '(J) notifications está no Realtime');
set local role authenticated;
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000020', true);
select is((select count(*)::int from public.notifications where type::text like 'workout_reminder%'), 2, '(J) o dono enxerga os próprios avisos (RLS)');
select set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000010', true);
select is((select count(*)::int from public.notifications where recipient_id = 'a9000000-0000-0000-0000-000000000020'), 0, '(J) outro usuário não enxerga');
reset role;
select is((select count(*)::int from cron.job where jobname = 'dispatch-workout-reminders'), 1, '(J) cron de despacho único');
select ok(exists (select 1 from pg_indexes where indexname = 'workout_reminder_jobs_due_idx' and indexdef ilike '%scheduled_at%' and indexdef ilike '%pending%'), '(J) índice parcial de vencimento');

select * from finish();
rollback;
