-- Legal acceptance history, per-user notices, and the published terms themselves.

create table public.legal_acceptances (
  user_id uuid not null references public.users(id) on delete cascade,
  version text not null,
  digest text not null,
  accepted_at timestamptz not null default now(),
  ip inet,
  accepted boolean not null default true,
  health_data_consent boolean not null default true,
  primary key (user_id, version)
);

create table public.notices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  rule text not null,
  reason text not null,
  community_id uuid references public.communities(id),
  until timestamptz,
  created_at timestamptz not null default now()
);

create table public.legal_policy (
  id boolean primary key default true check (id),
  version text,
  published boolean not null default false,
  digest text,
  published_at timestamptz
);

create table public.legal_versions (
  version text primary key,
  manifest jsonb not null,
  documents jsonb not null,
  digest text not null,
  created_at timestamptz not null default now()
);
