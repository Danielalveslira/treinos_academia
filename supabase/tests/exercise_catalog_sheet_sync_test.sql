\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Reproduces the reported bug: superadmin renames/re-categorizes a published catalog exercise;
-- every consumer that resolves it through provider/provider_exercise_id/catalog_id (never by
-- name) must show the new value immediately, with no mass update of personal rows and no new ID
-- anywhere. Historical/personal data (sets, targets, snapshot name on legacy rows) must never be
-- touched by the catalog edit itself.
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('98f00000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'authenticated','authenticated','sheetsync-'||n||'@example.invalid',now(),'{}','{}',now(),now() from generate_series(1,1) n;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest
  from public.legal_policy p where p.id and u.id='98f00000-0000-0000-0000-000000000001';

insert into public.exercise_catalog(id,provider,provider_exercise_id,name,primary_muscle,muscles,category,instructions,status)
values
  ('98c10000-0000-0000-0000-000000000001','evolutus_dataset','sync-strength','Cadeira Flexora','posterior',array['posterior'],'forca',array['Flexione.'],'published'),
  ('98c10000-0000-0000-0000-000000000002','evolutus_dataset','sync-cardio','Esteira','cardio-geral',array['cardio-geral'],'cardio',array['Corra.'],'published');

-- Personal library rows: snapshot captured at add-time, deliberately stale (different name/
-- muscle than the catalog row they reference) -- exactly what "adicionar e nunca mais tocar"
-- produces in production.
insert into public.exercises(id,user_id,name,muscle_group,type,source,provider,provider_exercise_id,catalog_id,active)
values
  ('98e10000-0000-0000-0000-000000000001','98f00000-0000-0000-0000-000000000001','Cadeira Flexora Sentada','Posterior antigo','strength','catalog','evolutus_dataset','sync-strength','98c10000-0000-0000-0000-000000000001',true),
  ('98e10000-0000-0000-0000-000000000002','98f00000-0000-0000-0000-000000000001','Esteira Velha','Cardio antigo','cardio','catalog','evolutus_dataset','sync-cardio','98c10000-0000-0000-0000-000000000002',true),
  -- Fully custom row, no catalog reference at all: must never borrow another row's name. The
  -- trigger that validates provider+provider_exercise_id on insert/update of public.exercises
  -- (_validate_catalog_exercise_reference, 20261117000001) means a catalog-sourced row can never
  -- be created or left pointing at an id that doesn't resolve -- the "referência inválida" case
  -- from an old/removed catalog entry is already unreachable by construction, not just handled
  -- defensively here; only the custom (non-catalog) shape is a real fallback path to cover.
  ('98e10000-0000-0000-0000-000000000003','98f00000-0000-0000-0000-000000000001','Exercício Legado','Costas','strength','custom',null,null,null,true);

select pg_temp.set_test_user('98f00000-0000-0000-0000-000000000001',true);
set local role authenticated;
create temp table created as select public.create_workout_sheet(gen_random_uuid(),'Ficha','forca',null,array[]::smallint[]) result;
create temp table sheet_id as select (result->>'id')::uuid as id from created;
select lives_ok(
  $$select public.save_workout_sheet((select id from sheet_id),(select revision from public.workout_sheets where id=(select id from sheet_id)),
    '{"name":"Ficha","weekdays":[]}',
    '[{"exercise_id":"98e10000-0000-0000-0000-000000000001","target_sets":3,"reps_min":8,"reps_max":12},
      {"exercise_id":"98e10000-0000-0000-0000-000000000002","target_duration_minutes":20}]')$$,
  'ficha salva com os dois itens oficiais'
);
reset role;
-- O item 3 representa planejamento pré-existente (anexado antes de qualquer alteração de
-- catálogo): exercício totalmente personalizado. Nunca é "adicionável" por save_workout_sheet
-- (coberto por workout_sheets_test.sql, "legado não pode entrar") -- aqui simula o que já estava
-- salvo.
insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order)
values ((select id from sheet_id),'98f00000-0000-0000-0000-000000000001','98e10000-0000-0000-0000-000000000003',2);

-- The superadmin publishes a correction directly on the catalog row (the RPC path is already
-- covered by exercise_catalog_safe_pending_test.sql; this test is about propagation to
-- consumers, not about the publish RPC itself).
update public.exercise_catalog set name='Mesa Flexora Deitada',primary_muscle='posterior-coxa' where id='98c10000-0000-0000-0000-000000000001';

select pg_temp.set_test_user('98f00000-0000-0000-0000-000000000001',true);
set local role authenticated;

create temp table sheet_view as select public.get_my_workout_sheet((select id from sheet_id)) result;
select is(
  (select result->'items'->0->'exercise'->>'name' from sheet_view),
  'Mesa Flexora Deitada',
  'ficha mostra o nome oficial atualizado sem remover e readicionar o exercício'
);
select is(
  (select result->'items'->0->'exercise'->>'muscleGroup' from sheet_view),
  'posterior-coxa',
  'ficha mostra o músculo oficial atualizado'
);
select is(
  (select result->'items'->0->'exercise'->>'id' from sheet_view)::uuid,
  '98e10000-0000-0000-0000-000000000001'::uuid,
  'o ID do item da ficha não muda com a edição oficial'
);
select is(
  (select name from public.exercises where id='98e10000-0000-0000-0000-000000000001'),
  'Cadeira Flexora',
  'a edição oficial nunca sobrescreve a linha pessoal (sem atualização em massa) -- snapshot continua com o nome de quando o exercício foi adicionado'
);
select is(
  (select (result->'items'->1->>'target_duration_minutes')::int from sheet_view),
  20,
  'meta pessoal (duração) é preservada intacta ao lado do exercício oficial atualizado'
);
select is(
  (select (result->'items'->0->>'target_sets')::int from sheet_view),
  3,
  'meta pessoal (séries) é preservada intacta'
);

-- Exercício personalizado: mantém seu próprio nome, nunca associado a outro registro por
-- coincidência.
select is(
  (select result->'items'->2->'exercise'->>'name' from sheet_view),
  'Exercício Legado',
  'exercício personalizado sem catálogo mantém seu próprio nome'
);

-- list_my_workout_sheets: mesma resolução ao nível do card (chip de grupo muscular).
select is(
  (select (public.list_my_workout_sheets()->0->'muscle_groups') ? 'posterior-coxa'),
  true,
  'lista de fichas mostra o músculo oficial atualizado no chip do card'
);
select is(
  (select (public.list_my_workout_sheets()->0->'muscle_groups') ? 'Outros'),
  false,
  'lista de fichas não mostra mais o músculo antigo depois da correção'
);

-- Mudança de categoria incompatível (força -> cardio): dado histórico preservado, sinal
-- explícito de incompatibilidade, nada é apagado ou travado na leitura.
reset role;
update public.exercise_catalog set category='cardio' where id='98c10000-0000-0000-0000-000000000001';
set local role authenticated;
create temp table sheet_view2 as select public.get_my_workout_sheet((select id from sheet_id)) result;
select is(
  (select result->'items'->0->'exercise'->>'type' from sheet_view2),
  'cardio',
  'tipo resolvido ao vivo reflete a categoria oficial atual (força->cardio)'
);
select is(
  (select (result->'items'->0->'exercise'->>'typeMismatch')::boolean from sheet_view2),
  true,
  'meta de força antiga fica marcada como incompatível com a categoria nova, sem ser apagada'
);
select is(
  (select (result->'items'->0->>'target_sets')::int from sheet_view2),
  3,
  'a meta antiga (séries) continua salva intacta mesmo com a incompatibilidade sinalizada'
);
select throws_ok(
  $$select public.save_workout_sheet((select id from sheet_id),(select revision from public.workout_sheets where id=(select id from sheet_id)),'{"name":"Ficha","weekdays":[]}','[{"exercise_id":"98e10000-0000-0000-0000-000000000001","target_sets":3,"reps_min":8,"reps_max":12}]')$$,
  'P0001','SHEET_INVALID_TARGET',
  'um novo save com a meta antiga é recusado pela validação viva, consistente com o aviso'
);
update public.exercise_catalog set category='forca' where id='98c10000-0000-0000-0000-000000000001';

-- Consulta única, sem N+1: uma só chamada de função resolve todos os itens da ficha via junção
-- set-based (nunca uma consulta por item).
explain (analyze,buffers) select public.get_my_workout_sheet((select id from sheet_id));

reset role;
select finish();
rollback;
