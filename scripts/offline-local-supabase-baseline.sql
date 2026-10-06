-- TESTE LOCAL SOMENTE. A imagem standalone de Postgres do Supabase não inclui a
-- migração do serviço Storage nem todas as colunas atuais do Auth gerenciado.
-- Nunca aplicar em projeto remoto; a cloud já possui essas estruturas.
create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null,
  name text not null
);
alter table storage.objects enable row level security;

alter table auth.users
  add column if not exists email_confirmed_at timestamptz,
  add column if not exists phone text,
  add column if not exists banned_until timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists is_anonymous boolean;
