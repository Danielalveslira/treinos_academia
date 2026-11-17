\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('96000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
  'catalog-safe-' || n || '@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02']) n;
update public.users set role = 'superadmin', username = 'catalogsafeadmin'
  where id = '96000000-0000-0000-0000-000000000001';
select pg_temp.set_test_user('96000000-0000-0000-0000-000000000001', true);

insert into public.exercise_catalog(id, provider, provider_exercise_id, name, primary_muscle,
  muscles, equipment, category, instructions, status, is_active, published_at)
values ('96aaaaaa-0000-0000-0000-000000000001', 'evolutus_dataset', 'chair-curl',
  'Cadeira Flexora Sentada', 'posterior', array['posterior'], 'máquina', 'força',
  array['Flexione os joelhos.'], 'published', true, now());

create temp table safe_snapshot as
select revision, (select revision from public.get_exercise_catalog_revision()) cache_revision,
  published_media_refs from public.exercise_catalog where provider_exercise_id = 'chair-curl';

select lives_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 1,
  '{"name":"Mesa Flexora Deitada"}'::jsonb) $$, 'editar só o nome do publicado');
select is((select status from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'published', 'edição pendente não altera status');
select is((select is_active from public.exercise_catalog where provider_exercise_id='chair-curl'),
  true, 'edição pendente mantém disponibilidade');
select is((select name from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'Cadeira Flexora Sentada', 'nome público antigo preservado');
select is((select pending_content->>'name' from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'Mesa Flexora Deitada', 'novo nome fica pendente');
select is((select revision from public.get_exercise_catalog_revision()),
  (select cache_revision from safe_snapshot), 'edição pendente não invalida cache público');
select is((select revision from public.exercise_catalog where provider_exercise_id='chair-curl'),
  2::bigint, 'edição pendente avança revisão para controle de concorrência');
select pg_temp.set_test_user('96000000-0000-0000-0000-000000000002', true);
insert into public.exercises(id, user_id, name, muscle_group, type, source, provider, provider_exercise_id)
values ('96eeeeee-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002',
  'Cadeira Flexora Sentada', 'posterior', 'strength', 'catalog', 'evolutus_dataset', 'chair-curl');
select lives_ok($$ insert into public.workouts(user_id, exercise_id, set_details, sets, date)
  values ('96000000-0000-0000-0000-000000000002',
    '96eeeeee-0000-0000-0000-000000000001', '[{"weight":10,"reps":10}]'::jsonb, 1, current_date) $$,
  'ficha existente pode usar exercício com edição pendente');
select pg_temp.set_test_user('96000000-0000-0000-0000-000000000001', true);
select throws_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 1,
  '{"equipment":"halteres"}'::jsonb) $$, '40001', 'CATALOG_REVISION_CONFLICT',
  'edição concorrente antiga é rejeitada');
select throws_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 1) $$,
  '40001', 'CATALOG_REVISION_CONFLICT', 'publicação com revisão antiga é rejeitada');
select lives_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 2) $$,
  'publicação textual de exercício legado sem imagens completas é permitida');
select is((select name from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'Mesa Flexora Deitada', 'novo nome publicado');
select is((select equipment from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'máquina', 'equipamento não modificado foi preservado');
select is((select published_media_refs from public.exercise_catalog where provider_exercise_id='chair-curl'),
  (select published_media_refs from safe_snapshot), 'referências de imagem preservadas');
select is((select count(*)::integer from public.exercise_catalog where provider_exercise_id='chair-curl'),
  1, 'republicação não cria duplicata');
select is((select catalog_id from public.exercises where id='96eeeeee-0000-0000-0000-000000000001'),
  '96aaaaaa-0000-0000-0000-000000000001'::uuid, 'biblioteca pessoal mantém o mesmo ID do catálogo');
select is((select count(*)::integer from public.workouts where exercise_id='96eeeeee-0000-0000-0000-000000000001'),
  1, 'histórico do treino permanece referenciado');
select isnt((select revision from public.get_exercise_catalog_revision()),
  (select cache_revision from safe_snapshot), 'publicação invalida revisão do cache público');
select is((select count(*)::integer from public.search_exercise_catalog(null,null,null,null,null,50,0)
  where id='96aaaaaa-0000-0000-0000-000000000001'), 1,
  'busca pública continua encontrando o mesmo ID');

-- JSON null and [] are accepted as optional values; malformed scalars are rejected.
select lives_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 3,
  '{"safetyNotes":null,"equipment":null}'::jsonb) $$, 'JSON null opcional pode ser salvo');
select lives_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 4) $$,
  'JSON null opcional não quebra a publicação');
select is((select equipment from public.exercise_catalog where provider_exercise_id='chair-curl'),
  null, 'JSON null opcional limpa somente o campo escolhido');
select lives_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 5,
  '{"safetyNotes":[]}'::jsonb) $$, 'array vazio opcional pode ser salvo');
select lives_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 6) $$,
  'array vazio opcional não quebra a publicação');
select is((select safety_notes from public.exercise_catalog where provider_exercise_id='chair-curl'),
  '{}'::text[], 'array vazio opcional é preservado como array vazio');
select throws_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 7,
  '{"instructions":"não é array"}'::jsonb) $$,
  '22023', 'INVALID_ARRAY_instructions', 'tipo inválido recebe erro controlado');
select lives_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 7,
  '{"instructions":[]}'::jsonb) $$,
  'array vazio pode ficar pendente sem alterar a versão pública');
select throws_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 8) $$,
  '22023', 'INSTRUCTIONS_REQUIRED', 'array obrigatório vazio bloqueia publicação');
select is((select instructions from public.exercise_catalog where provider_exercise_id='chair-curl'),
  array['Flexione os joelhos.'], 'instrução pública permanece intacta após falhas');
select public.admin_discard_catalog_exercise_pending('96aaaaaa-0000-0000-0000-000000000001', 8);

select lives_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 9,
  '{"category":"resistência"}'::jsonb) $$, 'outra alteração isolada pode ser salva');
select throws_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 9) $$,
  '40001', 'CATALOG_REVISION_CONFLICT', 'falha na publicação preserva versão pública');
select is((select category from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'força', 'categoria pública permanece intacta');
select lives_ok($$ select public.admin_discard_catalog_exercise_pending(
  '96aaaaaa-0000-0000-0000-000000000001', 10) $$,
  'descarte remove apenas a alteração pendente');
select is((select pending_content from public.exercise_catalog where provider_exercise_id='chair-curl'),
  null, 'alteração pendente descartada');
select is((select category from public.exercise_catalog where provider_exercise_id='chair-curl'),
  'força', 'descarte não altera conteúdo público');

select pg_temp.set_test_user('96000000-0000-0000-0000-000000000002', true);
select throws_ok($$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', 11, '{"name":"Invasão"}'::jsonb) $$,
  '42501', 'FORBIDDEN', 'usuário comum não edita catálogo');
select throws_ok($$ select public.admin_discard_catalog_exercise_pending(
  '96aaaaaa-0000-0000-0000-000000000001', 11) $$,
  '42501', 'FORBIDDEN', 'usuário comum não descarta edição');

select pg_temp.set_test_user('96000000-0000-0000-0000-000000000001', true);
select public.admin_withdraw_catalog_exercise('96aaaaaa-0000-0000-0000-000000000001', 'retirada intencional');
select is((select is_active from public.exercise_catalog where provider_exercise_id='chair-curl'),
  false, 'retirada intencional desativa exercício');
select throws_ok(format($f$ select public.admin_patch_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000001', %s, '{"name":"não"}'::jsonb) $f$,
  (select revision from public.exercise_catalog where provider_exercise_id='chair-curl')),
  '55000', 'INVALID_STATE', 'retirado não pode receber edição pendente');

-- A real old-bug candidate can be repaired one at a time without publishing the proposal.
insert into public.exercise_catalog(id, provider, provider_exercise_id, name, primary_muscle,
  muscles, category, instructions, status, is_active, published_at, pending_content)
values ('96aaaaaa-0000-0000-0000-000000000002', 'evolutus_dataset', 'stranded',
  'Legado publicado', 'pernas', array['pernas'], 'força', array['Agache.'],
  'in_review', false, now(), '{"name":"Nova proposta"}'::jsonb);
select lives_ok($$ select public.admin_recover_catalog_pending_publication(
  '96aaaaaa-0000-0000-0000-000000000002', 1) $$,
  'recuperação individual de publicação válida afetada');
select is((select is_active from public.exercise_catalog where provider_exercise_id='stranded'),
  true, 'versão anterior recuperada');
select is((select pending_content->>'name' from public.exercise_catalog where provider_exercise_id='stranded'),
  'Nova proposta', 'edição pendente preservada na recuperação');
select is((select count(*)::integer from public.admin_audit_log
  where action='catalog_exercise_availability_recovered' and metadata->>'catalogId'='96aaaaaa-0000-0000-0000-000000000002'),
  1, 'recuperação deixa auditoria');

insert into public.exercise_catalog(id, provider, provider_exercise_id, name, primary_muscle,
  muscles, category, instructions, status, is_active, published_at, pending_content)
values ('96aaaaaa-0000-0000-0000-000000000003', 'evolutus_dataset', 'bad-pending',
  'Versão pública', 'pernas', array['pernas'], 'força', array['Agache.'],
  'published', true, now(), '{"name":"Proposta","muscles":null,"safetyNotes":null}'::jsonb);
select throws_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000003', 1) $$,
  '22023', 'MUSCLES_REQUIRED', 'JSON null em array obrigatório gera validação controlada');
select is((select name from public.exercise_catalog where provider_exercise_id='bad-pending'),
  'Versão pública', 'erro de publicação mantém versão pública');
update public.exercise_catalog set pending_content='{"muscles":42}'::jsonb
  where provider_exercise_id='bad-pending';
select throws_ok($$ select public.admin_publish_catalog_exercise(
  '96aaaaaa-0000-0000-0000-000000000003', 2) $$,
  '22023', 'INVALID_ARRAY_muscles', 'JSON escalar em array recebe erro controlado');
select is((select is_active from public.exercise_catalog where provider_exercise_id='bad-pending'),
  true, 'falha com JSON escalar não retira exercício público');

insert into public.exercise_catalog(id, provider, provider_exercise_id, name, primary_muscle,
  muscles, category, instructions, status, is_active, published_at, pending_content)
values ('96aaaaaa-0000-0000-0000-000000000004', 'evolutus_dataset', 'restored-withdrawal',
  'Retirado anteriormente', 'pernas', array['pernas'], 'força', array['Agache.'],
  'in_review', false, now() - interval '1 day', '{"name":"Nova proposta"}'::jsonb);
insert into public.admin_audit_log(admin_user_id, action, metadata)
values ('96000000-0000-0000-0000-000000000001', 'catalog_exercise_withdrawn',
  '{"catalogId":"96aaaaaa-0000-0000-0000-000000000004"}'::jsonb);
select throws_ok($$ select public.admin_recover_catalog_pending_publication(
  '96aaaaaa-0000-0000-0000-000000000004', 1) $$,
  '55000', 'RECOVERY_NOT_ELIGIBLE', 'retirada intencional não é reparada automaticamente');

select finish();
rollback;
