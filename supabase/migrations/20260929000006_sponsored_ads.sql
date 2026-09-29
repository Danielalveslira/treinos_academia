-- Porta sponsoredAdsService.js (Firestore direto, sem Cloud Function, gated só por
-- firestore.rules) pra Supabase. Escrita continua direta do cliente (insert/update/delete
-- via RLS), igual ao original -- mas os dois tetos (MAX_ACTIVE_ADS_PER_COMMUNITY/
-- MAX_ACTIVE_GLOBAL_ADS) que lá eram só uma checagem best-effort no client ("Duas lacunas
-- conhecidas e aceitas de propósito", ver comentário original: sem transação real porque
-- o SDK do Firestore não permite transaction.get() numa Query) viram um trigger de banco
-- aqui -- Postgres não tem essa limitação, então o teto passa a valer de verdade (nenhum
-- client consegue furar escrevendo direto), sem precisar de uma RPC só para isso.

create table public.sponsored_ads (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check (char_length(partner_name) between 1 and 60),
  title text not null check (char_length(title) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  image_url text check (image_url is null or char_length(image_url) <= 500),
  cta_label text check (cta_label is null or char_length(cta_label) <= 30),
  cta_type text check (cta_type is null or cta_type in ('external', 'internal')),
  cta_target text check (cta_target is null or char_length(cta_target) <= 300),
  expires_at timestamptz,
  community_ids uuid[] not null default '{}',
  is_global boolean not null default false,
  display_mode text[] not null default '{}',
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  -- ctaType/ctaTarget existem se e somente se ctaLabel existe -- mesma regra condicional
  -- de isValidSponsoredAd (firestore.rules) / validateSponsoredAd (validators.js).
  constraint sponsored_ads_cta_shape check (
    (cta_label is not null) = (cta_type is not null)
    and (cta_label is not null) = (cta_target is not null)
  ),
  -- Mesmos padrões de isValidCtaTarget: externo precisa de https://, interno precisa de
  -- uma barra só (não duas -- "//evil.com" é uma URL "protocol-relative" válida que o
  -- navegador resolve pra outro domínio; "/\evil.com" corre o mesmo risco por
  -- normalização de barra invertida em alguns navegadores).
  constraint sponsored_ads_cta_target_shape check (
    cta_target is null
    or (cta_type = 'external' and cta_target ~ '^https://.+$')
    or (cta_type = 'internal' and cta_target ~ '^/([^/\\].*)?$')
  ),
  constraint sponsored_ads_community_ids_size check (
    coalesce(array_length(community_ids, 1), 0) <= 50
  ),
  -- isGlobal e communityIds são ortogonais, não mutuamente exclusivos -- o único estado
  -- inválido é não aparecer em lugar nenhum.
  constraint sponsored_ads_target_shape check (
    coalesce(array_length(community_ids, 1), 0) >= 1 or is_global = true
  ),
  constraint sponsored_ads_display_mode_shape check (
    coalesce(array_length(display_mode, 1), 0) >= 1 and display_mode <@ array['feed', 'banner']
  )
);
create index sponsored_ads_community_ids_idx on public.sponsored_ads using gin(community_ids);

alter table public.sponsored_ads enable row level security;
-- Leitura: superadmin vê tudo (painel), qualquer autenticado vê anúncios globais, e quem
-- participa de pelo menos uma comunidade listada vê os direcionados a ela -- mesma regra
-- de isSponsoredAds acima, mas como filtro de linha real (RLS filtra documento a
-- documento; a query nunca é negada por inteiro como no equivalente do Firestore).
create policy sponsored_ads_select on public.sponsored_ads for select
  using (
    public.is_superadmin()
    or (is_global and auth.uid() is not null)
    or exists (
      select 1 from public.community_members cm
      where cm.user_id = auth.uid() and cm.community_id = any(community_ids)
    )
  );
create policy sponsored_ads_insert on public.sponsored_ads for insert
  with check (public.is_superadmin() and created_by = auth.uid());
create policy sponsored_ads_update on public.sponsored_ads for update
  using (public.is_superadmin())
  with check (public.is_superadmin());
create policy sponsored_ads_delete on public.sponsored_ads for delete
  using (public.is_superadmin());

create or replace function public.enforce_sponsored_ad_immutable_fields() returns trigger
  language plpgsql as $$
begin
  if new.created_by <> old.created_by then raise exception 'CREATED_BY_IMMUTABLE'; end if;
  if new.created_at <> old.created_at then raise exception 'CREATED_AT_IMMUTABLE'; end if;
  return new;
end;
$$;
create trigger sponsored_ads_enforce_immutable
  before update on public.sponsored_ads
  for each row execute function public.enforce_sponsored_ad_immutable_fields();

-- Equivalente a assertUnderActiveAdsCap/assertUnderActiveGlobalAdsCap, como garantia de
-- banco em vez de checagem best-effort do client. Não filtra por expires_at de propósito
-- (mesmo motivo do original: um anúncio vencido que ninguém excluiu ainda continua
-- "ocupando vaga", empurrando o admin a limpar em vez de deixar acumular sem limite).
create or replace function public.enforce_sponsored_ad_caps() returns trigger
  language plpgsql as $$
declare
  v_community_id uuid;
  v_count integer;
begin
  foreach v_community_id in array new.community_ids loop
    select count(*) into v_count from public.sponsored_ads
      where id <> new.id and v_community_id = any(community_ids);
    if v_count >= 6 then
      -- communityId embutido na mensagem (não só o código) porque SponsoredAdForm.jsx usa
      -- err.communityId pra destacar o seletor certo -- com várias comunidades marcadas,
      -- a que estourou o teto pode não ser a primeira da lista.
      raise exception 'COMMUNITY_AD_CAP_REACHED:%', v_community_id;
    end if;
  end loop;

  if new.is_global then
    select count(*) into v_count from public.sponsored_ads where id <> new.id and is_global;
    if v_count >= 6 then
      raise exception 'GLOBAL_AD_CAP_REACHED';
    end if;
  end if;

  return new;
end;
$$;
create trigger sponsored_ads_enforce_caps
  before insert or update on public.sponsored_ads
  for each row execute function public.enforce_sponsored_ad_caps();
