-- Benefício "primeira comunidade gratuita": uma vez por conta, para sempre. A tabela é o
-- próprio mecanismo de antifraude -- a decisão de bloqueio é só "a linha existe", nunca depende
-- de uma comunidade continuar existindo. community_id tem ON DELETE SET NULL (nunca CASCADE):
-- excluir a comunidade grátis NÃO libera o benefício, só perde a referência de qual comunidade
-- era (fica só o registro histórico de que o benefício foi usado).
create table public.community_free_creation_grants (
  user_id uuid primary key references public.users(id) on delete cascade,
  community_id uuid references public.communities(id) on delete set null,
  granted_at timestamptz not null default now(),
  source text not null check (source in ('new_user', 'backfill_owner', 'backfill_ledger'))
);
alter table public.community_free_creation_grants enable row level security;
revoke all on public.community_free_creation_grants from anon, authenticated;

-- Backfill para usuários existentes: conceder (nunca negar) o grant a quem já criou uma
-- comunidade antes desta migration, para que ninguém ganhe uma SEGUNDA comunidade de graça só
-- porque a gratuidade não existia quando criou a primeira. Dois sinais independentes, union por
-- ON CONFLICT DO NOTHING (idempotente, seguro reexecutar).
--
-- Sinal 1 -- communities.created_by (NUNCA owner_id), filtrado por owner_id IS NOT NULL:
--   created_by é imutável (trigger enforce_community_immutable_fields trava isso para sempre,
--   mesmo que owner_id mude por ação de superadmin) -- identifica quem DE FATO criou a
--   comunidade, não quem é o dono atual. O filtro owner_id IS NOT NULL exclui comunidades
--   oficiais do painel admin (nascem sempre com owner_id nulo, communitiesService.js) sem
--   precisar de nenhum sinal extra -- um superadmin que cria várias comunidades oficiais nunca
--   é marcado como tendo "usado" o benefício pessoal por isso. Se um dia existir transferência
--   de propriedade (hoje não existe nenhum mecanismo no código), o destinatário nunca é marcado
--   como consumidor só por receber a comunidade -- só quem originalmente a criou.
insert into public.community_free_creation_grants (user_id, community_id, source)
select created_by, (array_agg(id order by created_at))[1], 'backfill_owner'
from public.communities
where owner_id is not null
group by created_by
on conflict (user_id) do nothing;

-- Sinal 2 -- economy_transactions: cobre quem pagou por uma criação de comunidade cuja linha em
-- `communities` já foi excluída (hard delete) depois -- o ledger é append-only e sobrevive;
-- community_creation_requests NÃO serve para isso (tem ON DELETE CASCADE em community_id, então
-- some junto com a comunidade). O motivo gravado por create_community é sempre exatamente
-- 'community_creation' (confirmado lendo o SQL em produção) -- nunca existiu uma string
-- 'create_community' como reason no ledger.
--
-- Limitação documentada: o fluxo legado create_community_with_cash (removido em
-- 20261008000003) nunca gravava ledger, só inseria direto em communities/community_members.
-- Comunidades criadas por ele e já excluídas antes desta migration não têm sinal confiável e
-- ficam de fora -- decisão conservadora e consciente (dado histórico não determinável com
-- segurança), não uma omissão.
-- economy_transactions.user_id tem FK relaxada (ON DELETE SET NULL, worker de exclusão de
-- conta) -- um débito de conta já excluída fica com user_id NULL; sem conta para conceder o
-- grant, "where user_id is not null" exclui isso (NULL colidiria com a PK NOT NULL do destino,
-- abortando o INSERT inteiro se não filtrado).
insert into public.community_free_creation_grants (user_id, community_id, source)
select user_id, null, 'backfill_ledger'
from public.economy_transactions
where user_id is not null
  and reason = 'community_creation' and reference_type = 'community' and direction = 'debit'
group by user_id
on conflict (user_id) do nothing;
