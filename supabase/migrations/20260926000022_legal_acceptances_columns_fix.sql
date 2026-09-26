-- Corrige uma migration já aplicada na nuvem (20260926000007_legal.sql) que foi editada
-- DEPOIS de já ter sido enviada: migrations aplicadas nunca são reexecutadas pelo
-- `supabase db push`, então o ajuste só passou a valer localmente (onde `db reset`
-- sempre recria tudo do zero a partir do conteúdo atual dos arquivos) — a nuvem ficou
-- travada na versão original, sem estas duas colunas e com `ip` ainda obrigatório.
-- Isso é o que causava o 42703 (undefined_column) em accept_legal_documents.
alter table public.legal_acceptances
  add column if not exists accepted boolean not null default true,
  add column if not exists health_data_consent boolean not null default true;

alter table public.legal_acceptances alter column ip drop not null;
