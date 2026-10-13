begin;
select no_plan();

-- Fixtures (prefixo 93...): 01 superadmin | 02 usuário comum | 03 outro superadmin
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('93000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-exvisuals2@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users set role = 'superadmin', username = 'superadminv2a' where id = '93000000-0000-0000-0000-000000000001';
update public.users set role = 'superadmin', username = 'superadminv2b' where id = '93000000-0000-0000-0000-000000000003';

insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions)
values
  ('93aaaaaa-0000-0000-0000-000000000001', 'evolutus_dataset', 'ev-v2-1', 'Remada teste', 'costas', array['costas'], 'força', array['Puxe.']),
  ('93aaaaaa-0000-0000-0000-000000000002', 'evolutus_dataset', 'ev-v2-2', 'Elevação teste', 'ombros', array['ombros'], 'força', array['Eleve.']),
  ('93aaaaaa-0000-0000-0000-000000000003', 'evolutus_dataset', 'ev-v2-3', 'Stiff teste', 'pernas', array['pernas'], 'força', array['Incline.']);

create or replace function pg_temp.as_user(p_uid text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid, ''), true);
  perform set_config('request.jwt.claims', coalesce((
    case when p_uid is null then null else jsonb_build_object('sub', p_uid, 'role', 'authenticated') end
  )::text, ''), true);
end;
$$;

create or replace function pg_temp.payload(p_start_sha text default null, p_end_sha text default null,
  p_start_ph text default null, p_end_ph text default null, p_thumb boolean default true) returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_strip_nulls(jsonb_build_object('role', 'start', 'mime_type', 'image/webp', 'width', 1024, 'height', 1024,
      'byte_size', 50000, 'sha256', p_start_sha, 'perceptual_hash', p_start_ph, 'validation_version', 2)),
    jsonb_strip_nulls(jsonb_build_object('role', 'end', 'mime_type', 'image/webp', 'width', 1024, 'height', 1024,
      'byte_size', 50000, 'sha256', p_end_sha, 'perceptual_hash', p_end_ph, 'validation_version', 2))
  ) || case when p_thumb then jsonb_build_array(
    jsonb_build_object('role', 'thumbnail', 'mime_type', 'image/webp', 'width', 320, 'height', 320, 'byte_size', 9000, 'validation_version', 2))
    else '[]'::jsonb end
$$;

-- ----------------------------------------------------------------------------
-- 1) EVOLUTUS_FITNESS_V2: novo perfil, V1 intacto
-- ----------------------------------------------------------------------------
select is((select count(*)::int from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1' and version = 'v1' and active), 1, 'V1 continua existindo e ativo (não foi apagado nem alterado)');
select ok((select base_prompt like 'Ilustração técnica fitness.%' and base_prompt like '%Posição inicial e final claramente distintas.' from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1'), 'texto do V1 inalterado');
select is((select count(*)::int from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2' and version = 'v2' and not active), 1, 'V2 existe e nasce INATIVO');
select is((select array_agg(name) from public.exercise_visual_style_profiles where active), array['EVOLUTUS_FITNESS_V1'], 'a migration NÃO muda o perfil ativo: só o V1 está ativo');
select is((select string_agg(distinct family, ',') from public.exercise_visual_style_profiles where name like 'EVOLUTUS_FITNESS_V%'), 'EVOLUTUS_FITNESS', 'V1 e V2 pertencem à mesma família');
select is((select activated_at is null from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), true, 'V2 nunca foi ativado');
select ok((select base_prompt ~* '3D semi-realista' and base_prompt ~* 'andrógina' and base_prompt ~* 'sem musculatura exagerada' and base_prompt ~* 'Fundo transparente' and base_prompt ~* 'biomecânica' from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), 'V2: 3D semi-realista, neutro, sem exagero, fundo transparente, biomecânica');
select ok((select negative_rules ~ 'Sem texto' and negative_rules ~ 'Sem números' and negative_rules ~ 'Sem logotipos' and negative_rules ~ 'Sem setas' and negative_rules ~ 'Sem elementos decorativos' from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), 'V2: proíbe texto, números, logos, setas e decoração');

-- ----------------------------------------------------------------------------
-- 2) alocação: proveniência (style/prompt/hashes/provider/referência)
-- ----------------------------------------------------------------------------
select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
create temp table a1 as select public.allocate_exercise_visual_set(
  '93aaaaaa-0000-0000-0000-000000000001', 'manual_upload', 'v2',
  '{"tool":"x","source":"forjado","styleVersion":"forjado"}'::jsonb,
  '93111111-0000-0000-0000-000000000001', null,
  repeat('a', 64), repeat('b', 64), 'gemini') as r;
grant all on a1 to public;
select is((select r->>'status' from a1), 'allocated', 'payload devolve o status');
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'v1', 'style_version registrado (perfil ativo = V1 até a ativação explícita)');
select is((select prompt_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'v2', 'versão do perfil de prompt registrada');
select is((select prompt_start_hash || '/' || prompt_end_hash from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), repeat('a', 64) || '/' || repeat('b', 64), 'hashes START/END registrados');
select is((select provider_hint from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'gemini', 'provider hint registrado');
select is((select metadata->>'source' || '|' || (metadata->>'styleVersion') from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'manual_upload|EVOLUTUS_FITNESS_V1', 'metadata do cliente NÃO sobrescreve a proveniência do servidor');
select is((select metadata->>'tool' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'x', 'metadata do cliente continua mesclado');
select is((select reference_set_id is null and reference_style_version is null from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), true, 'sem pacote de referência ativo: campos nulos (hoje não há assets)');
select throws_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}', null, null, 'zz', null, null) $$, '22023', 'INVALID_ARGUMENT', 'hash START inválido é recusado');
select throws_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}', null, null, null, repeat('A', 64), null) $$, '22023', 'INVALID_ARGUMENT', 'hash END precisa ser hex minúsculo');
select throws_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}', null, null, null, null, 'Open AI!') $$, '22023', 'INVALID_ARGUMENT', 'provider hint com formato inválido é recusado');
select throws_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}', null, '93bbbbbb-0000-0000-0000-000000000000') $$, '22023', 'INVALID_ARGUMENT', 'style_profile_id inexistente é recusado');
create temp table a_v1 as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v1', '{}',
  null, (select id from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1')) as r;
grant all on a_v1 to public;
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_v1)), 'v1', 'o perfil informado pelo cliente (o que gerou o prompt) é o registrado');
create temp table a_v2 as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}',
  null, (select id from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2')) as r;
grant all on a_v2 to public;
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_v2)), 'v2', 'o cliente pode registrar o perfil V2 que usou mesmo antes da ativação (proveniência fiel)');
-- chamada no formato ANTIGO (4 parâmetros nomeados, como o frontend já publicado)
select lives_ok($$ select public.allocate_exercise_visual_set(p_catalog_id => '93aaaaaa-0000-0000-0000-000000000003', p_generation_source => 'gemini_manual', p_prompt_version => 'v1', p_metadata => '{}'::jsonb) $$, 'chamada antiga continua funcionando (sem ambiguidade de overload)');
select is((select count(*)::int from pg_proc where proname = 'allocate_exercise_visual_set'), 1, 'existe uma única função allocate_exercise_visual_set');

-- ----------------------------------------------------------------------------
-- 3) idempotência da alocação
-- ----------------------------------------------------------------------------
create temp table a1b as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000001', 'manual_upload', 'v2', '{}',
  '93111111-0000-0000-0000-000000000001') as r;
grant all on a1b to public;
select is((select r->>'visualSetId' from a1b), (select r->>'visualSetId' from a1), 'mesma chave => o mesmo conjunto (duplo clique/retry)');
select is((select (r->>'replayed')::boolean from a1b), true, 'resposta marca replayed');
select is((select r->'assets'->'end'->>'path' from a1b), (select r->'assets'->'end'->>'path' from a1), 'mesmos paths reservados');
select is((select count(*)::int from public.exercise_visual_sets where request_id = '93111111-0000-0000-0000-000000000001'), 1, 'apenas um conjunto criado para a chave');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from a1)), 3, 'assets não duplicados no replay');
select is((select count(*)::int from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from a1) and action = 'allocate'), 1, 'replay não gera novo evento de auditoria');
select throws_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2', '{}', '93111111-0000-0000-0000-000000000001') $$,
  '22023', 'IDEMPOTENCY_KEY_REUSED', 'a mesma chave para outro exercício é recusada');
select pg_temp.as_user('93000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000001', 'manual_upload', 'v2', '{}', '93111111-0000-0000-0000-000000000001') $$, 'a chave é por usuário: outro superadmin pode usar o mesmo valor');
select is((select max(version) from public.exercise_visual_sets where catalog_id = '93aaaaaa-0000-0000-0000-000000000001'), 2, 'versões sequenciais sem buraco');
select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
select has_index('public', 'exercise_visual_sets', 'exercise_visual_sets_request_id_key', 'índice único (created_by, request_id) existe');
select throws_ok($$ insert into public.exercise_visual_sets (catalog_id, version, status, generation_source, created_by, request_id)
  values ('93aaaaaa-0000-0000-0000-000000000003', 99, 'allocated', 'manual_upload', '93000000-0000-0000-0000-000000000001', '93111111-0000-0000-0000-000000000001') $$,
  '23505', null, 'última defesa: o banco recusa a chave repetida mesmo sem passar pela função');
select throws_ok($$ insert into public.exercise_visual_sets (catalog_id, version, status, generation_source, created_by)
  values ('93aaaaaa-0000-0000-0000-000000000001', 1, 'allocated', 'manual_upload', '93000000-0000-0000-0000-000000000001') $$,
  '23505', null, 'última defesa: unique (catalog_id, version)');

-- ----------------------------------------------------------------------------
-- 4) confirm: hashes, validated_at, validation_version e avisos
-- ----------------------------------------------------------------------------
select lives_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '93000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
  (select r->>'visualSetId' from a1), pg_temp.payload(repeat('1', 64), repeat('2', 64), 'f0f0f0f0f0f0f0f0', '0f0f0f0f0f0f0f0f')), 'confirm com hashes');
select is((select sha256 from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from a1) and role = 'start'), repeat('1', 64), 'sha256 do start gravado');
select is((select perceptual_hash from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from a1) and role = 'end'), '0f0f0f0f0f0f0f0f', 'perceptual_hash do end gravado');
select is((select count(*)::int from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from a1) and validated_at is not null and validation_version = 2), 3, 'validated_at/validation_version em todos os assets');
select is((select metadata->'validation'->'warnings' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), '[]'::jsonb, 'imagens diferentes: sem avisos');
select is((select (metadata->'validation'->>'phashDistance')::int from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 64, 'distância perceptual registrada (64 bits opostos)');

-- aviso: start == end (arquivo idêntico)
create temp table a_same as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2') as r;
grant all on a_same to public;
select is((select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_same), '93000000-0000-0000-0000-000000000001', pg_temp.payload(repeat('3', 64), repeat('3', 64), '1234567812345678', '1234567812345678'))->'warnings'),
  '["START_END_IDENTICAL_FILE"]'::jsonb, 'arquivo idêntico gera aviso (sem duplicar o aviso perceptual)');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_same)), 'review', 'o aviso NÃO bloqueia: o conjunto vai para revisão');

-- aviso: praticamente iguais (dHash a 1 bit) mas arquivos diferentes
create temp table a_near as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on a_near to public;
select is((select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_near), '93000000-0000-0000-0000-000000000001', pg_temp.payload(repeat('4', 64), repeat('5', 64), '1234567812345678', '1234567812345679'))->'warnings'),
  '["START_END_NEARLY_IDENTICAL"]'::jsonb, 'dHash a 1 bit => aviso de quase idênticas');
select is((select (metadata->'validation'->>'phashDistance')::int from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_near)), 1, 'distância de Hamming correta');

-- aviso: arquivo já usado em outro conjunto
create temp table a_dup as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on a_dup to public;
select ok((select (public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_dup), '93000000-0000-0000-0000-000000000001', pg_temp.payload(repeat('4', 64), repeat('6', 64)))->'warnings') ? 'DUPLICATE_FILE_IN_OTHER_SET'), 'sha256 repetido em outro conjunto gera aviso');
select is((select jsonb_array_length(metadata->'validation'->'duplicateSetIds') from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_dup)), 1, 'aviso aponta o conjunto de origem');

-- formato inválido de hash e payload do confirm ANTIGO (sem hashes)
create temp table a_bad as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2') as r;
grant all on a_bad to public;
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '93000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
  (select r->>'visualSetId' from a_bad), pg_temp.payload('xyz', null)::text), '22023', 'INVALID_IMAGE', 'sha256 malformado é recusado');
select throws_ok(format($f$ select public.confirm_exercise_visual_internal(%L, '93000000-0000-0000-0000-000000000001', %L::jsonb) $f$,
  (select r->>'visualSetId' from a_bad), pg_temp.payload(null, null, '123', null)::text), '22023', 'INVALID_IMAGE', 'perceptual_hash malformado é recusado');
select is((select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_bad), '93000000-0000-0000-0000-000000000001',
  '[{"role":"start","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10},{"role":"end","mime_type":"image/webp","width":1024,"height":1024,"byte_size":10}]'::jsonb)->'warnings'),
  '[]'::jsonb, 'payload da Edge Function v1 (sem hashes) continua aceito, sem avisos');
select is((select validation_version from public.exercise_visual_assets where visual_set_id = (select (r->>'visualSetId')::uuid from a_bad) and role = 'start'), 1::smallint, 'sem validation_version no payload => versão 1');

-- ----------------------------------------------------------------------------
-- 5) máquina de estados no banco
-- ----------------------------------------------------------------------------
select is(private.exercise_visual_transition_allowed('allocated', 'review'), true, 'allocated -> review');
select is(private.exercise_visual_transition_allowed('review', 'published'), true, 'review -> published');
select is(private.exercise_visual_transition_allowed('published', 'archived'), true, 'published -> archived');
select is(private.exercise_visual_transition_allowed('archived', 'published'), true, 'archived -> published (rollback)');
select is(private.exercise_visual_transition_allowed('allocated', 'published'), false, 'allocated -> published é inválida');
select is(private.exercise_visual_transition_allowed('failed', 'published'), false, 'failed -> published é inválida');
select is(private.exercise_visual_transition_allowed('rejected', 'published'), false, 'rejected -> published é inválida');
select is(private.exercise_visual_transition_allowed('rejected', 'review'), false, 'rejected é terminal');
select is(private.exercise_visual_transition_allowed('archived', 'review'), false, 'archived -> review é inválida');
select is(private.exercise_visual_transition_allowed('published', 'review'), false, 'published -> review é inválida');
select is(private.exercise_visual_transition_allowed('banana', 'review'), false, 'estado desconhecido nunca transita');

create temp table s_alloc as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2') as r;
grant all on s_alloc to public;
select throws_ok(format($f$ update public.exercise_visual_sets set status = 'published' where id = %L $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'INVALID_TRANSITION', 'SQL direto: allocated -> published é barrado pelo trigger');
select throws_ok(format($f$ update public.exercise_visual_sets set status = 'archived' where id = %L $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'INVALID_TRANSITION', 'SQL direto: allocated -> archived é barrado');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from s_alloc)), 'allocated', 'o estado não mudou após as tentativas inválidas');
select throws_ok(format($f$ update public.exercise_visual_sets set version = 77 where id = %L $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'IMMUTABLE_FIELD', 'version é imutável (paths publicados dependem dela)');
select throws_ok(format($f$ update public.exercise_visual_sets set catalog_id = '93aaaaaa-0000-0000-0000-000000000001' where id = %L $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'IMMUTABLE_FIELD', 'catalog_id é imutável');
select lives_ok(format($f$ update public.exercise_visual_sets set status = 'failed' where id = %L $f$, (select r->>'visualSetId' from s_alloc)), 'allocated -> failed é válida');
select throws_ok(format($f$ update public.exercise_visual_sets set status = 'published' where id = %L $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'INVALID_TRANSITION', 'failed -> published é barrado');
select throws_ok(format($f$ select public.publish_exercise_visual_internal(%L, '93000000-0000-0000-0000-000000000001') $f$, (select r->>'visualSetId' from s_alloc)),
  '55000', 'INVALID_STATE', 'RPC de publicação também recusa failed');

-- rejected -> published direto (e via restore) é barrado
create temp table s_rej as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2') as r;
grant all on s_rej to public;
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from s_rej), '93000000-0000-0000-0000-000000000001', pg_temp.payload());
select public.reject_exercise_visual_set((select (r->>'visualSetId')::uuid from s_rej), 'pose errada');
select throws_ok(format($f$ update public.exercise_visual_sets set status = 'published' where id = %L $f$, (select r->>'visualSetId' from s_rej)),
  '55000', 'INVALID_TRANSITION', 'rejected -> published direto é barrado');
select throws_ok(format($f$ select public.restore_exercise_visual_version(%L) $f$, (select r->>'visualSetId' from s_rej)),
  '55000', 'INVALID_STATE', 'rollback de um rejeitado é recusado');

-- ----------------------------------------------------------------------------
-- 6) fail interno
-- ----------------------------------------------------------------------------
create temp table s_fail as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on s_fail to public;
select throws_ok(format($f$ select public.fail_exercise_visual_set_internal(%L, '93000000-0000-0000-0000-000000000001', 'motivo livre com texto') $f$, (select r->>'visualSetId' from s_fail)),
  '22023', 'INVALID_ARGUMENT', 'motivo precisa ser um código (sem texto livre)');
select lives_ok(format($f$ select public.fail_exercise_visual_set_internal(%L, '93000000-0000-0000-0000-000000000001', 'INVALID_IMAGE') $f$, (select r->>'visualSetId' from s_fail)), 'fail de um allocated');
select is((select metadata->'failure'->>'reason' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from s_fail)), 'INVALID_IMAGE', 'motivo registrado');
select throws_ok(format($f$ select public.fail_exercise_visual_set_internal(%L, '93000000-0000-0000-0000-000000000001', 'X') $f$, (select r->>'visualSetId' from s_fail)),
  '55000', 'INVALID_STATE', 'fail não roda duas vezes');
select is(has_function_privilege('authenticated', 'public.fail_exercise_visual_set_internal(uuid, uuid, text)', 'execute'), false, 'fail interno não é chamável por authenticated');

-- ----------------------------------------------------------------------------
-- 7) publicar/arquivar/restaurar gera auditoria com ator
-- ----------------------------------------------------------------------------
select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
select public.publish_exercise_visual_internal((select (r->>'visualSetId')::uuid from a1), '93000000-0000-0000-0000-000000000001');
create temp table a_pub2 as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000001', 'manual_upload', 'v2') as r;
grant all on a_pub2 to public;
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_pub2), '93000000-0000-0000-0000-000000000001', pg_temp.payload());
select public.publish_exercise_visual_internal((select (r->>'visualSetId')::uuid from a_pub2), '93000000-0000-0000-0000-000000000001');
select public.restore_exercise_visual_version((select (r->>'visualSetId')::uuid from a1));

select is((select array_agg(action order by id) from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from a1)),
  array['allocate', 'confirm', 'publish', 'archive', 'restore'], 'a1: allocate, confirm, publish, archive, restore');
select is((select array_agg(action order by id) from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from a_pub2)),
  array['allocate', 'confirm', 'publish', 'archive'], 'a_pub2: allocate, confirm, publish, archive (pelo rollback)');
select is((select array_agg(action order by id) from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from s_rej)),
  array['allocate', 'confirm', 'reject'], 's_rej: allocate, confirm, reject');
select is((select metadata->>'reason' from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from s_rej) and action = 'reject'), 'pose errada', 'motivo da rejeição na auditoria');
select is((select array_agg(action order by id) from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from s_fail)),
  array['allocate', 'fail'], 's_fail: allocate, fail');
select is((select count(*)::int from public.exercise_visual_audit_log where visual_set_id in (select (r->>'visualSetId')::uuid from a1 union select (r->>'visualSetId')::uuid from a_pub2 union select (r->>'visualSetId')::uuid from s_rej) and actor_id = '93000000-0000-0000-0000-000000000001'), 12, 'ator registrado em todos os eventos humanos');
select is((select previous_status || '>' || new_status from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from a1) and action = 'restore'), 'archived>published', 'restore: archived -> published');
select is((select version from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from a_pub2) and action = 'publish'), 3, 'versão registrada (a_pub2 é a v3 do exercício 1)');
select is((select count(*)::int from public.exercise_visual_audit_log where metadata::text ~* '(secret|api[_-]?key|token|password)'), 0, 'nenhum segredo na auditoria');
select throws_ok($$ update public.exercise_visual_audit_log set action = 'publish' where id = (select min(id) from public.exercise_visual_audit_log) $$, '55000', 'AUDIT_LOG_IMMUTABLE', 'auditoria é append-only (update)');
select throws_ok($$ delete from public.exercise_visual_audit_log $$, '55000', 'AUDIT_LOG_IMMUTABLE', 'auditoria é append-only (delete)');
select is(has_table_privilege('service_role', 'public.exercise_visual_audit_log', 'insert'), false, 'nem service_role insere direto na auditoria');
select is(has_table_privilege('authenticated', 'public.exercise_visual_audit_log', 'insert'), false, 'authenticated não insere na auditoria');
select is(has_table_privilege('anon', 'public.exercise_visual_audit_log', 'select'), false, 'anon não lê a auditoria');

-- ----------------------------------------------------------------------------
-- 8) cleanup de rascunhos abandonados
-- ----------------------------------------------------------------------------
create temp table c_old as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
create temp table c_new as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
create temp table c_rev as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on c_old, c_new, c_rev to public;
select public.confirm_exercise_visual_internal((select (r->>'visualSetId')::uuid from c_rev), '93000000-0000-0000-0000-000000000001', pg_temp.payload());
update public.exercise_visual_sets set created_at = now() - interval '5 days' where id in (select (r->>'visualSetId')::uuid from c_old union select (r->>'visualSetId')::uuid from c_rev);
-- published e archived antigos jamais são tocados
update public.exercise_visual_sets set created_at = now() - interval '90 days', updated_at = now() - interval '90 days'
  where id in (select (r->>'visualSetId')::uuid from a1 union select (r->>'visualSetId')::uuid from a_pub2);

select throws_ok($$ select public.expire_stale_exercise_visual_sets(interval '1 hour') $$, '22023', 'INVALID_ARGUMENT', 'não expira antes da janela de 24h do upload');
select is(public.expire_stale_exercise_visual_sets(), 1, 'expira apenas o allocated antigo (os recentes e os em revisão ficam)');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from c_old)), 'failed', 'c_old virou failed');
select is((select metadata->'failure'->>'reason' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from c_old)), 'EXPIRED', 'motivo EXPIRED');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from c_new)), 'allocated', 'allocated recente intacto');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from c_rev)), 'review', 'review (decisão humana pendente) intacto mesmo antigo');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a1)), 'published', 'published antigo intacto');
select is((select status from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_pub2)), 'archived', 'archived antigo intacto');
select is((select array_agg(action order by id) from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from c_old)), array['allocate', 'fail'], 'expiração auditada como fail');
select is((select actor_id from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from c_old) and action = 'fail'), null, 'expiração é do sistema (sem ator humano)');

-- candidatos a purga: failed >= 7 dias, rejected >= 30 dias, nunca published/archived/review
update public.exercise_visual_sets set updated_at = now() - interval '8 days'
  where id in (select (r->>'visualSetId')::uuid from c_old union select (r->>'visualSetId')::uuid from s_fail);
update public.exercise_visual_sets set updated_at = now() - interval '10 days' where id = (select (r->>'visualSetId')::uuid from s_rej);
select is((select count(*)::int from public.list_exercise_visual_purge_candidates() where visual_set_id in (select (r->>'visualSetId')::uuid from c_old union select (r->>'visualSetId')::uuid from s_fail)), 2, 'failed com mais de 7 dias são candidatos');
select is((select count(*)::int from public.list_exercise_visual_purge_candidates() where visual_set_id = (select (r->>'visualSetId')::uuid from s_rej)), 0, 'rejected com 10 dias ainda não (política: 30 dias)');
update public.exercise_visual_sets set updated_at = now() - interval '31 days' where id = (select (r->>'visualSetId')::uuid from s_rej);
select is((select count(*)::int from public.list_exercise_visual_purge_candidates() where visual_set_id = (select (r->>'visualSetId')::uuid from s_rej)), 1, 'rejected com mais de 30 dias entra');
select is((select count(*)::int from public.list_exercise_visual_purge_candidates(interval '1 day', interval '1 day', 1000)
  where status not in ('failed', 'rejected')), 0, 'published, archived, review, allocated nunca são candidatos');
select ok((select bool_and(a->>'path' like '93aaaaaa-%/' || visual_set_id::text || '/%.webp') from public.list_exercise_visual_purge_candidates() c, jsonb_array_elements(c.assets) a), 'só paths de rascunho {catalog}/{set}/arquivo');
select throws_ok($$ select * from public.list_exercise_visual_purge_candidates(interval '1 minute') $$, '22023', 'INVALID_ARGUMENT', 'janela mínima de 1 dia');

select throws_ok(format($f$ select public.mark_exercise_visual_drafts_purged_internal(%L) $f$, (select r->>'visualSetId' from a1)), '55000', 'INVALID_STATE', 'mark purge recusa published');
select throws_ok(format($f$ select public.mark_exercise_visual_drafts_purged_internal(%L) $f$, (select r->>'visualSetId' from a_pub2)), '55000', 'INVALID_STATE', 'mark purge recusa archived');
select throws_ok(format($f$ select public.mark_exercise_visual_drafts_purged_internal(%L) $f$, (select r->>'visualSetId' from c_rev)), '55000', 'INVALID_STATE', 'mark purge recusa review');
select is((select public.mark_exercise_visual_drafts_purged_internal((select (r->>'visualSetId')::uuid from c_old))->>'alreadyPurged'), 'false', 'mark purge de um failed');
select is((select public.mark_exercise_visual_drafts_purged_internal((select (r->>'visualSetId')::uuid from c_old))->>'alreadyPurged'), 'true', 'mark purge é idempotente');
select is((select count(*)::int from public.exercise_visual_audit_log where visual_set_id = (select (r->>'visualSetId')::uuid from c_old) and action = 'cleanup'), 1, 'purga auditada uma única vez');
select is((select count(*)::int from public.list_exercise_visual_purge_candidates() where visual_set_id = (select (r->>'visualSetId')::uuid from c_old)), 0, 'já purgado não volta como candidato');
select is((select count(*)::int from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from c_old)), 1, 'a linha do conjunto (histórico/versão) é preservada');
select is(has_function_privilege('authenticated', 'public.expire_stale_exercise_visual_sets(interval, integer)', 'execute'), false, 'expirar não é chamável por authenticated');
select is(has_function_privilege('authenticated', 'public.list_exercise_visual_purge_candidates(interval, interval, integer)', 'execute'), false, 'listar candidatos não é chamável por authenticated');
select is(has_function_privilege('authenticated', 'public.mark_exercise_visual_drafts_purged_internal(uuid)', 'execute'), false, 'marcar purga não é chamável por authenticated');
select is(has_function_privilege('anon', 'public.expire_stale_exercise_visual_sets(interval, integer)', 'execute'), false, 'anon não expira');
select is(has_function_privilege('service_role', 'public.expire_stale_exercise_visual_sets(interval, integer)', 'execute'), true, 'service_role expira');

-- ----------------------------------------------------------------------------
-- 9) referências oficiais do personagem (estrutura pronta, sem assets ainda)
-- ----------------------------------------------------------------------------
insert into public.exercise_visual_reference_sets (id, name, version, notes) values
  ('93cccccc-0000-0000-0000-000000000001', 'EVOLUTUS_CHARACTER', 'r1', 'teste'),
  ('93cccccc-0000-0000-0000-000000000002', 'EVOLUTUS_CHARACTER', 'r2', 'teste');
select throws_ok($$ insert into public.exercise_visual_reference_assets (reference_set_id, role, storage_path)
  values ('93cccccc-0000-0000-0000-000000000001', 'character-front', 'outro-set/character-front.webp') $$, '23514', null, 'path da referência precisa ser {reference_set_id}/{role}.ext');
select throws_ok($$ insert into public.exercise_visual_reference_assets (reference_set_id, role, storage_path)
  values ('93cccccc-0000-0000-0000-000000000001', 'avatar-feliz', '93cccccc-0000-0000-0000-000000000001/avatar-feliz.webp') $$, '23514', null, 'papéis permitidos: character-front/side/back e style-reference');
select lives_ok($$ insert into public.exercise_visual_reference_assets (reference_set_id, role, storage_path) values
  ('93cccccc-0000-0000-0000-000000000001', 'character-front', '93cccccc-0000-0000-0000-000000000001/character-front.webp'),
  ('93cccccc-0000-0000-0000-000000000001', 'character-side', '93cccccc-0000-0000-0000-000000000001/character-side.webp'),
  ('93cccccc-0000-0000-0000-000000000001', 'character-back', '93cccccc-0000-0000-0000-000000000001/character-back.webp'),
  ('93cccccc-0000-0000-0000-000000000001', 'style-reference', '93cccccc-0000-0000-0000-000000000001/style-reference.webp') $$, 'registra os 4 papéis de referência');
select throws_ok($$ select public.activate_exercise_visual_reference_set_internal('93cccccc-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001') $$,
  '22023', 'INCOMPLETE_REFERENCE_SET', 'não ativa pacote com arquivos não confirmados');
select throws_ok($$ select public.activate_exercise_visual_reference_set_internal('93cccccc-0000-0000-0000-000000000002', '93000000-0000-0000-0000-000000000001') $$,
  '22023', 'INCOMPLETE_REFERENCE_SET', 'não ativa pacote vazio');
select throws_ok($$ select public.activate_exercise_visual_reference_set_internal('93cccccc-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000002') $$,
  '42501', 'FORBIDDEN', 'só um superadmin como ator ativa');
update public.exercise_visual_reference_assets set mime_type = 'image/webp', byte_size = 1000, width = 1024, height = 1024
  where reference_set_id in ('93cccccc-0000-0000-0000-000000000001');
select lives_ok($$ select public.activate_exercise_visual_reference_set_internal('93cccccc-0000-0000-0000-000000000001', '93000000-0000-0000-0000-000000000001') $$, 'ativa pacote completo');
select is((select count(*)::int from public.exercise_visual_reference_sets where active), 1, 'um pacote ativo');
select throws_ok($$ update public.exercise_visual_reference_sets set active = true where id = '93cccccc-0000-0000-0000-000000000002' $$, '23505', null, 'índice parcial impede dois pacotes ativos');
create temp table a_ref as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000002', 'manual_upload', 'v2') as r;
grant all on a_ref to public;
select is((select reference_set_id::text || '/' || reference_style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_ref)),
  '93cccccc-0000-0000-0000-000000000001/r1', 'o conjunto guarda a versão da referência ativa na alocação');
select pg_temp.as_user('93000000-0000-0000-0000-000000000002');
set local role authenticated;
select is((select count(*)::int from public.exercise_visual_reference_sets), 0, 'usuário comum não lê pacotes de referência');
select is((select count(*)::int from public.exercise_visual_reference_assets), 0, 'usuário comum não lê assets de referência');
select is((select count(*)::int from public.exercise_visual_audit_log), 0, 'usuário comum não lê a auditoria');
reset role;
select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
set local role authenticated;
select cmp_ok((select count(*)::int from public.exercise_visual_reference_sets), '>=', 2, 'superadmin lê pacotes de referência');
select cmp_ok((select count(*)::int from public.exercise_visual_audit_log), '>', 10, 'superadmin lê a auditoria');
select throws_ok($$ insert into public.exercise_visual_reference_sets (name, version) values ('x', 'y') $$, '42501', null, 'cliente não escreve em reference sets');
select throws_ok($$ insert into public.exercise_visual_audit_log (visual_set_id, catalog_id, action, new_status, version) values (gen_random_uuid(), gen_random_uuid(), 'publish', 'published', 1) $$, '42501', null, 'cliente não forja auditoria');
reset role;

-- ----------------------------------------------------------------------------
-- 10) Storage: drafts privados, publicado e referências sem escrita do cliente
-- ----------------------------------------------------------------------------
create or replace function pg_temp.rows_updated() returns int language plpgsql as $$
declare n int;
begin
  update storage.objects set name = name || 'x' where bucket_id in ('exercise-visuals', 'exercise-visual-drafts');
  get diagnostics n = row_count;
  return n;
end;
$$;
create or replace function pg_temp.rows_deleted() returns int language plpgsql as $$
declare n int;
begin
  delete from storage.objects where bucket_id in ('exercise-visuals', 'exercise-visual-drafts', 'exercise-visual-references');
  get diagnostics n = row_count;
  return n;
exception when others then
  -- Current Storage also denies direct DELETE at statement level, before RLS.
  if sqlstate='42501' or (sqlstate='P0001' and sqlerrm='Direct deletion from storage tables is not allowed. Use the Storage API instead.') then return 0; end if;
  raise;
end;
$$;
select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
create temp table s_up as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on s_up to public;
set local role authenticated;
select lives_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', %L) $f$, (select r->'assets'->'start'->>'path' from s_up)), 'superadmin sobe no path alocado (status allocated)');
select throws_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visual-references', %L) $f$, '93cccccc-0000-0000-0000-000000000001/character-front.webp'),
  '42501', null, 'cliente não escreve no bucket de referências');
select throws_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visuals', %L) $f$, '93aaaaaa-0000-0000-0000-000000000003/v1/start.webp'),
  '42501', null, 'cliente não escreve no bucket público');
reset role;
-- bucket público/rascunhos: sem update/delete para o cliente (nada a regravar nem apagar depois de enviado)
insert into storage.objects (bucket_id, name) values ('exercise-visuals', '93aaaaaa-0000-0000-0000-000000000003/v1/start.webp');
set local role authenticated;
select is(pg_temp.rows_updated(), 0, 'cliente não renomeia/sobrescreve arquivos (update)');
select is(pg_temp.rows_deleted(), 0, 'cliente não apaga arquivos (delete)');
reset role;
-- depois que o conjunto sai de allocated, o path deixa de aceitar upload
update public.exercise_visual_sets set status = 'failed' where id = (select (r->>'visualSetId')::uuid from s_up);
set local role authenticated;
select throws_ok(format($f$ insert into storage.objects (bucket_id, name) values ('exercise-visual-drafts', %L) $f$, (select r->'assets'->'end'->>'path' from s_up)),
  '42501', null, 'fora de allocated o path não aceita mais upload');
reset role;
select is((select public from storage.buckets where id = 'exercise-visual-drafts'), false, 'drafts continua privado');
select is((select public from storage.buckets where id = 'exercise-visual-references'), false, 'referências continuam privadas');
select is((select allowed_mime_types from storage.buckets where id = 'exercise-visual-drafts'), array['image/webp'], 'drafts só aceita WebP');


-- ----------------------------------------------------------------------------
-- 11) ativação explícita do style profile (V1 -> V2 -> rollback para V1)
-- ----------------------------------------------------------------------------
create temp table prof as select
  (select id from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1') as v1,
  (select id from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2') as v2;
grant all on prof to public;
-- perfil de OUTRA família: precisa continuar ativo independentemente
-- (mais antigo que o Evolutus: a alocação sem perfil explícito escolhe o ativo mais recente)
insert into public.exercise_visual_style_profiles (id, name, version, family, active, base_prompt, created_at)
  values ('93dddddd-0000-0000-0000-000000000001', 'OUTRO_ESTILO_V1', 'v1', 'OUTRO_ESTILO', true, 'x', now() - interval '10 years'),
         ('93dddddd-0000-0000-0000-000000000002', 'OUTRO_ESTILO_V2', 'v2', 'OUTRO_ESTILO', false, 'y', now() - interval '10 years');

select is(has_function_privilege('anon', 'public.activate_exercise_visual_style_profile(uuid)', 'execute'), false, 'anon não ativa perfil');
select is(has_function_privilege('authenticated', 'public.activate_exercise_visual_style_profile(uuid)', 'execute'), true, 'authenticated chama (e a função exige superadmin)');
select is(has_function_privilege('authenticated', 'public.activate_exercise_visual_style_profile_internal(uuid, uuid)', 'execute'), false, 'a versão interna não é chamável por authenticated');
select is(has_function_privilege('service_role', 'public.activate_exercise_visual_style_profile_internal(uuid, uuid)', 'execute'), true, 'service_role chama a versão interna');
select is(has_function_privilege('authenticated', 'private.apply_style_profile_activation(uuid, uuid)', 'execute'), false, 'o núcleo privado não é chamável');
select is(has_table_privilege('authenticated', 'public.exercise_visual_style_profiles', 'update'), false, 'ninguém altera o perfil ativo por UPDATE direto');

select pg_temp.as_user(null);
select throws_ok(format($f$ select public.activate_exercise_visual_style_profile(%L) $f$, (select v2 from prof)), '28000', 'NOT_AUTHENTICATED', 'sem auth não ativa');
select pg_temp.as_user('93000000-0000-0000-0000-000000000002');
select throws_ok(format($f$ select public.activate_exercise_visual_style_profile(%L) $f$, (select v2 from prof)), '42501', 'FORBIDDEN', 'usuário comum não ativa');
select throws_ok(format($f$ select public.activate_exercise_visual_style_profile_internal(%L, '93000000-0000-0000-0000-000000000002') $f$, (select v2 from prof)), '42501', 'FORBIDDEN', 'ator da versão interna precisa ser superadmin');
select is((select array_agg(name order by name) from public.exercise_visual_style_profiles where active), array['EVOLUTUS_FITNESS_V1', 'OUTRO_ESTILO_V1'], 'tentativas negadas não mudaram nada');

select pg_temp.as_user('93000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.activate_exercise_visual_style_profile('93bbbbbb-0000-0000-0000-000000000000') $$, 'P0002', 'NOT_FOUND', 'perfil inexistente');
select lives_ok(format($f$ select public.activate_exercise_visual_style_profile(%L) $f$, (select v2 from prof)), 'superadmin ativa o V2');
select is((select array_agg(name order by name) from public.exercise_visual_style_profiles where active), array['EVOLUTUS_FITNESS_V2', 'OUTRO_ESTILO_V1'], 'V2 ativo, V1 desativado; a outra família não foi tocada');
select is((select count(*)::int from public.exercise_visual_style_profiles where family = 'EVOLUTUS_FITNESS' and active), 1, 'um único ativo na família');
select is((select activated_by::text from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), '93000000-0000-0000-0000-000000000001', 'quem ativou fica registrado');
select is((select base_prompt like 'Ilustração técnica fitness.%' from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V1'), true, 'V1 preservado (texto intacto) após a troca');
create temp table a_after as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on a_after to public;
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_after)), 'v2', 'novas alocações usam o V2 depois da ativação');
select is((select metadata->>'styleVersion' from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_after)), 'EVOLUTUS_FITNESS_V2', 'proveniência no metadata');
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_same)), 'v1', 'conjuntos já criados mantêm o perfil com que foram criados');
select lives_ok(format($f$ select public.activate_exercise_visual_style_profile(%L) $f$, (select v2 from prof)), 'ativar de novo é idempotente');
select is((select count(*)::int from public.exercise_visual_style_profiles where family = 'EVOLUTUS_FITNESS' and active), 1, 'continua um único ativo');

-- rollback para o V1
select lives_ok(format($f$ select public.activate_exercise_visual_style_profile_internal(%L, '93000000-0000-0000-0000-000000000001') $f$, (select v1 from prof)), 'rollback para o V1 pela versão interna (service_role)');
select is((select array_agg(name order by name) from public.exercise_visual_style_profiles where active), array['EVOLUTUS_FITNESS_V1', 'OUTRO_ESTILO_V1'], 'V1 volta a ser o ativo; V2 inativo e preservado');
select is((select count(*)::int from public.exercise_visual_style_profiles where name = 'EVOLUTUS_FITNESS_V2'), 1, 'o V2 continua cadastrado');
create temp table a_back as select public.allocate_exercise_visual_set('93aaaaaa-0000-0000-0000-000000000003', 'manual_upload', 'v2') as r;
grant all on a_back to public;
select is((select style_version from public.exercise_visual_sets where id = (select (r->>'visualSetId')::uuid from a_back)), 'v1', 'depois do rollback as alocações voltam a usar o V1');
select lives_ok(format($f$ select public.activate_exercise_visual_style_profile(%L) $f$, '93dddddd-0000-0000-0000-000000000002'), 'ativar outra família');
select is((select array_agg(name order by name) from public.exercise_visual_style_profiles where active), array['EVOLUTUS_FITNESS_V1', 'OUTRO_ESTILO_V2'], 'cada família mantém o seu próprio ativo');
select throws_ok($$ update public.exercise_visual_style_profiles set active = true where name = 'EVOLUTUS_FITNESS_V2' $$, '23505', null, 'índice parcial: duas versões ativas na mesma família é impossível, mesmo por SQL direto');

select * from finish();
rollback;
