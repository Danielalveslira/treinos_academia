-- Nova estratégia: o catálogo de exercícios do Evolutus deixa de ser um proxy ao vivo
-- pra ExerciseAPI e passa a ser nossa própria tabela, alimentada por ingestão em lote do
-- dataset local `imports/exercicios_ptbr.json` (free-exercise-db, licença Unlicense,
-- traduzido pra pt-BR -- ver scripts/import-exercise-catalog.mjs). A ExerciseAPI
-- continua instalada (proxy, secrets, rate limit) até a nova base estar validada; esta
-- migration não mexe nela.

alter table public.exercises drop constraint exercises_provider_check;
alter table public.exercises add constraint exercises_provider_check
  check (provider in ('exerciseapi', 'evolutus_dataset'));

create extension if not exists pg_trgm with schema extensions;

create table public.exercise_catalog (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('evolutus_dataset')),
  provider_exercise_id text not null check (char_length(provider_exercise_id) between 1 and 100),
  name text not null check (char_length(name) between 1 and 150),
  name_normalized text not null,
  primary_muscle text not null check (char_length(primary_muscle) between 1 and 60),
  muscles text[] not null check (array_length(muscles, 1) > 0),
  -- nem todo exercício tem equipamento real (ex.: alongamentos) -- nullable, nunca inventado.
  equipment text check (equipment is null or char_length(equipment) between 1 and 60),
  category text not null check (char_length(category) between 1 and 60),
  difficulty text check (difficulty is null or char_length(difficulty) between 1 and 30),
  force text check (force is null or char_length(force) between 1 and 30),
  mechanic text check (mechanic is null or char_length(mechanic) between 1 and 30),
  instructions text[] not null check (array_length(instructions, 1) > 0),
  -- só referências (ex.: "3_4_Sit-Up/0.jpg") -- nenhum arquivo é baixado/copiado nesta
  -- etapa; estratégia de mídia real fica pra depois (ver diagnóstico aprovado).
  media_refs jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_exercise_id)
);

-- Reaproveita a mesma normalização (minúsculas, sem acento, espaços colapsados) já usada
-- em professional_listings (public._normalize_search_value) -- coluna materializada em
-- vez de índice funcional, pra não depender de declarar unaccent() imutável no índice.
create function public._set_exercise_catalog_name_normalized() returns trigger
  language plpgsql as $$
begin
  new.name_normalized := public._normalize_search_value(new.name);
  return new;
end;
$$;
create trigger exercise_catalog_name_normalized_trigger
  before insert or update of name on public.exercise_catalog
  for each row execute function public._set_exercise_catalog_name_normalized();

create index exercise_catalog_name_trgm_idx on public.exercise_catalog
  using gin (name_normalized extensions.gin_trgm_ops);
create index exercise_catalog_category_idx on public.exercise_catalog (category) where is_active;
create index exercise_catalog_equipment_idx on public.exercise_catalog (equipment) where is_active;
create index exercise_catalog_primary_muscle_idx on public.exercise_catalog (primary_muscle) where is_active;
create index exercise_catalog_muscles_gin_idx on public.exercise_catalog using gin (muscles);

alter table public.exercise_catalog enable row level security;
-- Leitura pública (é o nosso próprio dado curado, não um espelho ao vivo de terceiros).
-- Escrita: só service_role (script de ingestão) -- nenhuma policy de insert/update/delete.
create policy exercise_catalog_public_read on public.exercise_catalog
  for select using (is_active);

-- Busca paginada, tolerante a acento/maiúsculas e a pequenas diferenças de digitação
-- (pg_trgm). security invoker (padrão) -- respeita a policy de leitura acima como
-- qualquer select normal.
create function public.search_exercise_catalog(
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
  media_refs jsonb, total_count bigint
) language sql stable set search_path = public, extensions as $$
  select
    ec.id, ec.provider, ec.provider_exercise_id, ec.name, ec.primary_muscle,
    ec.muscles, ec.equipment, ec.category, ec.difficulty, ec.force, ec.mechanic,
    ec.instructions, ec.media_refs,
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
    ec.name asc
  limit least(greatest(p_limit, 1), 50)
  offset greatest(p_offset, 0)
$$;
grant execute on function public.search_exercise_catalog to anon, authenticated;

-- Atalho opcional pra buscar o conteúdo rico rápido enquanto o item ainda existe no
-- catálogo. ON DELETE SET NULL: apagar/desativar um item do catálogo nunca quebra um
-- treino/histórico já salvo -- o snapshot mínimo (name/muscle_group/equipment,
-- provider/provider_exercise_id) em exercises já garante isso independente deste FK.
alter table public.exercises
  add column if not exists catalog_id uuid references public.exercise_catalog(id) on delete set null;
create index exercises_catalog_id_idx on public.exercises(catalog_id) where catalog_id is not null;
