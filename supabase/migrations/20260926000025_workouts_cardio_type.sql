-- Treinos ganharam um segundo tipo (cardio) no main, ao lado do de força (setDetails).
-- set_details/sets viram opcionais (só fazem sentido pra 'strength'); duration_minutes/
-- distance_km só fazem sentido pra 'cardio'. created_at e type são imutáveis depois de
-- criados (não dá pra editar um registro de força pra virar cardio) — reforçado por
-- trigger, porque RLS sozinha não compara OLD vs NEW de forma direta numa expressão.
alter table public.workouts
  alter column set_details drop not null,
  alter column sets drop not null,
  add column if not exists type text not null default 'strength' check (type in ('strength', 'cardio')),
  add column if not exists duration_minutes numeric check (duration_minutes > 0 and duration_minutes <= 600),
  add column if not exists distance_km numeric check (distance_km > 0 and distance_km <= 500);

alter table public.workouts drop constraint if exists workouts_sets_match;
alter table public.workouts drop constraint if exists workouts_set_details_shape;

alter table public.workouts add constraint workouts_type_shape check (
  (type = 'strength'
    and set_details is not null and sets is not null
    and jsonb_array_length(set_details) = sets
    and jsonb_typeof(set_details) = 'array'
    and jsonb_array_length(set_details) <= 10
    and public.valid_set_details(set_details)
    and duration_minutes is null and distance_km is null)
  or
  (type = 'cardio'
    and duration_minutes is not null
    and set_details is null and sets is null)
);

create or replace function public.enforce_workout_immutable_fields() returns trigger
  language plpgsql as $$
begin
  if new.created_at <> old.created_at then
    raise exception 'CREATED_AT_IMMUTABLE';
  end if;
  if new.type <> old.type then
    raise exception 'TYPE_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger workouts_enforce_immutable
  before update on public.workouts
  for each row execute function public.enforce_workout_immutable_fields();
