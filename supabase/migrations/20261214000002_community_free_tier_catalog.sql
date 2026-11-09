-- Introduz o tier gratuito "starter" (primeira comunidade grátis, 24h de retenção -- mesma
-- regra de retenção de "essential"). "free" é um booleano explícito no catálogo -- nunca
-- inferido por preço nulo/zero: preço NULL em essential/plus/archive já significa "forma de
-- pagamento indisponível", não "grátis". Starter nunca tem preço em nenhuma moeda (constraint
-- abaixo garante isso). Não altera nenhum preço existente (300/600 EvoCoins) nem define preço
-- de EvoCash para archive (continua indisponível -- fora de escopo desta mudança).

-- Os checks de `tier` em community_creation_products e communities foram criados inline (sem
-- nome explícito na migration original) -- descobrir o nome real por introspecção em vez de
-- adivinhar. Não usar pg_get_constraintdef(oid) ILIKE '%tier in%': o Postgres pode normalizar
-- "tier IN (a,b,c)" para "tier = ANY (ARRAY[a,b,c])" no texto reconstruído, o que faria esse
-- casamento textual falhar silenciosamente (a busca não acha nada, o DROP não roda, e o ADD
-- CONSTRAINT seguinte convive com o check antigo ainda vivo -- que rejeitaria 'starter').
-- Em vez de casar texto, identificar a constraint estruturalmente: é o único CHECK em contype='c'
-- cujo `conkey` é EXATAMENTE a coluna `tier` (1 coluna só) -- o check de retenção/arquivo-só-cash
-- referencia tier junto com post_retention_mode/evocoins_price (conkey com 2+ colunas), então
-- nunca é confundido com o check de tier isolado por esse critério.
do $$
declare
  v_conname text;
  v_tier_attnum smallint;
begin
  select attnum into v_tier_attnum from pg_attribute
    where attrelid = 'public.community_creation_products'::regclass and attname = 'tier' and not attisdropped;

  select conname into v_conname from pg_constraint
    where conrelid = 'public.community_creation_products'::regclass
      and contype = 'c'
      and conkey = array[v_tier_attnum];
  if v_conname is not null then
    execute format('alter table public.community_creation_products drop constraint %I', v_conname);
  end if;
end $$;

alter table public.community_creation_products
  add constraint community_creation_products_tier_ck check (tier in ('essential', 'plus', 'archive', 'starter'));

alter table public.community_creation_products
  drop constraint community_creation_products_retention_ck;
alter table public.community_creation_products
  add constraint community_creation_products_retention_ck check (
    (tier in ('essential', 'starter') and post_retention_mode = '24h')
    or (tier = 'plus' and post_retention_mode = '30d')
    or (tier = 'archive' and post_retention_mode = 'no_auto_expiration')
  );

alter table public.community_creation_products add column free boolean not null default false;
alter table public.community_creation_products
  add constraint community_creation_products_free_no_price_ck check (
    not free or (evocoins_price is null and evocash_price is null)
  );

insert into public.community_creation_products (tier, post_retention_mode, evocoins_price, evocash_price, free)
values ('starter', '24h', null, null, true);

-- communities: mesmo tratamento para o check de tier (também criado inline, sem nome) -- mesma
-- técnica estrutural via conkey, pelo mesmo motivo (nunca casar texto reconstruído pelo Postgres).
do $$
declare
  v_conname text;
  v_tier_attnum smallint;
begin
  select attnum into v_tier_attnum from pg_attribute
    where attrelid = 'public.communities'::regclass and attname = 'tier' and not attisdropped;

  select conname into v_conname from pg_constraint
    where conrelid = 'public.communities'::regclass
      and contype = 'c'
      and conkey = array[v_tier_attnum];
  if v_conname is not null then
    execute format('alter table public.communities drop constraint %I', v_conname);
  end if;
end $$;

alter table public.communities
  add constraint communities_tier_ck check (tier in ('legacy', 'essential', 'plus', 'archive', 'starter'));

alter table public.communities drop constraint communities_tier_retention_ck;
alter table public.communities
  add constraint communities_tier_retention_ck check (
    (tier in ('legacy', 'essential', 'starter') and post_retention_mode = '24h')
    or (tier = 'plus' and post_retention_mode = '30d')
    or (tier = 'archive' and post_retention_mode = 'no_auto_expiration')
  );

-- list_community_creation_products (texto efetivo em 20261114000003) monta o jsonb campo a
-- campo -- precisa ser redefinida para incluir "free" e tratar starter como grátis, não como
-- "disponível por engano". Mesma assinatura (sem parâmetros): CREATE OR REPLACE é seguro, sem
-- risco de overload. Estrutura (case externo para sessão/auth, coalesce para '[]' quando não
-- há produto ativo) preservada igual ao original, só o jsonb_build_object e a ordenação mudam.
create or replace function public.list_community_creation_products()
returns jsonb
stable language sql security definer set search_path = '' as $$
  select case
    when (select auth.uid()) is null then null
    when not coalesce(private.current_session_active(), false) then null
    else coalesce(jsonb_agg(jsonb_build_object(
      'tier', p.tier,
      'postRetentionMode', p.post_retention_mode,
      'evoCoinsPrice', p.evocoins_price,
      'evoCashPrice', p.evocash_price,
      'free', p.free,
      'available', p.free or p.evocoins_price is not null or p.evocash_price is not null
    ) order by case p.tier when 'starter' then 0 when 'essential' then 1 when 'plus' then 2 else 3 end), '[]'::jsonb)
  end
  from public.community_creation_products p
  where p.active
$$;
