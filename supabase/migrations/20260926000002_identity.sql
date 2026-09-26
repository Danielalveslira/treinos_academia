-- Identity: profile table linked to auth.users, username reservation, public profile mirror

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'user' check (role in ('user', 'superadmin')),
  created_at timestamptz not null default now(),
  username text unique,
  bio text check (char_length(bio) <= 300),
  share_statistics boolean not null default false,
  public_profile_version smallint not null default 0,
  sexo text check (sexo in ('masculino', 'feminino', 'nao_informar')),
  data_nascimento date,
  account_status text not null default 'active' check (account_status in ('active', 'disabled', 'deleting')),
  disabled_at timestamptz,
  disabled_by uuid references public.users(id),
  disabled_reason text check (char_length(disabled_reason) <= 500),
  legal_acceptance_version text,
  legal_acceptance_digest text,
  legal_acceptance_accepted_at timestamptz
);

create table public.usernames (
  username text primary key check (username ~ '^[a-z0-9_]{3,20}$'),
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index usernames_user_id_idx on public.usernames(user_id);

create table public.public_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  username text,
  bio text check (char_length(bio) <= 300),
  share_statistics boolean not null default false
);

create table public.public_profile_statistics (
  user_id uuid primary key references public.public_profiles(user_id) on delete cascade,
  entries integer not null check (entries >= 0),
  sets numeric not null check (sets >= 0),
  updated_at timestamptz not null default now()
);

-- Bootstrap a minimal profile row whenever a new auth user is created.
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
