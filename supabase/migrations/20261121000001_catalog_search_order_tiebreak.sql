-- Fase 4 do Catálogo (prompt docs/prompts/PROMPT_EVOLUTUS_FASE_4_CATALOGO_V2.md, seção 3.2/7.3):
-- a vitrine agora pagina o catálogo publicado desde a primeira visita, inclusive sem termo de
-- busca/filtro. `search_exercise_catalog` já ordenava por similaridade (com termo) e por
-- `ec.name` (sem termo), mas SEM nenhum desempate -- dois exercícios com o mesmo `name` (ou a
-- mesma similaridade) não têm ordem relativa garantida entre chamadas separadas do Postgres.
-- Paginando por `limit`/`offset` (não keyset), isso pode repetir ou pular uma linha entre uma
-- página e a próxima quando há nomes iguais.
--
-- Mudança MÍNIMA e aditiva: acrescenta `ec.id` como último critério de ordenação (nunca se
-- repete, é a chave primária). Parâmetros, tipo de retorno, filtros e permissões continuam
-- idênticos -- só a ordem de desempate muda. `create or replace function` preserva o OID (e os
-- GRANTs já concedidos), mas o grant abaixo é repetido por clareza/idempotência, seguindo a
-- convenção já usada neste arquivo de migrations.
set local lock_timeout = '5s';

create or replace function public.search_exercise_catalog(
  p_query text default null,
  p_category text default null,
  p_equipment text default null,
  p_muscle text default null,
  p_difficulty text default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns table (
  id uuid, provider text, provider_exercise_id text, name text,
  primary_muscle text, muscles text[], equipment text, category text,
  difficulty text, force text, mechanic text, instructions text[],
  media_refs jsonb, source_media_refs jsonb, published_media_refs jsonb, total_count bigint
) language sql stable set search_path = public, extensions as $$
  select
    ec.id, ec.provider, ec.provider_exercise_id, ec.name, ec.primary_muscle,
    ec.muscles, ec.equipment, ec.category, ec.difficulty, ec.force, ec.mechanic,
    ec.instructions, ec.media_refs, ec.source_media_refs, ec.published_media_refs,
    count(*) over() as total_count
  from public.exercise_catalog ec
  where ec.is_active
    and (p_category is null or ec.category = p_category)
    and (p_equipment is null or ec.equipment = p_equipment)
    and (p_muscle is null or ec.muscles @> array[p_muscle])
    and (p_difficulty is null or ec.difficulty = p_difficulty)
    and (
      p_query is null or p_query = ''
      or ec.name_normalized ilike '%' || public._normalize_search_value(p_query) || '%'
      or ec.name_normalized % public._normalize_search_value(p_query)
    )
  order by
    case when p_query is null or p_query = '' then 0
      else similarity(ec.name_normalized, public._normalize_search_value(p_query)) end desc,
    ec.name asc,
    ec.id asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;
grant execute on function public.search_exercise_catalog to anon, authenticated;
