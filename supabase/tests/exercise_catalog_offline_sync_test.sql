begin;
select no_plan();

-- Fixtures (prefixo 95...): catálogo de exercícios para os testes de sync offline.
-- status default passou a 'draft' (20261117000001_exercise_catalog_lifecycle.sql) -- um
-- exercício novo nunca entra ao ar sozinho. Este fixture precisa de ativo/publicado de
-- propósito, então todo insert abaixo informa status='published' explicitamente.
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status)
values
  ('95aaaaaa-0000-0000-0000-000000000001', 'evolutus_dataset', 'ev-sync-1', 'Supino Sync Teste', 'peito', array['peito'], 'força', array['Empurre.'], 'published'),
  ('95aaaaaa-0000-0000-0000-000000000002', 'evolutus_dataset', 'ev-sync-2', 'Nome Duplicado Sync', 'pernas', array['pernas'], 'força', array['Agache.'], 'published'),
  ('95aaaaaa-0000-0000-0000-000000000003', 'evolutus_dataset', 'ev-sync-3', 'Nome Duplicado Sync', 'pernas', array['pernas'], 'força', array['Agache.'], 'published');
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status)
values ('95aaaaaa-0000-0000-0000-000000000004', 'evolutus_dataset', 'ev-sync-4', 'Inativo Sync Teste', 'peito', array['peito'], 'força', array['x'], 'withdrawn');

-- Pagina list_exercise_catalog_for_sync inteiro (keyset por id) e devolve todos os ids vistos,
-- na ordem em que a varredura completa os encontrou -- usado para verificar que a varredura não
-- perde/duplica exercício nenhum, independente de quantas outras linhas já existirem na tabela.
create function pg_temp.collect_sync_ids(p_page_limit integer default 50)
returns setof uuid
language plpgsql
as $$
declare
  v_after uuid := null;
  v_count integer;
begin
  create temp table if not exists sync_page (id uuid) on commit drop;
  loop
    truncate sync_page;
    insert into sync_page
      select s.id from public.list_exercise_catalog_for_sync(v_after, p_page_limit) s order by s.id;
    select count(*) into v_count from sync_page;
    exit when v_count = 0;
    return query select id from sync_page order by id;
    select id into v_after from sync_page order by id desc limit 1;
    exit when v_count < p_page_limit;
  end loop;
  return;
end;
$$;

-- ----------------------------------------------------------------------------
-- Contrato
-- ----------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.get_exercise_catalog_revision()', 'execute'), true, 'anon chama a revisão');
select is(has_function_privilege('authenticated', 'public.get_exercise_catalog_revision()', 'execute'), true, 'authenticated chama a revisão');
select is(has_function_privilege('anon', 'public.list_exercise_catalog_for_sync(uuid, integer)', 'execute'), true, 'anon chama a varredura de sync');
select is(has_function_privilege('authenticated', 'public.list_exercise_catalog_for_sync(uuid, integer)', 'execute'), true, 'authenticated chama a varredura de sync');

-- ----------------------------------------------------------------------------
-- 1) trigger força updated_at em QUALQUER coluna alterada (não só mídia)
-- ----------------------------------------------------------------------------
update public.exercise_catalog set updated_at = '2020-01-01T00:00:00Z'
  where id in ('95aaaaaa-0000-0000-0000-000000000001', '95aaaaaa-0000-0000-0000-000000000002', '95aaaaaa-0000-0000-0000-000000000003');

update public.exercise_catalog set name = 'Supino Sync Teste Renomeado' where id = '95aaaaaa-0000-0000-0000-000000000001';
select cmp_ok((select updated_at from public.exercise_catalog where id = '95aaaaaa-0000-0000-0000-000000000001'),
  '>', '2020-01-02T00:00:00Z'::timestamptz, 'trigger força updated_at ao mudar o nome');

-- is_active agora é derivado de status (20261117000001_exercise_catalog_lifecycle.sql) --
-- um CHECK garante as duas colunas nunca ficarem inconsistentes, inclusive em escrita direta;
-- desativar passa a ser feito via status, nunca is_active direto.
update public.exercise_catalog set status = 'withdrawn' where id = '95aaaaaa-0000-0000-0000-000000000002';
select cmp_ok((select updated_at from public.exercise_catalog where id = '95aaaaaa-0000-0000-0000-000000000002'),
  '>', '2020-01-02T00:00:00Z'::timestamptz, 'trigger força updated_at ao desativar');
update public.exercise_catalog set status = 'published' where id = '95aaaaaa-0000-0000-0000-000000000002'; -- volta a ativo (fixture do keyset abaixo)

update public.exercise_catalog set published_media_refs = jsonb_build_object(
  'images', jsonb_build_array(jsonb_build_object('role', 'thumb', 'path', '95aaaaaa-0000-0000-0000-000000000003/v1/thumb.webp'))
) where id = '95aaaaaa-0000-0000-0000-000000000003';
select cmp_ok((select updated_at from public.exercise_catalog where id = '95aaaaaa-0000-0000-0000-000000000003'),
  '>', '2020-01-02T00:00:00Z'::timestamptz, 'trigger força updated_at ao publicar mídia (published_media_refs)');

-- ----------------------------------------------------------------------------
-- 2) revisão muda quando o conjunto de ativos muda (inserção e desativação)
-- ----------------------------------------------------------------------------
create temp table rev_before as select * from public.get_exercise_catalog_revision();

insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status)
values ('95aaaaaa-0000-0000-0000-000000000005', 'evolutus_dataset', 'ev-sync-5', 'Novo Ativo Sync Teste', 'peito', array['peito'], 'força', array['y'], 'published');
create temp table rev_after_insert as select * from public.get_exercise_catalog_revision();

select isnt((select revision from rev_before), (select revision from rev_after_insert),
  'revisão muda ao inserir um exercício ativo novo');
select is((select total_active from rev_after_insert) - (select total_active from rev_before), 1::bigint,
  'total_active sobe exatamente 1 com a inserção');

update public.exercise_catalog set status = 'withdrawn' where id = '95aaaaaa-0000-0000-0000-000000000005';
create temp table rev_after_deactivate as select * from public.get_exercise_catalog_revision();

select isnt((select revision from rev_after_insert), (select revision from rev_after_deactivate),
  'revisão muda ao desativar um exercício (mesmo sem a reimportação tocar texto/instruções)');
select is((select total_active from rev_after_deactivate) - (select total_active from rev_after_insert), -1::bigint,
  'total_active cai exatamente 1 ao desativar');

-- ----------------------------------------------------------------------------
-- 3) varredura completa (keyset por id): nenhum ativo do fixture ausente/duplicado,
--    inativos nunca aparecem, nomes repetidos não quebram a paginação.
-- ----------------------------------------------------------------------------
create temp table collected as select collect_sync_ids as id from pg_temp.collect_sync_ids(50);

select is((select count(*) from collected), (select count(distinct id) from collected),
  'varredura completa nunca duplica um id');
select is((select count(*) from collected),
  (select total_active from public.get_exercise_catalog_revision()),
  'varredura completa devolve exatamente total_active linhas (nenhuma ausente)');
select is(
  (select count(*) from collected where id = any(array[
    '95aaaaaa-0000-0000-0000-000000000001'::uuid,
    '95aaaaaa-0000-0000-0000-000000000002'::uuid,
    '95aaaaaa-0000-0000-0000-000000000003'::uuid
  ])), 3::bigint,
  'os 3 ativos do fixture aparecem (inclusive os 2 com nome idêntico)');
select is((select count(*) from collected where id in ('95aaaaaa-0000-0000-0000-000000000004'::uuid, '95aaaaaa-0000-0000-0000-000000000005'::uuid)), 0::bigint,
  'exercícios inativos (fixture original + desativado no teste 2) não aparecem na varredura');

-- ----------------------------------------------------------------------------
-- 4) p_limit é sempre clampado em [1, 50], como search_exercise_catalog
-- ----------------------------------------------------------------------------
select cmp_ok((select count(*) from public.list_exercise_catalog_for_sync(null, 0)), '<=', 1::bigint,
  'p_limit <= 0 é tratado como 1');
select cmp_ok((select count(*) from public.list_exercise_catalog_for_sync(null, -5)), '<=', 1::bigint,
  'p_limit negativo é tratado como 1');
select cmp_ok((select count(*) from public.list_exercise_catalog_for_sync(null, 1000)), '<=', 50::bigint,
  'p_limit é sempre clampado em 50, como a RPC de busca');

select * from finish();
rollback;
