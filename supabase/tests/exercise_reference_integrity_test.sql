\ir _helpers/auth_session.sql
begin;
select no_plan();
select pg_temp.set_test_user('',true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('98000000-0000-0000-0000-000000000001','authenticated','authenticated','refs-review@example.invalid',now(),'{}','{}',now(),now());
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id='98000000-0000-0000-0000-000000000001';
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
select ('98c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
case when n=2 then 'evolutus_original' else 'evolutus_dataset' end,
case when n<=2 then 'shared-ref' else 'ref-'||n end,
'Official '||n,'peito',array['peito'],'forca',array['Empurre'],
case when n=5 then 'draft' when n=6 then 'in_review' when n=7 then 'withdrawn' else 'published' end
from generate_series(1,9) n;

-- Only fixture construction bypasses the old reference trigger, to reproduce historical
-- inconsistencies accepted before this fix. It is re-enabled before any authenticated test.
-- FK, ownership and the phase-3 personal-write guard remain installed throughout.
alter table public.exercises disable trigger exercises_validate_catalog_reference;
insert into public.exercises(id,user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id)
select ('98e00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,
'98000000-0000-0000-0000-000000000001','Stored snapshot '||n,'Peito','catalog',
case when n=2 then 'evolutus_original' else 'evolutus_dataset' end,
case when n in (1,2) then 'shared-ref' when n in (3,8) then 'missing-'||n else 'ref-'||n end,
case when n in (1,2,8) then null when n=9 then '98c00000-0000-0000-0000-000000000005'::uuid else '98c00000-0000-0000-0000-000000000001'::uuid end
from generate_series(1,9) n;
alter table public.exercises enable trigger exercises_validate_catalog_reference;
-- A bad provider tuple with a valid FK was accepted for workouts by the old coalesce logic.
alter table public.workouts disable trigger workouts_validate_exercise_published;
insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,note)
values('98f00000-0000-0000-0000-000000000001','98000000-0000-0000-0000-000000000001',
'98e00000-0000-0000-0000-000000000003',current_date-1,1,'[{"weight":10,"reps":10}]','Preserved history');
alter table public.workouts enable trigger workouts_validate_exercise_published;

select pg_temp.set_test_user('98000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select lives_ok(format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details)
values(auth.uid(),%L,current_date,1,'[{"weight":10,"reps":10}]')$q$,
('98e00000-0000-0000-0000-'||lpad(n::text,12,'0'))),
'legacy FK-null link resolves by exact provider tuple: '||n)
from generate_series(1,2) n;
select throws_ok(format($q$insert into public.workouts(user_id,exercise_id,date,sets,set_details)
values(auth.uid(),%L,current_date,1,'[{"weight":10,"reps":10}]')$q$,
('98e00000-0000-0000-0000-'||lpad(n::text,12,'0'))),
'P0001','catalog_exercise_not_published','one valid reference never hides the missing, different or unpublished reference: '||n)
from generate_series(3,9) n;
select throws_ok($q$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id)
values(auth.uid(),'Forged','Peito','catalog','evolutus_dataset','shared-ref','98c00000-0000-0000-0000-000000000099')$q$,
'P0001','catalog_exercise_unavailable','published tuple cannot hide a nonexistent supplied catalog_id');
select throws_ok($q$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id)
values(auth.uid(),'Forged','Peito','catalog','evolutus_dataset','missing','98c00000-0000-0000-0000-000000000001')$q$,
'P0001','catalog_exercise_unavailable','valid catalog_id cannot hide a nonexistent provider tuple');
select lives_ok($q$update public.workouts set exercise_id='98e00000-0000-0000-0000-000000000003',note='Historical edit'
where id='98f00000-0000-0000-0000-000000000001'$q$,'existing malformed historical link remains editable without realocation');
select lives_ok($q$update public.exercises set note='Personal note' where id='98e00000-0000-0000-0000-000000000003'$q$,'preferences do not rewrite old references');
select is((select catalog_id from public.exercises where id='98e00000-0000-0000-0000-000000000001'),null::uuid,'legacy FK stays null; no automatic conversion');
create temp table review_sync as select public.sync_workout_mutations(jsonb_build_array(
jsonb_build_object('mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),
'payload',jsonb_build_object('exercise_id','98e00000-0000-0000-0000-000000000003','date',current_date::text,'type','strength','sets',1,'set_details','[{"weight":20,"reps":10}]'::jsonb)),
jsonb_build_object('mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),
'payload',jsonb_build_object('exercise_id','98e00000-0000-0000-0000-000000000001','date',current_date::text,'type','strength','sets',1,'set_details','[{"weight":20,"reps":10}]'::jsonb))
),auth.uid()) r;
select is((select r->'results'->0->>'code' from review_sync),'catalog_exercise_not_published','offline mismatch is a definitive business rejection');
select is((select r->'results'->1->>'status' from review_sync),'applied','valid FK-null link still syncs in the same batch');
select is((select count(*)::int from public.workouts where id='98f00000-0000-0000-0000-000000000001'),1,'old workout is not removed');
reset role;
select ok((select bool_and(tgenabled='O') from pg_trigger where tgname in ('exercises_validate_catalog_reference','workouts_validate_exercise_published')),'all validation triggers are enabled');
select finish();
rollback;
