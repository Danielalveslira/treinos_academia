\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Seed historical rows over a trusted, sessionless maintenance connection.
select pg_temp.set_test_user('', true);
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('97000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','phase3-'||n||'@example.invalid',now(),'{}','{}',now(),now()
from generate_series(1,2) n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
from public.legal_policy p where p.id and u.id in ('97000000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000002');
insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status,equipment)
select ('97c00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'evolutus_dataset','phase3-'||n,'Oficial '||n,'peito',array['peito'],'forca',array['Empurre'],
case n when 1 then 'published' when 2 then 'draft' when 3 then 'in_review' else 'withdrawn' end,'barra'
from generate_series(1,4) n;
insert into public.exercises(id,user_id,name,muscle_group,note) values
('97e00000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','Antigo','Peito','Nota histórica'),
('97e00000-0000-0000-0000-000000000002','97000000-0000-0000-0000-000000000002','De outra conta','Peito','Privado');
insert into public.workouts(id,user_id,exercise_id,date,sets,set_details,note) values
('97f00000-0000-0000-0000-000000000001','97000000-0000-0000-0000-000000000001','97e00000-0000-0000-0000-000000000001',current_date-1,1,'[{"weight":10,"reps":10}]','Treino histórico');
select pg_temp.set_test_user('97000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select is((select name from public.exercises where id='97e00000-0000-0000-0000-000000000001'),'Antigo','legado continua legível');
select is((select note from public.workouts where id='97f00000-0000-0000-0000-000000000001'),'Treino histórico','histórico preservado');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group,source) values(auth.uid(),'Novo','Peito','custom')$$,'P0001','CUSTOM_EXERCISES_DISABLED','SQL autenticado não cria personalizado');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group) values(auth.uid(),'Novo','Peito')$$,'P0001','CUSTOM_EXERCISES_DISABLED','omitir source não contorna bloqueio');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id) values(auth.uid(),'Forjado','Peito','catalog','evolutus_dataset','inexistente')$$,'P0001','catalog_exercise_unavailable','catálogo inexistente rejeitado');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id,catalog_id) values(auth.uid(),'Forjado','Peito','catalog','evolutus_dataset','phase3-1','97c00000-0000-0000-0000-000000000002')$$,'P0001','catalog_exercise_unavailable','catalog_id discordante rejeitado');
select throws_ok(format($$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id) values(auth.uid(),'Forjado','Peito','catalog','evolutus_dataset',%L)$$,'phase3-'||n),'P0001','catalog_exercise_unavailable','não publicado rejeitado: '||n)
from generate_series(2,4) n;
select lives_ok($$insert into public.exercises(id,user_id,name,muscle_group,type,equipment,source,provider,provider_exercise_id)
values('97e00000-0000-0000-0000-000000000003',auth.uid(),'Nome forjado','Grupo forjado','cardio','forjado','catalog','evolutus_dataset','phase3-1')$$,'oficial publicado pode ser adicionado');
select is((select name from public.exercises where id='97e00000-0000-0000-0000-000000000003'),'Oficial 1','nome vem do catálogo');
select is((select muscle_group from public.exercises where id='97e00000-0000-0000-0000-000000000003'),'Peito','grupo oficial calculado no servidor');
select is((select type from public.exercises where id='97e00000-0000-0000-0000-000000000003'),'strength','tipo oficial calculado no servidor');
select is((select equipment from public.exercises where id='97e00000-0000-0000-0000-000000000003'),'barra','equipamento oficial calculado no servidor');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id) values(auth.uid(),'Duplicado','Peito','catalog','evolutus_dataset','phase3-1')$$,'23505',null,'índice único atômico bloqueia duplicata');
select throws_ok(format('update public.exercises set %I=%L where id=%L',field,value,'97e00000-0000-0000-0000-000000000003'),'P0001','EXERCISE_IDENTITY_IMMUTABLE','identidade imutável: '||field)
from (values ('name','Outro'),('muscle_group','Costas'),('type','cardio'),('equipment','halter'),('source','custom'),('provider','evolutus_original'),('provider_exercise_id','phase3-2'),('catalog_id','97c00000-0000-0000-0000-000000000002')) changes(field,value);
select throws_ok($$update public.exercises set user_id='97000000-0000-0000-0000-000000000002' where id='97e00000-0000-0000-0000-000000000003'$$,'42501','FORBIDDEN','não pode transferir propriedade');
select lives_ok($$update public.exercises set note='Pessoal',active=false,"order"=1 where id='97e00000-0000-0000-0000-000000000003'$$,'nota, ativo e ordem continuam editáveis');
select lives_ok($$update public.exercises set note='Legado editado',active=false where id='97e00000-0000-0000-0000-000000000001'$$,'preferências do legado continuam editáveis');
select throws_ok($$update public.exercises set name='Clone' where id='97e00000-0000-0000-0000-000000000001'$$,'P0001','EXERCISE_IDENTITY_IMMUTABLE','legado não é renomeado/clonado');
select is((select count(*)::int from public.exercises where user_id='97000000-0000-0000-0000-000000000002'),0,'RLS impede leitura de outra conta');
with changed as (update public.exercises set note='invadido' where id='97e00000-0000-0000-0000-000000000002' returning *) select is(count(*)::int,0,'RLS impede alterar outra conta') from changed;
select lives_ok($$select public.save_exercise_order(array['97e00000-0000-0000-0000-000000000001','97e00000-0000-0000-0000-000000000003']::uuid[])$$,'reordenação continua permitida');
select lives_ok($$insert into public.workouts(id,user_id,exercise_id,date,sets,set_details) values('97f00000-0000-0000-0000-000000000002',auth.uid(),'97e00000-0000-0000-0000-000000000003',current_date,1,'[{"weight":20,"reps":10}]')$$,'novo treino oficial continua permitido');
select throws_ok($$insert into public.workouts(user_id,exercise_id,date,sets,set_details) values(auth.uid(),'97e00000-0000-0000-0000-000000000001',current_date,1,'[{"weight":20,"reps":10}]')$$,'P0001','LEGACY_EXERCISE_READ_ONLY','legado não inicia nova sessão');
select lives_ok($$update public.workouts set exercise_id='97e00000-0000-0000-0000-000000000001',note='Histórico editado' where id='97f00000-0000-0000-0000-000000000001'$$,'treino histórico continua editável com seu exercício antigo');
select throws_ok($$update public.workouts set exercise_id='97e00000-0000-0000-0000-000000000001' where id='97f00000-0000-0000-0000-000000000002'$$,'P0001','LEGACY_EXERCISE_READ_ONLY','realocação para legado bloqueada');
select throws_ok($$insert into public.workouts(user_id,exercise_id,date,sets,set_details) values(auth.uid(),'97e00000-0000-0000-0000-000000000002',current_date,1,'[{"weight":20,"reps":10}]')$$,'23503','EXERCISE_NOT_FOUND','treino não pode apontar exercício de outra conta');
select throws_ok($$delete from public.exercises where id='97e00000-0000-0000-0000-000000000001'$$,'23503',null,'FK preserva exercício com treinos históricos');

-- One old unsupported exercise creation must not poison the rest of the offline batch.
create temp table phase3_sync as select public.sync_workout_mutations(jsonb_build_array(
 jsonb_build_object('mutation_id',gen_random_uuid(),'operation','exercise.create','entity_id',gen_random_uuid(),'payload',jsonb_build_object('name','Antigo pendente','source','custom')),
 jsonb_build_object('mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),'payload',jsonb_build_object('exercise_id','97e00000-0000-0000-0000-000000000003','date',current_date::text,'type','strength','sets',1,'set_details','[{"weight":20,"reps":10}]'::jsonb)),
 jsonb_build_object('mutation_id',gen_random_uuid(),'operation','workout.create','entity_id',gen_random_uuid(),'payload',jsonb_build_object('exercise_id','97e00000-0000-0000-0000-000000000001','date',current_date::text,'type','strength','sets',1,'set_details','[{"weight":20,"reps":10}]'::jsonb))
),auth.uid()) r;
select is((select r->'results'->0->>'code' from phase3_sync),'CUSTOM_EXERCISES_DISABLED','outbox antiga recebe rejeição explícita');
select is((select r->'results'->1->>'status' from phase3_sync),'applied','outras mutações do lote continuam funcionais');
select is((select r->'results'->2->>'code' from phase3_sync),'LEGACY_EXERCISE_READ_ONLY','novo treino legado offline recebe rejeição definitiva');
reset role;
select pg_temp.set_test_user('', true);
update public.exercise_catalog set status='withdrawn' where id='97c00000-0000-0000-0000-000000000001';
select pg_temp.set_test_user('97000000-0000-0000-0000-000000000001', true);
set local role authenticated;
select throws_ok($$insert into public.workouts(user_id,exercise_id,date,sets,set_details) values(auth.uid(),'97e00000-0000-0000-0000-000000000003',current_date,1,'[{"weight":20,"reps":10}]')$$,'P0001','catalog_exercise_not_published','retirado continua bloqueado para novo treino');
select lives_ok($$update public.exercises set note='Retirado, histórico preservado' where id='97e00000-0000-0000-0000-000000000003'$$,'nota de item retirado continua permitida');
select lives_ok($$update public.workouts set note='Histórico oficial editado',exercise_id='97e00000-0000-0000-0000-000000000003' where id='97f00000-0000-0000-0000-000000000002'$$,'histórico de retirado continua editável');
reset role;
select pg_temp.revoke_test_session('97000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok($$select public.sync_workout_mutations('[]'::jsonb)$$,'P0001','SESSION_REVOKED','sessão revogada não sincroniza');
select throws_ok($$insert into public.exercises(user_id,name,muscle_group,source,provider,provider_exercise_id) values(auth.uid(),'Novo','Peito','catalog','evolutus_dataset','phase3-1')$$,'P0001','SESSION_REVOKED','sessão revogada não escreve biblioteca');
reset role;
select ok(not has_function_privilege('authenticated','public._guard_personal_exercise_write()','execute'),'trigger privilegiada não exposta como RPC');
select is((select count(*)::int from public.exercises where source='custom' and user_id='97000000-0000-0000-0000-000000000001'),1,'nenhum exercício antigo foi apagado ou convertido');
select finish();
rollback;
