-- Exercícios ganharam integração com o catálogo estático (873 exercícios pré-cadastrados,
-- servidos como JSON+WebP fora do banco — não precisa de tabela própria) e reordenação
-- manual por grupo muscular.
alter table public.exercises
  add column if not exists type text not null default 'strength' check (type in ('strength', 'cardio')),
  add column if not exists source text not null default 'custom' check (source in ('custom', 'catalog')),
  add column if not exists catalog_exercise_id text check (char_length(catalog_exercise_id) between 1 and 100),
  add column if not exists "order" integer check ("order" between 0 and 299);

alter table public.exercises add constraint exercises_catalog_source_shape check (
  (source = 'catalog' and catalog_exercise_id is not null)
  or (source = 'custom' and catalog_exercise_id is null)
);

alter table public.exercises drop constraint if exists exercises_muscle_group_check;
alter table public.exercises add constraint exercises_muscle_group_check
  check (char_length(muscle_group) between 1 and 30);
