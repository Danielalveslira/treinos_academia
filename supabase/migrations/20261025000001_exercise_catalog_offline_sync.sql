-- Suporte ao catálogo de exercícios OFFLINE (dados + imagens oficiais já preparados no
-- aparelho) -- docs/prompts/EVOLUTUS_PROMPT_CATALOGO_OFFLINE_COMPLETO.md. Puramente aditiva:
-- NÃO altera search_exercise_catalog, RLS existente nem nenhuma função/tabela alheia.
-- Teste pgTAP correspondente: supabase/tests/exercise_catalog_offline_sync_test.sql.
--
-- Dois problemas resolvidos:
--
-- 1) Revisão barata do catálogo (get_exercise_catalog_revision): hoje só
--    private.apply_published_visual_set grava updated_at em exercise_catalog -- reimportação de
--    texto e uma futura desativação (is_active) não o tocam, então MAX(updated_at) sozinho não é
--    uma revisão confiável. O trigger abaixo corrige isso para QUALQUER update futuro, sem mudar
--    o comportamento de quem já escreve updated_at manualmente (só passa a ser redundante).
--    Exclusões físicas (se um dia existirem) não disparam trigger, mas já mudam count(*), que
--    também compõe a revisão.
--
-- 2) Varredura completa determinística (list_exercise_catalog_for_sync): search_exercise_catalog
--    clampa p_limit em 50 no servidor (limit least(greatest(p_limit,1),50)) e, sem termo de busca,
--    ordena só por name -- instável entre chamadas separadas se houver nomes repetidos, podendo
--    pular/duplicar linhas numa varredura completa por offset. Keyset por id (PK, ordem total e
--    estável) evita isso: cada página pede "o que vem depois do último id visto".

create function public._touch_exercise_catalog_updated_at() returns trigger
  language plpgsql
  as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger exercise_catalog_touch_updated_at
  before update on public.exercise_catalog
  for each row
  execute function public._touch_exercise_catalog_updated_at();

-- revision = "<max(updated_at) iso-8601 utc ou vazio>:<count(*) ativos>". Qualquer mudança no
-- conjunto de ativos (ativação/desativação/reimportação/publicação de imagem/exclusão) altera
-- esta string -- não precisa ser "bonita", só diferente quando algo relevante mudou.
-- security invoker (padrão): respeita exercise_catalog_public_read (is_active) como qualquer
-- select normal -- nunca expõe mais do que a leitura pública já expõe.
create function public.get_exercise_catalog_revision()
returns table (revision text, total_active bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(to_char(max(ec.updated_at) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), '')
      || ':' || count(*)::text as revision,
    count(*) as total_active
  from public.exercise_catalog ec
  where ec.is_active
$$;

grant execute on function public.get_exercise_catalog_revision() to anon, authenticated;

-- Mesmas colunas de search_exercise_catalog (menos total_count, que não faz sentido em keyset),
-- sem ranking por similaridade -- só a varredura completa dos ativos, em ordem de id.
create function public.list_exercise_catalog_for_sync(
  p_after_id uuid default null,
  p_limit integer default 50
) returns table (
  id uuid, provider text, provider_exercise_id text, name text,
  primary_muscle text, muscles text[], equipment text, category text,
  difficulty text, force text, mechanic text, instructions text[],
  media_refs jsonb, source_media_refs jsonb, published_media_refs jsonb
) language sql
  stable
  security invoker
  set search_path = public
as $$
  select
    ec.id, ec.provider, ec.provider_exercise_id, ec.name, ec.primary_muscle,
    ec.muscles, ec.equipment, ec.category, ec.difficulty, ec.force, ec.mechanic,
    ec.instructions, ec.media_refs, ec.source_media_refs, ec.published_media_refs
  from public.exercise_catalog ec
  where ec.is_active
    and (p_after_id is null or ec.id > p_after_id)
  order by ec.id
  limit least(greatest(p_limit, 1), 50)
$$;

grant execute on function public.list_exercise_catalog_for_sync(uuid, integer) to anon, authenticated;
