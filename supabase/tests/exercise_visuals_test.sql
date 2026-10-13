begin;
select no_plan();

-- Fixtures (prefixo 92...): 01 superadmin | 02 usuário comum
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('92000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-exvisuals@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02']) as n;
update public.users set role = 'superadmin', username = 'superadminvisuals' where id = '92000000-0000-0000-0000-000000000001';

insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, source_media_refs)
values
  ('92aaaaaa-0000-0000-0000-000000000001', 'evolutus_dataset', 'ev-visual-1', 'Supino reto teste', 'peito', array['peito'], 'força', array['Empurre.'], '{"images":["Bench_Press/0.jpg","Bench_Press/1.jpg"]}'),
  ('92aaaaaa-0000-0000-0000-000000000002', 'evolutus_dataset', 'ev-visual-2', 'Agachamento teste', 'pernas', array['pernas'], 'força', array['Agache.'], '{"images":[]}');
update public.exercise_catalog set media_refs = '{"images":["Legacy/0.jpg"]}' where id = '92aaaaaa-0000-0000-0000-000000000001';
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions)
values ('92aaaaaa-0000-0000-0000-000000000004', 'evolutus_dataset', 'ev-visual-4', 'Rosca sem miniatura', 'biceps', array['biceps'], 'força', array['Flexione.']);
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, is_active)
values ('92aaaaaa-0000-0000-0000-000000000003', 'evolutus_dataset', 'ev-visual-3', 'Inativo teste', 'peito', array['peito'], 'força', array['x'], false);

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims', coalesce((
    case when p_uid is null then null else jsonb_build_object('sub', p_uid, 'role', 'authenticated') end
  )::text, ''), true);
end;
$$;

create or replace function pg_temp.confirm_payload(p_roles text[]) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'role', r, 'mime_type', 'image/webp', 'width', 1024, 'height', 1024, 'byte_size', 50000)), '[]'::jsonb)
  from unnest(p_roles) r
$$;

-- ----------------------------------------------------------------------------
-- Contrato
-- ----------------------------------------------------------------------------
select has_column('public', 'exercise_catalog', 'source_media_refs', 'source_media_refs existe');
select has_column('public', 'exercise_catalog', 'media_refs', 'media_refs LEGADO continua existindo (frontend antigo)');
select has_column('public', 'exercise_catalog', 'published_media_refs', 'published_media_refs existe');
select is((select published_media_refs from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '{"images":[]}'::jsonb,
  'published_media_refs começa vazio (mídia do dataset não é oficial)');
select is((select count(*)::int from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1' and active), 1, 'style profile EVOLUTUS_FITNESS_V1 existe');
select is((select count(*)::int from storage.buckets where id in ('exercise-visual-drafts', 'exercise-visuals', 'exercise-visual-references')), 3, 'três buckets criados');
select is((select public from storage.buckets where id = 'exercise-visuals'), true, 'exercise-visuals é público');
select is((select public from storage.buckets where id = 'exercise-visual-drafts'), false, 'drafts é privado');
select is((select public from storage.buckets where id = 'exercise-visual-references'), false, 'references é privado');
select is(has_function_privilege('authenticated', 'public.publish_exercise_visual_internal(uuid, uuid)', 'execute'), false, 'publish interno não é chamável por authenticated');
select is(has_function_privilege('authenticated', 'public.confirm_exercise_visual_internal(uuid, uuid, jsonb)', 'execute'), false, 'confirm interno não é chamável por authenticated');
select is(has_function_privilege('anon', 'public.allocate_exercise_visual_set(uuid, text, text, jsonb, uuid, uuid, text, text, text)', 'execute'), false, 'anon não aloca');

-- ----------------------------------------------------------------------------
-- 1) usuário normal não cria visual set; sem auth também não
-- ----------------------------------------------------------------------------
select pg_temp.as_user(null);
select throws_ok($$ select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000001') $$, '28000', 'NOT_AUTHENTICATED', 'sem auth não aloca');
select pg_temp.as_user('92000000-0000-0000-0000-000000000002');
select throws_ok($$ select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000001') $$, '42501', 'FORBIDDEN', 'usuário comum não aloca');

-- ----------------------------------------------------------------------------
-- 2) superadmin cria
-- ----------------------------------------------------------------------------
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000003') $$, 'P0002', 'CATALOG_NOT_FOUND', 'exercício inativo não aloca');
select throws_ok($$ select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000001', 'gemini_api') $$, '22023', 'INVALID_ARGUMENT', 'fonte ainda não suportada é recusada');

create temp table alloc as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000001', 'gemini_manual', 'v1', '{"referenceAssets":["character-side-v1"]}') as r;
grant all on alloc to public;

select is((select (r->>'version')::int from alloc), 1, 'primeira versão é 1');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from alloc)), 3, 'aloca start, end e thumbnail');
select is((select r->'assets'->'start'->>'path' from alloc),
  '92aaaaaa-0000-0000-0000-000000000001/' || (select r->>'visualSetId' from alloc) || '/start.webp', 'path de draft = {catalog}/{set}/start.webp');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'allocated', 'status allocated');
select is((select metadata->>'styleVersion' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'EVOLUTUS_FITNESS_V1', 'proveniência: styleVersion (a migration V2 não troca o perfil ativo)');
select is((select metadata->'referenceAssets'->>0 from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'character-side-v1', 'proveniência: metadata do chamador mesclado');
select is((select created_by::text from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), '92000000-0000-0000-0000-000000000001', 'created_by registrado');

-- ----------------------------------------------------------------------------
-- 3) só paths alocados aceitam upload (e só do dono superadmin)
-- ----------------------------------------------------------------------------
set local role authenticated;
select lives_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', %L) $f$, (select r->'assets'->'start'->>'path' from alloc)),
  'superadmin sobe no path alocado');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', 'qualquer/caminho/inventado.webp') $$,
  '42501', null, 'path não alocado é recusado');
select throws_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visuals', %L) $f$, (select r->'assets'->'start'->>'path' from alloc)),
  '42501', null, 'cliente não escreve no bucket público');
reset role;
select pg_temp.as_user('92000000-0000-0000-0000-000000000002');
set local role authenticated;
select throws_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', %L) $f$, (select r->'assets'->'end'->>'path' from alloc)),
  '42501', null, 'usuário comum não sobe nem no path alocado');
reset role;

-- ----------------------------------------------------------------------------
-- 4) não publica conjunto incompleto / fora de review
-- ----------------------------------------------------------------------------
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc)),
  '55000', 'INVALID_STATE', 'não publica set que ainda não foi confirmado');
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
    (select r->>'visualSetId' from alloc), pg_temp.confirm_payload(array['start', 'thumbnail'])::text),
  '22023', 'INCOMPLETE_VISUAL_SET', 'confirm sem end é recusado');
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
    (select r->>'visualSetId' from alloc), pg_temp.confirm_payload(array['start', 'end', 'end'])::text),
  '22023', 'INCOMPLETE_VISUAL_SET', 'confirm com papel repetido é recusado');
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000002', %L::jsonb) $f$,
    (select r->>'visualSetId' from alloc), pg_temp.confirm_payload(array['start', 'end', 'thumbnail'])::text),
  '42501', 'UPLOAD_NOT_AUTHORIZED', 'confirm de set alheio é recusado');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'allocated', 'set continua allocated após confirms inválidos');

select lives_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
    (select r->>'visualSetId' from alloc), pg_temp.confirm_payload(array['start', 'end', 'thumbnail'])::text), 'confirm completo funciona');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'review', 'status review após confirm');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from alloc) and width = 1024), 3, 'metadados dos assets registrados');
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
    (select r->>'visualSetId' from alloc), pg_temp.confirm_payload(array['start', 'end', 'thumbnail'])::text),
  '42501', 'UPLOAD_NOT_AUTHORIZED', 'confirm não roda duas vezes');

-- set incompleto em review (asset sem metadados) não publica
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
create temp table alloc_inc as
  select (select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000002')) as r;
grant all on alloc_inc to public;
update public.exercise_visual_sets set status = 'review' where id = (select (r->>'visualSetId')::uuid from alloc_inc);
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc_inc)),
  '22023', 'INCOMPLETE_VISUAL_SET', 'não publica set incompleto');
update public.exercise_visual_sets set status = 'failed' where id = (select (r->>'visualSetId')::uuid from alloc_inc);

-- ----------------------------------------------------------------------------
-- 5) publicar v1
-- ----------------------------------------------------------------------------
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000002') $f$, (select r->>'visualSetId' from alloc)),
  '42501', 'FORBIDDEN', 'publicar exige um superadmin como ator');
select lives_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc)), 'publica v1');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'published', 'v1 published');
select is((select approved_by::text from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), '92000000-0000-0000-0000-000000000001', 'approved_by registrado');
select ok((select approved_at is not null and published_at is not null from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'approved_at/published_at registrados');
select is((select published_media_refs from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'),
  '{"version":1,"images":[{"role":"start","path":"92aaaaaa-0000-0000-0000-000000000001/v1/start.webp"},{"role":"end","path":"92aaaaaa-0000-0000-0000-000000000001/v1/end.webp"}],"thumbnail":{"path":"92aaaaaa-0000-0000-0000-000000000001/v1/thumb.webp"}}'::jsonb,
  'published_media_refs aponta para a v1');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from alloc) and storage_bucket = 'exercise-visuals'), 3, 'assets passam para o bucket público');
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc)),
  '55000', 'INVALID_STATE', 'não publica duas vezes o mesmo set');

-- ----------------------------------------------------------------------------
-- 6) v2 publicada arquiva a v1; só uma publicada
-- ----------------------------------------------------------------------------
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
create temp table alloc2 as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000001', 'manual_upload') as r;
grant all on alloc2 to public;
select is((select (r->>'version')::int from alloc2), 2, 'segunda versão é 2');
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc2), '92000000-0000-0000-0000-000000000001', pg_temp.confirm_payload(array['start', 'end', 'thumbnail']));
select public.publish_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc2), '92000000-0000-0000-0000-000000000001');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'archived', 'v1 virou archived');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc2)), 'published', 'v2 published');
select is((select count(*)::int from public.exercise_visual_sets where catalog_id = '92aaaaaa-0000-0000-0000-000000000001' and status = 'published'), 1, 'apenas uma versão publicada');
select is((select published_media_refs->>'version' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '2', 'catálogo aponta para a v2');
select throws_ok($$ update public.exercise_visual_sets set status = 'published' where id = (select (r->>'visualSetId')::uuid from alloc) $$,
  '23505', null, 'índice parcial impede duas publicadas');

-- ----------------------------------------------------------------------------
-- 7) rollback
-- ----------------------------------------------------------------------------
select pg_temp.as_user('92000000-0000-0000-0000-000000000002');
select throws_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from alloc)), '42501', 'FORBIDDEN', 'usuário comum não faz rollback');
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
select throws_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from alloc2)), '55000', 'INVALID_STATE', 'não restaura a versão que já está publicada');
select lives_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from alloc)), 'rollback para a v1');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc)), 'published', 'v1 voltou a published');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc2)), 'archived', 'v2 virou archived');
select is((select published_media_refs->'images'->0->>'path' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'),
  '92aaaaaa-0000-0000-0000-000000000001/v1/start.webp', 'published_media_refs voltou para a v1');
select is((select count(*)::int from public.exercise_visual_sets where catalog_id = '92aaaaaa-0000-0000-0000-000000000001' and status = 'published'), 1, 'continua só uma publicada');


-- ----------------------------------------------------------------------------
-- 7b) miniatura é opcional no servidor: start/end válidos nunca ficam irrecuperáveis
-- ----------------------------------------------------------------------------
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
create temp table alloc4 as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000004') as r;
grant all on alloc4 to public;
select is((select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc4), '92000000-0000-0000-0000-000000000001', pg_temp.confirm_payload(array['start', 'end']))->>'hasThumbnail'), 'false', 'confirm sem miniatura é aceito (hasThumbnail=false)');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from alloc4)), 2, 'a linha reservada da miniatura é removida (conjunto consistente)');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc4)), 'review', 'conjunto sem miniatura vai para revisão');
select lives_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc4)), 'publica conjunto sem miniatura');
select is((select published_media_refs from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000004'),
  '{"version":1,"images":[{"role":"start","path":"92aaaaaa-0000-0000-0000-000000000004/v1/start.webp"},{"role":"end","path":"92aaaaaa-0000-0000-0000-000000000004/v1/end.webp"}]}'::jsonb,
  'published_media_refs sem a chave thumbnail (nunca path nulo)');
create temp table alloc5 as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000004') as r;
grant all on alloc5 to public;
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc5), '92000000-0000-0000-0000-000000000001', pg_temp.confirm_payload(array['start', 'end', 'thumbnail']));
select public.publish_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc5), '92000000-0000-0000-0000-000000000001');
select is((select published_media_refs->'thumbnail'->>'path' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000004'), '92aaaaaa-0000-0000-0000-000000000004/v2/thumb.webp', 'v2 com miniatura publica a miniatura versionada junto');
select lives_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from alloc4)), 'rollback para a v1 (sem miniatura)');
select is((select published_media_refs->>'version' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000004'), '1', 'rollback restaura a v1');
select is((select published_media_refs ? 'thumbnail' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000004'), false, 'rollback restaura o conjunto exato: sem miniatura da v2 vazando');
select lives_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from alloc5)), 'rollback de volta para a v2');
select is((select published_media_refs->'thumbnail'->>'path' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000004'), '92aaaaaa-0000-0000-0000-000000000004/v2/thumb.webp', 'rollback restaura a miniatura da v2');
-- miniatura reservada mas nunca confirmada (linha sem metadados) não publica: upload incompleto
create temp table alloc6 as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000002') as r;
grant all on alloc6 to public;
update public.exercise_visual_assets set mime_type = 'image/webp', byte_size = 10, width = 64, height = 64
  where visual_set_id = (select (r->>'visualSetId')::uuid from alloc6) and role in ('start', 'end');
update public.exercise_visual_sets set status = 'review' where id = (select (r->>'visualSetId')::uuid from alloc6);
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc6)),
  '22023', 'INCOMPLETE_VISUAL_SET', 'miniatura reservada e não confirmada bloqueia a publicação (nada pela metade)');
update public.exercise_visual_sets set status = 'failed' where id = (select (r->>'visualSetId')::uuid from alloc6);

-- ----------------------------------------------------------------------------
-- 8) rejeição
-- ----------------------------------------------------------------------------
create temp table alloc3 as
  select public.allocate_exercise_visual_set('92aaaaaa-0000-0000-0000-000000000002') as r;
grant all on alloc3 to public;
select throws_ok(format($f$ select public.reject_exercise_visual_set(%L, 'x') $f$, (select r->>'visualSetId' from alloc3)), '55000', 'INVALID_STATE', 'só rejeita set em review');
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from alloc3), '92000000-0000-0000-0000-000000000001', pg_temp.confirm_payload(array['start', 'end', 'thumbnail']));
select pg_temp.as_user('92000000-0000-0000-0000-000000000002');
select throws_ok(format($f$ select public.reject_exercise_visual_set(%L, 'x') $f$, (select r->>'visualSetId' from alloc3)), '42501', 'FORBIDDEN', 'usuário comum não rejeita');
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
select lives_ok(format($f$ select public.reject_exercise_visual_set(%L, 'anatomia errada') $f$, (select r->>'visualSetId' from alloc3)), 'superadmin rejeita');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc3)), 'rejected', 'status rejected');
select is((select metadata->'rejection'->>'reason' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from alloc3)), 'anatomia errada', 'motivo registrado');
select is((select published_media_refs from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000002'), '{"images":[]}'::jsonb, 'rejeitar não altera o catálogo');
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '92000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from alloc3)),
  '55000', 'INVALID_STATE', 'set rejeitado não publica');

-- ----------------------------------------------------------------------------
-- 9) reimportar o catálogo não toca na mídia publicada
-- (o importador faz upsert sem a coluna published_media_refs -- ver exercise-catalog-import-core.mjs)
-- ----------------------------------------------------------------------------
insert into public.exercise_catalog (provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, source_media_refs)
values ('evolutus_dataset', 'ev-visual-1', 'Supino reto teste (reimportado)', 'peito', array['peito'], 'força', array['Empurre.'], '{"images":["Bench_Press/NEW.jpg"]}')
on conflict (provider, provider_exercise_id) do update set
  name = excluded.name, source_media_refs = excluded.source_media_refs;
select is((select source_media_refs->'images'->>0 from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), 'Bench_Press/NEW.jpg', 'reimportação atualiza source_media_refs');
select is((select published_media_refs->>'version' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '1', 'reimportação não altera published_media_refs');
select is((select media_refs from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '{"images":["Legacy/0.jpg"]}'::jsonb, 'reimportação nova não altera o media_refs LEGADO nesta fase');

-- ----------------------------------------------------------------------------
-- 9b) compatibilidade com o frontend/importador ANTIGOS (expand/contract)
-- ----------------------------------------------------------------------------
select lives_ok($$ select id, provider, provider_exercise_id, name, primary_muscle, muscles, equipment, category, difficulty, force, mechanic, instructions, media_refs
  from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001' $$, 'getExerciseDetail antigo (select media_refs) continua funcionando');
select is((select media_refs from public.search_exercise_catalog('Supino reto teste', null, null, null, null, 5, 0) where id = '92aaaaaa-0000-0000-0000-000000000001'),
  '{"images":["Legacy/0.jpg"]}'::jsonb, 'search_exercise_catalog continua devolvendo media_refs (frontend antigo)');
select is((select count(*)::int from public.search_exercise_catalog('Supino reto teste', null, null, null, null, 5, 0) where id = '92aaaaaa-0000-0000-0000-000000000001' and total_count is not null), 1, 'total_count continua no retorno');
-- upsert do importador ANTIGO (media_refs) continua válido e não toca a mídia oficial
insert into public.exercise_catalog (provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, media_refs)
values ('evolutus_dataset', 'ev-visual-1', 'Supino reto teste (reimportado)', 'peito', array['peito'], 'força', array['Empurre.'], '{"images":["Old/importer.jpg"]}')
on conflict (provider, provider_exercise_id) do update set name = excluded.name, media_refs = excluded.media_refs;
select is((select published_media_refs->>'version' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '1', 'importador antigo também não altera published_media_refs');
select is((select source_media_refs->'images'->>0 from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), 'Bench_Press/NEW.jpg', 'importador antigo não mexe no source_media_refs do novo');

-- ----------------------------------------------------------------------------
-- 10) leitura pública e drafts fechados
-- ----------------------------------------------------------------------------
select pg_temp.as_user(null);
set local role anon;
select is((select published_media_refs->>'version' from public.exercise_catalog where id = '92aaaaaa-0000-0000-0000-000000000001'), '1', 'anon lê a mídia publicada do catálogo');
select is((select published_media_refs->'thumbnail'->>'path' from public.search_exercise_catalog('Supino reto teste', null, null, null, null, 5, 0) where id = '92aaaaaa-0000-0000-0000-000000000001'),
  '92aaaaaa-0000-0000-0000-000000000001/v1/thumb.webp', 'search_exercise_catalog devolve published_media_refs');
select is((select count(*)::int from public.search_exercise_catalog('Supino reto teste', null, null, null, null, 5, 0) where id = '92aaaaaa-0000-0000-0000-000000000001' and source_media_refs is not null), 1, 'search_exercise_catalog devolve source_media_refs');
-- Expiration RLS now uses a private helper intentionally unavailable to anon.
select throws_ok($$ select count(*) from storage.objects where bucket_id = 'exercise-visual-drafts' $$, '42501', null, 'anon não pode ler drafts (incluindo recusa por privilégio)');
select throws_ok($$ select count(*) from public.exercise_visual_sets $$, '42501', null, 'anon não lê exercise_visual_sets');
reset role;
select pg_temp.as_user('92000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'exercise-visual-drafts'), 0, 'usuário comum não enxerga drafts');
select is((select count(*)::int from public.exercise_visual_sets), 0, 'usuário comum não lê sets (RLS)');
select is((select count(*)::int from public.exercise_visual_assets), 0, 'usuário comum não lê assets (RLS)');
reset role;
select pg_temp.as_user('92000000-0000-0000-0000-000000000001');
set local role authenticated;
select is((select count(*)::int from storage.objects where bucket_id = 'exercise-visual-drafts'), 1, 'superadmin enxerga o draft que subiu');
select cmp_ok((select count(*)::int from public.exercise_visual_sets), '>=', 3, 'superadmin lê os sets');
reset role;

select * from finish();
rollback;
