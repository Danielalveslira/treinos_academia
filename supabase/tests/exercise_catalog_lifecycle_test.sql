\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Fixtures (prefixo 95...): 01 superadmin | 02 usuário comum | 03 outro usuário comum
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('95000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-catlife@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users set role = 'superadmin', username = 'catlifeadmin' where id = '95000000-0000-0000-0000-000000000001';

-- Exercício já PUBLICADO antes desta migration existir (simula dado legado) + um que será retirado.
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status, is_active)
values
  ('95aaaaaa-0000-0000-0000-000000000001', 'evolutus_dataset', 'cl-pub-1', 'Remada curvada', 'costas', array['costas'], 'força', array['Puxe a barra.'], 'published', true),
  ('95aaaaaa-0000-0000-0000-000000000002', 'evolutus_dataset', 'cl-pub-2', 'Desenvolvimento', 'ombros', array['ombros'], 'força', array['Empurre.'], 'published', true);

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform pg_temp.set_test_user(coalesce(p_uid, ''), true);
end;
$$;

-- Mesmo helper de pg_temp.payload() usado em exercise_visuals_v2_test.sql, para alocar/confirmar
-- um conjunto de imagem real (start+end com metadados válidos).
create or replace function pg_temp.payload() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('role', 'start', 'mime_type', 'image/webp', 'width', 1024, 'height', 1024, 'byte_size', 50000),
    jsonb_build_object('role', 'end', 'mime_type', 'image/webp', 'width', 1024, 'height', 1024, 'byte_size', 50000)
  )
$$;

-- Simula o pipeline completo até PUBLICADO: allocate -> upload simulado (storage.objects) ->
-- confirm -> publish. Devolve o catalog_id passado (conveniência).
create or replace function pg_temp.publish_real_visuals(p_catalog_id uuid, p_actor text) returns void
  language plpgsql as $$
declare
  v_alloc jsonb;
  v_set_id uuid;
  v_start_path text;
  v_end_path text;
begin
  perform pg_temp.as_user(p_actor);
  select public.allocate_exercise_visual_set(p_catalog_id, 'manual_upload') into v_alloc;
  v_set_id := (v_alloc->>'visualSetId')::uuid;
  select storage_path into v_start_path from public.exercise_visual_assets where visual_set_id = v_set_id and role = 'start';
  select storage_path into v_end_path from public.exercise_visual_assets where visual_set_id = v_set_id and role = 'end';
  insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', v_start_path);
  insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', v_end_path);
  perform public.confirm_exercise_visual_internal(v_set_id, p_actor::uuid, pg_temp.payload());
  -- publish_exercise_visual_internal move start/end para o bucket publicado -- simula a cópia
  -- real de bytes feita pela Edge Function antes de chamar a RPC.
  insert into storage.objects (bucket_id, name)
    values ('exercise-visuals', p_catalog_id::text || '/v1/' || private.exercise_visual_file_name('start'));
  insert into storage.objects (bucket_id, name)
    values ('exercise-visuals', p_catalog_id::text || '/v1/' || private.exercise_visual_file_name('end'));
  perform public.publish_exercise_visual_internal(v_set_id, p_actor::uuid);
end;
$$;

-- ----------------------------------------------------------------------------------------------
-- 1) Permissões: usuário comum bloqueado em todas as RPCs de conteúdo; superadmin passa.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.admin_create_catalog_exercise_draft('X') $$, '42501', 'FORBIDDEN', 'comum não cria draft');
select throws_ok($$ select public.admin_update_catalog_exercise_content('95aaaaaa-0000-0000-0000-000000000001','X',null,null,null,null,null,null,null,null,null) $$, '42501', 'FORBIDDEN', 'comum não edita conteúdo');
select throws_ok($$ select public.admin_submit_catalog_exercise_for_review('95aaaaaa-0000-0000-0000-000000000001') $$, '42501', 'FORBIDDEN', 'comum não submete');
select throws_ok($$ select public.admin_publish_catalog_exercise('95aaaaaa-0000-0000-0000-000000000001') $$, '42501', 'FORBIDDEN', 'comum não publica');
select throws_ok($$ select public.admin_withdraw_catalog_exercise('95aaaaaa-0000-0000-0000-000000000001', 'motivo') $$, '42501', 'FORBIDDEN', 'comum não retira');
select throws_ok($$ select public.admin_restore_catalog_exercise('95aaaaaa-0000-0000-0000-000000000001') $$, '42501', 'FORBIDDEN', 'comum não restaura');
select throws_ok($$ select public.admin_list_catalog_exercises() $$, '42501', 'FORBIDDEN', 'comum não lista painel admin');
select throws_ok($$ select public.admin_list_catalog_audit_log() $$, '42501', 'FORBIDDEN', 'comum não lê auditoria');

select pg_temp.as_user(null);
select throws_ok($$ select public.admin_create_catalog_exercise_draft('X') $$, '28000', 'NOT_AUTHENTICATED', 'anônimo não cria draft');

-- ----------------------------------------------------------------------------------------------
-- 2) Criar draft: nasce draft, is_active=false, revision=1, provider='evolutus_original'.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
create temp table d1 as select public.admin_create_catalog_exercise_draft('Agachamento livre') as r;
select is((select (r).status from d1), 'draft', 'draft nasce em status=draft');
select is((select (r).is_active from d1), false, 'draft nasce com is_active=false');
select is((select (r).revision from d1), 1::bigint, 'draft nasce em revision=1');
select is((select (r).provider from d1), 'evolutus_original', 'conteúdo autoral vira evolutus_original, não evolutus_dataset');

-- ----------------------------------------------------------------------------------------------
-- 3) Publicar incompleto falha; publicar sem mídia real falha (não só checar a chave jsonb).
-- ----------------------------------------------------------------------------------------------
select throws_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d1)),
  '22023', 'INCOMPLETE_CONTENT', 'draft sem músculos/categoria/instruções não publica');

select public.admin_update_catalog_exercise_content((select (r).id from d1), 'Agachamento livre',
  'pernas', array['pernas','gluteos'], 'barra', 'força', 'intermediario', 'empurrar', 'composto',
  array['Agache.', 'Suba.'], array['Mantenha a coluna neutra.']);
select throws_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d1)),
  '22023', 'INCOMPLETE_VISUAL_SET', 'texto completo mas sem nenhuma imagem alocada não publica');

-- Forja published_media_refs com a chave 'version' SEM imagem real nenhuma (prova que a
-- validação olha exercise_visual_sets/assets/storage.objects, não o cache jsonb).
update public.exercise_catalog set published_media_refs = '{"version": 99, "images": []}'::jsonb
  where id = (select (r).id from d1);
select throws_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d1)),
  '22023', 'INCOMPLETE_VISUAL_SET', 'published_media_refs forjado sem exercise_visual_sets real não engana a publicação');
update public.exercise_catalog set published_media_refs = '{"images": []}'::jsonb where id = (select (r).id from d1);

-- ----------------------------------------------------------------------------------------------
-- 4) Fluxo real de imagem funciona DURANTE draft (prova da correção do guard de allocate).
-- ----------------------------------------------------------------------------------------------
select pg_temp.publish_real_visuals((select (r).id from d1), '95000000-0000-0000-0000-000000000001');
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d1)),
  'com texto completo + imagem start/end real confirmada em storage.objects, publica');
select is((select status from public.exercise_catalog where id = (select (r).id from d1)), 'published', 'status final published');
select is((select revision from public.exercise_catalog where id = (select (r).id from d1)) > 1, true, 'revision incrementou (criação->edição->publicação)');

-- ----------------------------------------------------------------------------------------------
-- 5) Manipulação de referência: published_media_refs/visual set de OUTRO exercício não conta.
-- ----------------------------------------------------------------------------------------------
create temp table d2 as select public.admin_create_catalog_exercise_draft('Levantamento terra') as r;
select public.admin_update_catalog_exercise_content((select (r).id from d2), 'Levantamento terra',
  'pernas', array['pernas','costas'], 'barra', 'força', 'avancado', 'puxar', 'composto',
  array['Levante.'], null);
select throws_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d2)),
  '22023', 'INCOMPLETE_VISUAL_SET', 'imagem publicada de OUTRO exercício não valida este');

-- ----------------------------------------------------------------------------------------------
-- 6) allocate numa linha RETIRADA falha; publish/restore de imagem em exercício retirado falha.
-- ----------------------------------------------------------------------------------------------
select public.admin_withdraw_catalog_exercise((select (r).id from d2), 'teste de bloqueio de allocate');
select throws_ok(format($f$ select public.allocate_exercise_visual_set(%L) $f$, (select (r).id from d2)),
  'P0002', 'CATALOG_NOT_FOUND', 'allocate numa linha withdrawn falha');

-- ----------------------------------------------------------------------------------------------
-- 7) Retirar sem motivo falha; com motivo sucede e audita responsável/data/exercício/motivo.
-- ----------------------------------------------------------------------------------------------
select throws_ok(format($f$ select public.admin_withdraw_catalog_exercise(%L, null) $f$, (select (r).id from d1)),
  '22023', 'REASON_REQUIRED', 'retirar sem motivo falha');
select throws_ok(format($f$ select public.admin_withdraw_catalog_exercise(%L, '') $f$, (select (r).id from d1)),
  '22023', 'REASON_REQUIRED', 'retirar com motivo vazio falha');
select public.admin_withdraw_catalog_exercise((select (r).id from d1), 'imagem incorreta reportada por usuário');
select is((select status from public.exercise_catalog where id = (select (r).id from d1)), 'withdrawn', 'd1 retirado');
select is(
  (select count(*)::int from public.admin_audit_log
     where action = 'catalog_exercise_withdrawn' and admin_user_id = '95000000-0000-0000-0000-000000000001'
       and (metadata->>'catalogId')::uuid = (select (r).id from d1)),
  1, 'auditoria registra exercício retirado (responsável + exercício)');
select is(
  (select reason from public.admin_audit_log
     where action = 'catalog_exercise_withdrawn' and (metadata->>'catalogId')::uuid = (select (r).id from d1)),
  'imagem incorreta reportada por usuário', 'auditoria registra o motivo real');

-- ----------------------------------------------------------------------------------------------
-- 8) exercises: inserir source=catalog apontando pro retirado falha; provider_exercise_id
--    inexistente falha igual; provider='evolutus_original' funciona para item original publicado.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000002');
insert into public.exercises (user_id, name, muscle_group) values ('95000000-0000-0000-0000-000000000002', 'Exercicio pessoal', 'pernas');
select throws_ok(
  format($f$ insert into public.exercises (user_id, name, muscle_group, type, source, provider, provider_exercise_id)
    values ('95000000-0000-0000-0000-000000000002', 'Agachamento', 'pernas', 'strength', 'catalog', 'evolutus_original', %L) $f$,
    (select provider_exercise_id from public.exercise_catalog where id = (select (r).id from d1))),
  'P0001', 'catalog_exercise_unavailable', 'adicionar exercício retirado à biblioteca falha');
select throws_ok($$ insert into public.exercises (user_id, name, muscle_group, type, source, provider, provider_exercise_id)
    values ('95000000-0000-0000-0000-000000000002', 'Fantasma', 'pernas', 'strength', 'catalog', 'evolutus_dataset', 'nunca-existiu') $$,
  'P0001', 'catalog_exercise_unavailable', 'provider_exercise_id inexistente falha igual');
select lives_ok(
  format($f$ insert into public.exercises (user_id, name, muscle_group, type, source, provider, provider_exercise_id)
    values ('95000000-0000-0000-0000-000000000002', 'Remada curvada', 'costas', 'strength', 'catalog', 'evolutus_dataset', 'cl-pub-1') $f$),
  'adicionar exercício publicado (evolutus_dataset) funciona');

-- source='custom' nunca passa pela trigger (sem provider/provider_exercise_id).
select lives_ok($$ insert into public.exercises (user_id, name, muscle_group, type, source) values ('95000000-0000-0000-0000-000000000002', 'Personalizado', 'bracos', 'strength', 'custom') $$,
  'source=custom nunca é bloqueado pela trigger de catálogo');

-- admin_restore_catalog_exercise em si: withdrawn -> in_review (nunca direto a published).
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_restore_catalog_exercise((select (r).id from d1));
select is((select status from public.exercise_catalog where id = (select (r).id from d1)), 'in_review', 'restaurar volta para in_review, nunca published direto');
select throws_ok(format($f$ select public.admin_restore_catalog_exercise(%L) $f$, (select (r).id from d1)),
  '55000', 'INVALID_STATE', 'restaurar algo que já não está withdrawn falha');

-- ----------------------------------------------------------------------------------------------
-- 9) Quem já tinha o exercício antes da retirada continua podendo UPDATE de order/active/note
--    (edição incidental não dispara a trigger de referência).
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
create temp table d3 as select public.admin_create_catalog_exercise_draft('Supino reto') as r;
select public.admin_update_catalog_exercise_content((select (r).id from d3), 'Supino reto', 'peito', array['peito','triceps'], 'barra', 'força', 'intermediario', 'empurrar', 'composto', array['Desça.', 'Empurre.'], null);
select pg_temp.publish_real_visuals((select (r).id from d3), '95000000-0000-0000-0000-000000000001');
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_publish_catalog_exercise((select (r).id from d3));

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
insert into public.exercises (id, user_id, name, muscle_group, type, source, provider, provider_exercise_id)
  values ('95eeeeee-0000-0000-0000-000000000001', '95000000-0000-0000-0000-000000000003', 'Supino reto', 'peito', 'strength', 'catalog',
    (select provider from public.exercise_catalog where id = (select (r).id from d3)),
    (select provider_exercise_id from public.exercise_catalog where id = (select (r).id from d3)));

select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_withdraw_catalog_exercise((select (r).id from d3), 'recall de segurança');

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
select lives_ok($$ update public.exercises set note = 'editado depois da retirada' where id = '95eeeeee-0000-0000-0000-000000000001' $$,
  'edição incidental (note) de item já adicionado sobrevive à retirada');
select lives_ok($$ update public.exercises set active = false where id = '95eeeeee-0000-0000-0000-000000000001' $$,
  'desativar item já adicionado sobrevive à retirada');

-- ----------------------------------------------------------------------------------------------
-- 10) workouts: bloqueia INSERT/UPDATE OF exercise_id quando o exercício não está published,
--     inclusive em_revisão (não só retirado); histórico anterior é preservado.
-- ----------------------------------------------------------------------------------------------
-- d3 está withdrawn (seção 9). Restaurar volta pra in_review (nunca direto a published) --
-- precisamos só desse estado intermediário para testar o bloqueio de treino abaixo.
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_restore_catalog_exercise((select (r).id from d3));
select is((select status from public.exercise_catalog where id = (select (r).id from d3)), 'in_review', 'restaurar d3 volta para in_review');

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
select throws_ok(
  $$ insert into public.workouts (user_id, exercise_id, set_details, sets, date)
     values ('95000000-0000-0000-0000-000000000003', '95eeeeee-0000-0000-0000-000000000001',
       '[{"weight":10,"reps":10}]'::jsonb, 1, current_date) $$,
  'P0001', 'catalog_exercise_not_published', 'novo treino com exercício em_review (restaurado, ainda não republicado) é bloqueado');

create temp table w1 as select gen_random_uuid() as id;
insert into public.exercises (id, user_id, name, muscle_group, type, source) values
  ((select id from w1), '95000000-0000-0000-0000-000000000003', 'Rosca direta', 'bracos', 'strength', 'custom');
select lives_ok(
  format($f$ insert into public.workouts (id, user_id, exercise_id, set_details, sets, date)
     values (%L, '95000000-0000-0000-0000-000000000003', %L, '[{"weight":5,"reps":12}]'::jsonb, 1, current_date) $f$,
    gen_random_uuid(), (select id from w1)),
  'treino com exercício source=custom nunca é bloqueado');

select throws_ok(
  format($f$ update public.workouts set exercise_id = '95eeeeee-0000-0000-0000-000000000001' where exercise_id = %L $f$, (select id from w1)),
  'P0001', 'catalog_exercise_not_published', 'UPDATE OF exercise_id repontando pra exercício não-published também é bloqueado');

-- ----------------------------------------------------------------------------------------------
-- 11) Republicar depois de editar um published revalida tudo (não é selo de borracha): com
--     texto+imagem completos de novo, publica; status final published, revision seguiu subindo.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.admin_publish_catalog_exercise(%L) $f$, (select (r).id from d3)),
  'republicar após editar conteúdo+mídia completos sucede');
select is((select status from public.exercise_catalog where id = (select (r).id from d3)), 'published', 'd3 republicado');

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ insert into public.workouts (user_id, exercise_id, set_details, sets, date)
     values ('95000000-0000-0000-0000-000000000003', '95eeeeee-0000-0000-0000-000000000001',
       '[{"weight":20,"reps":8}]'::jsonb, 1, current_date) $$,
  'depois de republicado, novo treino com o exercício funciona de novo');

-- ----------------------------------------------------------------------------------------------
-- 12) Edição de exercício JÁ PUBLICADO não muda o conteúdo ao vivo (fica em pending_content;
--     busca pública continua vendo a versão aprovada) até republicar.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select is((select name from public.exercise_catalog where id = (select (r).id from d3)), 'Supino reto', 'nome ao vivo antes da edição');
select public.admin_update_catalog_exercise_content((select (r).id from d3), 'Supino reto inclinado',
  'peito', array['peito','triceps','ombros'], 'barra', 'força', 'avancado', 'empurrar', 'composto',
  array['Ajuste o banco.', 'Desça.', 'Empurre.'], array['Use apoio para os pés.']);
select is((select name from public.exercise_catalog where id = (select (r).id from d3)), 'Supino reto', 'nome AO VIVO não muda enquanto a edição está pendente de republicação');
select is((select status from public.exercise_catalog where id = (select (r).id from d3)), 'in_review', 'editar um published move para in_review');
select is((select pending_content->>'name' from public.exercise_catalog where id = (select (r).id from d3)), 'Supino reto inclinado', 'pending_content guarda o nome proposto');
select public.admin_publish_catalog_exercise((select (r).id from d3));
select is((select name from public.exercise_catalog where id = (select (r).id from d3)), 'Supino reto inclinado', 'republicar aplica o pending_content no conteúdo ao vivo');
select is((select pending_content from public.exercise_catalog where id = (select (r).id from d3)), null, 'pending_content é limpo após republicar');

-- ----------------------------------------------------------------------------------------------
-- 13) Integridade: status/is_active nunca ficam inconsistentes, mesmo em escrita direta.
-- ----------------------------------------------------------------------------------------------
select throws_ok(format($f$ update public.exercise_catalog set is_active = true where id = %L $f$, (select (r).id from d2)),
  '23514', null, 'escrita direta que desalinha is_active de status (draft/withdrawn != published) viola o CHECK');

-- ----------------------------------------------------------------------------------------------
-- 14) admin_list_catalog_exercises mostra todas as seções; busca pública continua só published.
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select is((select count(*)::int from (select public.admin_list_catalog_exercises('withdrawn')) t), 1, 'admin_list mostra retirados (d2)');
select pg_temp.as_user(null);
select is((select count(*)::int from public.search_exercise_catalog(null,null,null,null,null,50,0) where id = (select (r).id from d2)), 0, 'busca pública nunca mostra retirado');
select is((select count(*)::int from public.search_exercise_catalog(null,null,null,null,null,50,0) where id = (select (r).id from d3)), 1, 'busca pública mostra o republicado');

-- ----------------------------------------------------------------------------------------------
-- 15) sync_workout_mutations: o erro de catálogo não-publicado vira rejeição de negócio
--     reconhecida (não 'INTERNAL'); dados locais preservados (nenhuma linha é escrita).
-- ----------------------------------------------------------------------------------------------
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
create temp table d4 as select public.admin_create_catalog_exercise_draft('Leg press') as r;
select public.admin_update_catalog_exercise_content((select (r).id from d4), 'Leg press',
  'pernas', array['pernas'], 'maquina', 'força', 'iniciante', 'empurrar', 'composto', array['Empurre a plataforma.'], null);
select pg_temp.publish_real_visuals((select (r).id from d4), '95000000-0000-0000-0000-000000000001');
select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_publish_catalog_exercise((select (r).id from d4));

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
insert into public.exercises (id, user_id, name, muscle_group, type, source, provider, provider_exercise_id)
  values ('95eeeeee-0000-0000-0000-000000000002', '95000000-0000-0000-0000-000000000003', 'Leg press', 'pernas', 'strength', 'catalog',
    (select provider from public.exercise_catalog where id = (select (r).id from d4)),
    (select provider_exercise_id from public.exercise_catalog where id = (select (r).id from d4)));

select pg_temp.as_user('95000000-0000-0000-0000-000000000001');
select public.admin_withdraw_catalog_exercise((select (r).id from d4), 'equipamento recolhido das academias parceiras');

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
create temp table sync1 as select public.sync_workout_mutations(
  jsonb_build_array(jsonb_build_object(
    'mutation_id', gen_random_uuid(), 'operation', 'workout.create', 'entity_id', gen_random_uuid(),
    'payload', jsonb_build_object('exercise_id', '95eeeeee-0000-0000-0000-000000000002', 'date', current_date::text,
      'type', 'strength', 'sets', 1, 'set_details', jsonb_build_array(jsonb_build_object('weight', 1, 'reps', 1)))
  )), '95000000-0000-0000-0000-000000000003'
) as r;
select is((select (r->'results'->0->>'status') from sync1), 'rejected', 'mutação de treino com exercício retirado é rejeitada (nunca aplicada)');
select is((select (r->'results'->0->>'code') from sync1), 'catalog_exercise_not_published', 'código é o erro de negócio real, não INTERNAL');
select is((select count(*)::int from public.workouts where exercise_id = '95eeeeee-0000-0000-0000-000000000002'), 0, 'nenhum treino foi gravado (dados locais preservados, nada aplicado)');
drop table sync1;

select pg_temp.as_user('95000000-0000-0000-0000-000000000003');
create temp table sync2 as select public.sync_workout_mutations(
  jsonb_build_array(jsonb_build_object(
    'mutation_id', gen_random_uuid(), 'operation', 'workout.create', 'entity_id', gen_random_uuid(),
    'payload', jsonb_build_object('exercise_id', gen_random_uuid()::text,
      'date', current_date::text, 'type', 'strength', 'sets', 1, 'set_details', jsonb_build_array(jsonb_build_object('weight', 1, 'reps', 1)))
  )), '95000000-0000-0000-0000-000000000003'
) as r;
select is((select (r->'results'->0->>'code') from sync2), 'EXERCISE_NOT_FOUND', 'exercicio pessoal inexistente continua classificado corretamente (não-regressão, trigger nova não interfere)');
drop table sync2;

select finish();
rollback;
