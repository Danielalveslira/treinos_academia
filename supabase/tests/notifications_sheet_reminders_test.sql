\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

select pg_temp.set_test_user('', true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('b7a00000-0000-0000-0000-000000000001','authenticated','authenticated','sheet-remind@example.invalid',now(),'{}','{}',now(),now()),
       ('b7a00000-0000-0000-0000-000000000002','authenticated','authenticated','sheet-remind-other@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version, legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('b7a00000-0000-0000-0000-000000000001','b7a00000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values ('b7c00000-0000-0000-0000-000000000001','evolutus_dataset','sheet-remind','Supino','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
values ('b7e00000-0000-0000-0000-000000000001','b7a00000-0000-0000-0000-000000000001','Supino','Peito','catalog','evolutus_dataset','sheet-remind','b7c00000-0000-0000-0000-000000000001','strength'),
       ('b7e00000-0000-0000-0000-000000000002','b7a00000-0000-0000-0000-000000000002','Supino','Peito','catalog','evolutus_dataset','sheet-remind','b7c00000-0000-0000-0000-000000000001','strength');

-- Dia de referência: amanhã (UTC), para os jobs ficarem no futuro e serem antecipados no teste.
create temp table _day as select (now() at time zone 'UTC')::date + 1 as d;
grant select on _day to authenticated;

select pg_temp.set_test_user('b7a00000-0000-0000-0000-000000000001', true);
set local role authenticated;
create temp table _sheets as
  select 'today' as k, public.create_workout_sheet(gen_random_uuid(), 'Peito e Tríceps',
    p_weekdays => array[extract(dow from (select d from _day))::smallint],
    p_items => '[{"exercise_id":"b7e00000-0000-0000-0000-000000000001"}]') as r
  union all
  select 'other_day', public.create_workout_sheet(gen_random_uuid(), 'Costas e Bíceps',
    p_weekdays => array[((extract(dow from (select d from _day))::int + 1) % 7)::smallint],
    p_items => '[{"exercise_id":"b7e00000-0000-0000-0000-000000000001"}]')
  union all
  select 'empty', public.create_workout_sheet(gen_random_uuid(), 'Ficha vazia',
    p_weekdays => array[extract(dow from (select d from _day))::smallint]);
reset role;
select pg_temp.set_test_user('', true);

-- Outra conta com ficha no mesmo dia: nunca vaza para o lembrete do primeiro usuário.
insert into public.workout_sheets(user_id,name,weekdays,create_request_id)
values ('b7a00000-0000-0000-0000-000000000002','Ficha de outra conta',
  array[extract(dow from (select d from _day))::smallint], gen_random_uuid());

select is((select count(*)::int from private.planned_sheets_for_day('b7a00000-0000-0000-0000-000000000001', (select d from _day))), 1,
  'só a ficha da conta, ativa, com exercícios e marcada para o dia');
select is((select sheet_name from private.planned_sheets_for_day('b7a00000-0000-0000-0000-000000000001', (select d from _day))),
  'Peito e Tríceps', 'ficha associada explicitamente ao dia');

update public.users set training_preferences = jsonb_build_object(
  'plannedTrainingDays', to_jsonb(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']),
  'reminderEnabled', true, 'weeklyTimes', '{"1":"18:00","2":"18:00","3":"18:00","4":"18:00","5":"18:00","6":"18:00","7":"18:00"}'::jsonb,
  'timezone', 'UTC', 'effectiveFrom', current_date::text, 'updatedAt', now())
where id = 'b7a00000-0000-0000-0000-000000000001';

-- Força o job de amanhã para "agora" (mesma técnica do teste de lembretes existente).
update public.workout_reminder_jobs set status='cancelled' where user_id='b7a00000-0000-0000-0000-000000000001' and status='pending';
insert into public.workout_reminder_jobs(user_id, planned_date, kind, scheduled_at, timezone)
values ('b7a00000-0000-0000-0000-000000000001', (select d from _day), 'before', now() - interval '1 minute', 'UTC');
select is(private.dispatch_due_workout_reminders(100), 1, 'lembrete antecipado é despachado');
select is((select metadata->>'sheetName' from public.notifications
  where recipient_id='b7a00000-0000-0000-0000-000000000001' and type='workout_reminder_before'),
  'Peito e Tríceps', 'nome real da ficha vai para o metadata');
select is((select action_url from public.notifications
  where recipient_id='b7a00000-0000-0000-0000-000000000001' and type='workout_reminder_before'),
  '/novo-treino?ficha=' || (select r->>'id' from _sheets where k='today') || '&planejado=' || (select d from _day)::text,
  'toque abre a execução da ficha planejada');

-- Duas fichas no dia: só a contagem, destino no seletor; nada é escolhido arbitrariamente.
update public.workout_sheets set weekdays = array[extract(dow from (select d from _day))::smallint]
  where id = (select (r->>'id')::uuid from _sheets where k='other_day');
insert into public.workout_reminder_jobs(user_id, planned_date, kind, scheduled_at, timezone)
values ('b7a00000-0000-0000-0000-000000000001', (select d from _day), 'start', now() - interval '30 seconds', 'UTC');
select is(private.dispatch_due_workout_reminders(100), 1, 'lembrete no horário é despachado');
select is((select metadata->>'sheetCount' from public.notifications
  where recipient_id='b7a00000-0000-0000-0000-000000000001' and type='workout_reminder_start'), '2',
  'várias fichas no dia viram contagem');
select ok((select not (metadata ? 'sheetName') and action_url like '/treinar?planejado=%' from public.notifications
  where recipient_id='b7a00000-0000-0000-0000-000000000001' and type='workout_reminder_start'),
  'sem nome inventado e destino no seletor de fichas');
select ok((select read_at is not null from public.notifications
  where recipient_id='b7a00000-0000-0000-0000-000000000001' and type='workout_reminder_before'),
  'lembrete do horário substitui o antecipado ainda não lido na Central');

-- Ficha arquivada deixa de ser associada.
update public.workout_sheets set archived_at = now()
  where user_id = 'b7a00000-0000-0000-0000-000000000001';
select is((select count(*)::int from private.planned_sheets_for_day('b7a00000-0000-0000-0000-000000000001', (select d from _day))), 0,
  'ficha arquivada nunca é usada');

-- Dia de descanso continua sem lembrete.
update public.users set training_preferences = training_preferences || jsonb_build_object(
  'plannedTrainingDays', '[]'::jsonb, 'weeklyTimes', '{}'::jsonb, 'updatedAt', now())
where id = 'b7a00000-0000-0000-0000-000000000001';
insert into public.workout_reminder_jobs(user_id, planned_date, kind, scheduled_at, timezone)
values ('b7a00000-0000-0000-0000-000000000001', (select d from _day) + 1, 'start', now() - interval '1 minute', 'UTC');
select is(private.dispatch_due_workout_reminders(100), 0, 'dia de descanso não gera lembrete');

-- Controle único: ativar religa todas as categorias.
insert into public.push_notification_preferences(user_id, enabled, categories)
values ('b7a00000-0000-0000-0000-000000000002', false, '{"workouts":false,"social":false}')
on conflict (user_id) do update set enabled = false, categories = excluded.categories;
update public.push_notification_preferences set enabled = true where user_id = 'b7a00000-0000-0000-0000-000000000002';
select ok((select private.push_category_enabled(categories, 'workouts') and private.push_category_enabled(categories, 'social')
  from public.push_notification_preferences where user_id = 'b7a00000-0000-0000-0000-000000000002'),
  'ativação geral não deixa categorias bloqueadas');
update public.push_notification_preferences set enabled = false, categories = '{"social":false}'
  where user_id = 'b7a00000-0000-0000-0000-000000000002';
select is((select categories->>'social' from public.push_notification_preferences where user_id = 'b7a00000-0000-0000-0000-000000000002'),
  'false', 'desativar não reescreve categorias (só a ativação)');

select ok(not has_function_privilege('authenticated', 'private.planned_sheets_for_day(uuid,date)', 'EXECUTE'),
  'resolução de ficha não é exposta a clientes');
select ok(not has_function_privilege('authenticated', 'private.dispatch_due_workout_reminders(integer)', 'EXECUTE'),
  'despacho continua restrito ao cron/service_role');

select * from finish();
rollback;
