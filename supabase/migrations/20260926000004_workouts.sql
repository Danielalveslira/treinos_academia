-- Exercises and workouts (formerly subcollections of users/{uid})

-- CHECK constraints cannot contain a bare subquery, so the per-element validation
-- of set_details lives in this helper function instead.
create or replace function public.valid_set_details(details jsonb) returns boolean
  language sql immutable as $$
    select coalesce(bool_and(
      (elem->>'weight')::numeric >= 0 and (elem->>'weight')::numeric <= 10000
      and (elem->>'reps')::int > 0 and (elem->>'reps')::int <= 100000
    ), false)
    from jsonb_array_elements(details) elem
$$;

create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  muscle_group text not null check (char_length(muscle_group) > 0),
  note text check (char_length(note) <= 300),
  active boolean not null default true
);
create index exercises_user_id_idx on public.exercises(user_id);

create table public.workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  set_details jsonb not null,
  sets integer not null check (sets > 0 and sets <= 10),
  date date not null,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  constraint workouts_sets_match check (jsonb_array_length(set_details) = sets),
  constraint workouts_set_details_shape check (
    jsonb_typeof(set_details) = 'array'
    and jsonb_array_length(set_details) <= 10
    and public.valid_set_details(set_details)
  )
);
create index workouts_user_exercise_date_idx on public.workouts(user_id, exercise_id, date desc);
create index workouts_user_date_idx on public.workouts(user_id, date desc);
