\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98a00000-0000-0000-0000-000000000001','authenticated','authenticated','home-insights@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98a00000-0000-0000-0000-000000000001';
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values('98c00000-0000-0000-0000-000000000001','evolutus_dataset','home-insights','Oficial','peito',array['peito'],'forca',array['Empurre'],'published');
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id,type)
values('98e00000-0000-0000-0000-000000000001','98a00000-0000-0000-0000-000000000001','Oficial','Peito','catalog','evolutus_dataset','home-insights','98c00000-0000-0000-0000-000000000001','strength');
select pg_temp.set_test_user('98a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
create temp table fixture_sheets as select n,public.create_workout_sheet(gen_random_uuid(),'Home '||n,
 p_items=>'[{"exercise_id":"98e00000-0000-0000-0000-000000000001"}]') result from generate_series(1,3) n;
select is(jsonb_array_length(public.get_my_sheet_insights()->'sheets'),3,'retorna fichas planejadas mesmo sem atividade');
select ok(not exists(select 1 from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s
 where s->>'last_date' is not null or (s->>'month_days')::int<>0),'planejamento não inventa atividade nem conclusão');
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',
 (now() at time zone 'America/Sao_Paulo')::date-90,1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid
 from fixture_sheets where n=1;
-- Duplicate exercise records on the same business date count as ONE activity day.
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',
 (now() at time zone 'America/Sao_Paulo')::date,1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid
 from fixture_sheets,generate_series(1,2) where n=2;
-- Previous month and future records must not inflate this month.
insert into public.workouts(user_id,exercise_id,date,sets,set_details,sheet_id)
select auth.uid(),'98e00000-0000-0000-0000-000000000001',d,1,'[{"weight":10,"reps":10}]',(result->>'id')::uuid
 from fixture_sheets cross join lateral (values
 ((date_trunc('month',now() at time zone 'America/Sao_Paulo')-interval '1 day')::date),
 (((now() at time zone 'America/Sao_Paulo')::date+1))) dates(d) where n=2;
select is((select s->>'last_date' from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s
 where s->>'id'=(select result->>'id' from fixture_sheets where n=1)),
 ((now() at time zone 'America/Sao_Paulo')::date-90)::text,'última atividade além de 60 dias permanece real');
select is((select (s->>'month_days')::int from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s
 where s->>'id'=(select result->>'id' from fixture_sheets where n=2)),1,'dias distintos, sem duplicar exercício ou incluir outro mês/futuro');
select is((select s->>'last_date' from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s
 where s->>'id'=(select result->>'id' from fixture_sheets where n=2)),
 (now() at time zone 'America/Sao_Paulo')::date::text,'data futura não altera última atividade');
select public.set_workout_sheet_archived((select (result->>'id')::uuid from fixture_sheets where n=2),true,
 (select (result->>'revision')::bigint from fixture_sheets where n=2));
select ok(exists(select 1 from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s
 where s->>'id'=(select result->>'id' from fixture_sheets where n=2) and s->>'archived_at' is not null),
 'ficha arquivada ainda pode ser última utilizada e maior atividade mensal');
reset role;
select pg_temp.set_test_user('',true);
update public.exercise_catalog set status='draft' where id='98c00000-0000-0000-0000-000000000001';
select pg_temp.set_test_user('98a00000-0000-0000-0000-000000000001',true);
set local role authenticated;
select ok(not exists(select 1 from jsonb_array_elements(public.get_my_sheet_insights()->'sheets') s where (s->>'available')::boolean),
 'resumo de disponibilidade acompanha retirada oficial sem consultas por ficha no navegador');
select is(public.get_my_sheet_insights()->>'today',(now() at time zone 'America/Sao_Paulo')::date::text,'dia vem do servidor em São Paulo');
reset role;
select pg_temp.revoke_test_session('98a00000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok('select public.get_my_sheet_insights()','P0001','SESSION_REVOKED','sessão revogada não recebe métricas');
reset role;
select * from finish();
rollback;
