begin;
select no_plan();

-- Fase 4 do Catálogo (migration 20261121000001_catalog_search_order_tiebreak.sql): paginação por
-- limit/offset só é estável entre chamadas quando a ordenação nunca empata. Fixture de propósito
-- (prefixo 95...): cinco exercícios PUBLICADOS com o MESMO nome (pior caso de empate possível,
-- tanto na ordenação "sem termo" por name quanto na similaridade "com termo") e uma categoria só
-- deles, pra isolar o teste de qualquer outra linha que já exista na tabela.
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status)
values
  ('95bbbbbb-0000-0000-0000-000000000001', 'evolutus_dataset', 'ord-1', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'published'),
  ('95bbbbbb-0000-0000-0000-000000000002', 'evolutus_dataset', 'ord-2', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'published'),
  ('95bbbbbb-0000-0000-0000-000000000003', 'evolutus_dataset', 'ord-3', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'published'),
  ('95bbbbbb-0000-0000-0000-000000000004', 'evolutus_dataset', 'ord-4', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'published'),
  ('95bbbbbb-0000-0000-0000-000000000005', 'evolutus_dataset', 'ord-5', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'published');
-- Um sexto, retirado -- nunca deveria aparecer em nenhuma página.
insert into public.exercise_catalog (id, provider, provider_exercise_id, name, primary_muscle, muscles, category, instructions, status)
values ('95bbbbbb-0000-0000-0000-000000000006', 'evolutus_dataset', 'ord-6', 'Exercício Empatado', 'peito', array['peito'], 'teste-ordenacao-95', array['x'], 'withdrawn');

-- Pagina os 5 publicados em páginas de 2 (2+2+1) e devolve a sequência de ids vista, na ordem.
create function pg_temp.collect_page_ids(p_search_query text, p_page_limit integer)
returns setof uuid
language plpgsql
as $$
declare
  v_offset integer := 0;
  v_count integer;
begin
  loop
    create temp table if not exists search_page (id uuid) on commit drop;
    truncate search_page;
    insert into search_page
      select s.id from public.search_exercise_catalog(
        p_query := p_search_query, p_category := 'teste-ordenacao-95', p_limit := p_page_limit, p_offset := v_offset
      ) s;
    select count(*) into v_count from search_page;
    exit when v_count = 0;
    return query select id from search_page;
    v_offset := v_offset + p_page_limit;
  end loop;
  return;
end;
$$;

-- ----------------------------------------------------------------------------------------------
-- 1) Sem termo de busca (ordenação só por name, antes empatada): 5 páginas de 2 cobrem os 5
--    publicados exatamente uma vez cada, nunca o retirado.
-- ----------------------------------------------------------------------------------------------
select set_eq(
  $$ select * from pg_temp.collect_page_ids(null, 2) $$,
  $$ values
    ('95bbbbbb-0000-0000-0000-000000000001'::uuid),
    ('95bbbbbb-0000-0000-0000-000000000002'::uuid),
    ('95bbbbbb-0000-0000-0000-000000000003'::uuid),
    ('95bbbbbb-0000-0000-0000-000000000004'::uuid),
    ('95bbbbbb-0000-0000-0000-000000000005'::uuid)
  $$,
  'paginação sem termo cobre cada publicado exatamente uma vez, nunca o retirado'
);

select is(
  (select count(*) from pg_temp.collect_page_ids(null, 2)),
  5::bigint,
  'nenhuma linha duplicada entre páginas (empate de name não causa repetição)'
);

-- ----------------------------------------------------------------------------------------------
-- 2) Com termo de busca (ordenação por similaridade, também empatada entre os 5): mesma garantia.
-- ----------------------------------------------------------------------------------------------
select is(
  (select count(*) from pg_temp.collect_page_ids('Exercício Empatado', 2)),
  5::bigint,
  'paginação com termo de busca também não duplica/perde linha em empate de similaridade'
);

-- ----------------------------------------------------------------------------------------------
-- 3) Determinismo: duas chamadas separadas, mesmos parâmetros, devolvem exatamente a mesma ordem
--    -- é o que torna "Carregar mais" seguro (a página 2 não pode depender de acaso do planner).
-- ----------------------------------------------------------------------------------------------
create function pg_temp.first_page_order(p_search_query text) returns uuid[] language sql as $$
  select array_agg(s.id) from public.search_exercise_catalog(
    p_query := p_search_query, p_category := 'teste-ordenacao-95', p_limit := 5, p_offset := 0
  ) s;
$$;

select is(pg_temp.first_page_order(null), pg_temp.first_page_order(null), 'mesma chamada repetida (sem termo) devolve a mesma ordem');
select is(pg_temp.first_page_order('Exercício Empatado'), pg_temp.first_page_order('Exercício Empatado'), 'mesma chamada repetida (com termo) devolve a mesma ordem');
-- Desempate final é por id: a ordem observada tem que ser exatamente os ids em ordem crescente.
select is(
  pg_temp.first_page_order(null),
  array[
    '95bbbbbb-0000-0000-0000-000000000001'::uuid,
    '95bbbbbb-0000-0000-0000-000000000002'::uuid,
    '95bbbbbb-0000-0000-0000-000000000003'::uuid,
    '95bbbbbb-0000-0000-0000-000000000004'::uuid,
    '95bbbbbb-0000-0000-0000-000000000005'::uuid
  ],
  'desempate final é por id ascendente, nunca dependente da ordem física da tabela'
);

-- ----------------------------------------------------------------------------------------------
-- 4) total_count continua correto (só os 5 publicados, nunca o retirado) em toda página.
-- ----------------------------------------------------------------------------------------------
select is(
  (select total_count from public.search_exercise_catalog(p_category := 'teste-ordenacao-95', p_limit := 2, p_offset := 0) limit 1),
  5::bigint,
  'total_count conta só os publicados da categoria de teste'
);

select finish();
rollback;
