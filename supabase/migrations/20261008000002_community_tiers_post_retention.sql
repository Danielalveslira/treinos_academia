-- Criação de comunidades: produtos (tier), retenção das publicações e expiração por post.
--
-- 1) community_creation_products: preço e retenção de cada tier, só no servidor.
-- 2) communities.tier / post_retention_mode: comunidades existentes ficam 'legacy'/'24h'
--    (o comportamento que já tinham), sem cobrança retroativa.
-- 3) statuses.retention_mode + trigger: expires_at deixa de ser decidido pelo cliente (hoje
--    qualquer usuário podia enviar uma data distante) e é calculado no INSERT a partir da
--    comunidade. O post guarda a própria regra: upgrade posterior só vale para posts novos.
-- 4) expires_at nulo = sem expiração automática (autor/moderação ainda podem excluir).

create table public.community_creation_products (
  tier text primary key check (tier in ('essential', 'plus', 'archive')),
  post_retention_mode text not null check (post_retention_mode in ('24h', '30d', 'no_auto_expiration')),
  evocoins_price integer check (evocoins_price > 0),
  evocash_price integer check (evocash_price > 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint community_creation_products_retention_ck check (
    (tier = 'essential' and post_retention_mode = '24h')
    or (tier = 'plus' and post_retention_mode = '30d')
    or (tier = 'archive' and post_retention_mode = 'no_auto_expiration')
  ),
  -- Arquivo só em EvoCash.
  constraint community_creation_products_archive_cash_only_ck check (tier <> 'archive' or evocoins_price is null)
);
alter table public.community_creation_products enable row level security;
revoke all on public.community_creation_products from anon, authenticated;

-- Preço NULL = forma de pagamento indisponível (falha fechada). Os valores em EvoCash ainda
-- não foram definidos: enquanto forem NULL ninguém consegue pagar com EvoCash, e o Arquivo
-- (só EvoCash) fica indisponível.
insert into public.community_creation_products (tier, post_retention_mode, evocoins_price, evocash_price) values
  ('essential', '24h', 300, null),
  ('plus', '30d', 600, null),
  ('archive', 'no_auto_expiration', null, null);

alter table public.communities
  add column tier text not null default 'legacy'
    check (tier in ('legacy', 'essential', 'plus', 'archive')),
  add column post_retention_mode text not null default '24h'
    check (post_retention_mode in ('24h', '30d', 'no_auto_expiration')),
  add constraint communities_tier_retention_ck check (
    (tier in ('legacy', 'essential') and post_retention_mode = '24h')
    or (tier = 'plus' and post_retention_mode = '30d')
    or (tier = 'archive' and post_retention_mode = 'no_auto_expiration')
  );

-- Idempotência/auditoria da criação e do upgrade: o que foi pedido, o que foi cobrado.
alter table public.community_creation_requests
  add column kind text not null default 'create' check (kind in ('create', 'upgrade')),
  add column tier text,
  add column payment_asset text check (payment_asset in ('coin', 'cash')),
  add column amount_charged integer check (amount_charged > 0);

-- ---------------------------------------------------------------------------
-- Publicações: retenção por post
-- ---------------------------------------------------------------------------
alter table public.statuses
  add column retention_mode text not null default '24h'
    check (retention_mode in ('24h', '30d', 'no_auto_expiration')),
  alter column expires_at drop not null,
  add constraint statuses_retention_expiry_ck check (
    (retention_mode = 'no_auto_expiration') = (expires_at is null)
  );

-- O feed passa a ordenar por created_at (expires_at deixa de ser uma ordem confiável: pode ser
-- nulo e varia por retenção).
create index statuses_community_created_idx on public.statuses(community_id, created_at desc);

create or replace function private.statuses_apply_retention() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_mode text;
begin
  select post_retention_mode into v_mode from public.communities where id = new.community_id;
  v_mode := coalesce(v_mode, '24h');
  -- Cliente (auth.uid() presente) nunca decide expires_at/retention_mode. Inserção interna
  -- (sem sessão de usuário: service_role, seeds) mantém um expires_at explícito.
  if (select auth.uid()) is not null or new.expires_at is null then
    new.retention_mode := v_mode;
    new.expires_at := case v_mode
      when '24h' then now() + interval '24 hours'
      when '30d' then now() + interval '30 days'
      else null
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.statuses_apply_retention() from public, anon, authenticated;

create trigger statuses_apply_retention
  before insert on public.statuses
  for each row execute function private.statuses_apply_retention();

-- expires_at nulo = sem expiração: comentários nunca fecham (comments_close_at nulo). A
-- coluna gerada não pode ser alterada no lugar.
alter table public.statuses drop column comments_close_at;
alter table public.statuses add column comments_close_at timestamptz generated always as (
  case when expires_at is null then null else greatest(
    expires_at,
    case when type = 'workout' then workout_date else null end,
    case when promoted then promoted_until else null end
  ) end
) stored;

create or replace function private.comments_open(p_status public.statuses)
returns boolean
language sql stable set search_path = '' as $$
  select p_status.expires_at is null or coalesce(p_status.comments_close_at > now(), false)
$$;

-- Leitura de foto: post sem expiração continua legível.
drop policy if exists status_photos_read on storage.objects;
create policy status_photos_read on storage.objects for select
  using (
    bucket_id = 'status-photos'
    and exists (
      select 1 from public.statuses s
      where s.photo_path = 'statusPhotos/' || storage.objects.name
        and (s.expires_at is null or s.expires_at > now())
        and public.is_community_member(s.community_id)
    )
  );

-- ---------------------------------------------------------------------------
-- communities: tier/retenção só mudam pelas RPCs; reativar respeita o limite
-- ---------------------------------------------------------------------------
-- Dono pode dar UPDATE na própria comunidade (policy communities_update). Sem esta trava
-- ele trocaria tier/post_retention_mode direto (sem pagar) ou desativaria comunidades para
-- criar mais e depois reativá-las, furando o limite. As RPCs security definer rodam como o
-- dono da função (current_user <> authenticated), por isso passam.
-- O trigger roda com os privilégios de quem faz o UPDATE (precisa, para enxergar
-- current_user), e esse usuário não lê community_creation_rules nem conta comunidades de
-- outros. Este helper security definer só responde sobre o PRÓPRIO usuário logado.
create or replace function private.community_owner_limit_reached(p_owner_id uuid, p_exclude_id uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) = p_owner_id
    and (
      select count(*) from public.communities c
      where c.owner_id = p_owner_id and c.is_active and c.deletion_status is null and c.id <> p_exclude_id
    ) >= (select max_owned_communities from public.community_creation_rules where id)
$$;
revoke all on function private.community_owner_limit_reached(uuid, uuid) from public, anon;
grant execute on function private.community_owner_limit_reached(uuid, uuid) to authenticated;
grant usage on schema private to authenticated;

create or replace function public.enforce_community_immutable_fields() returns trigger
  language plpgsql as $$
begin
  if new.created_by <> old.created_by then raise exception 'CREATED_BY_IMMUTABLE'; end if;
  if new.created_at <> old.created_at then raise exception 'CREATED_AT_IMMUTABLE'; end if;
  if new.owner_id is distinct from old.owner_id and not public.is_superadmin() then
    raise exception 'OWNER_ID_IMMUTABLE';
  end if;

  if current_user in ('authenticated', 'anon') and not coalesce(public.is_superadmin(), false) then
    if new.tier is distinct from old.tier or new.post_retention_mode is distinct from old.post_retention_mode then
      raise exception 'TIER_IMMUTABLE';
    end if;
    if new.is_active and not old.is_active and new.owner_id is not null then
      perform pg_advisory_xact_lock(hashtextextended('community_creation:' || new.owner_id::text, 0));
      if private.community_owner_limit_reached(new.owner_id, new.id) then
        raise exception 'COMMUNITY_LIMIT_REACHED';
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- Inserção direta (policy communities_insert = superadmin): oficial nasce 'legacy'/'24h'.
-- Qualquer outro ator não insere comunidade -- RLS já bloqueia; esta trava é cinto e
-- suspensório contra tier forjado se a policy for afrouxada no futuro.
create or replace function private.communities_guard_insert() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and not coalesce(public.is_superadmin(), false)
     and (new.tier <> 'legacy' or new.post_retention_mode <> '24h') then
    raise exception 'TIER_IMMUTABLE';
  end if;
  return new;
end;
$$;
create trigger communities_guard_insert
  before insert on public.communities
  for each row execute function private.communities_guard_insert();

-- Hardening: função de trigger não precisa de EXECUTE público; community_creation_requests só
-- é escrita pelas RPCs security definer (o cliente só lê as próprias linhas, via policy).
revoke all on function private.communities_guard_insert() from public, anon, authenticated;
revoke insert, update, delete on public.community_creation_requests from anon, authenticated;
