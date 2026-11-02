-- Documentos comerciais versionados e aceite comprovável por operação.
--
-- Aditiva. Não habilita vendas, não altera preço, duração, saldo, rotatividade,
-- moderação nem a seleção de anúncios, e não publica nenhum documento.
--
-- 1. legal_document_versions / legal_document_policy: registro único e imutável para os
--    documentos comerciais específicos (Condições do EvoCash, Termos de Publicidade e
--    Impulsionamento, Termos das Vitrines e Política de Cancelamento, Arrependimento e
--    Reembolsos). O digest é calculado no servidor (sha256 do jsonb canônico); publicar
--    exige texto marcado como aprovado e só pode ser feito pelo service role.
-- 2. Cada cotação (pedido comercial ou cotação de EvoCash) congela, no mesmo INSERT, a
--    versão vigente do documento aplicável e um snapshot das condições materiais.
-- 3. accept_commercial_terms registra o aceite explícito do titular, vinculado à versão
--    exata, ao digest e ao digest das condições exibidas. Se a política mudou entre a
--    cotação e o aceite, nada é cobrado: o cliente precisa pedir nova cotação.
-- 4. Confirmar um pedido (debitar EvoCash) ou reservar um checkout de EvoCash exige esse
--    aceite. Sem documento publicado, a operação falha fechada. Hoje todos os gates
--    comerciais estão desligados em produção; este é um pré-requisito adicional de
--    lançamento, não uma ativação.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------
-- 1) Registro de documentos comerciais
-- ---------------------------------------------------------------------------------
create table public.legal_document_versions (
  document_id text not null check (document_id ~ '^[a-z][a-z0-9-]{2,63}$'),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  title text not null check (char_length(title) between 3 and 200),
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  digest text not null check (digest ~ '^[0-9a-f]{64}$'),
  registered_at timestamptz not null default clock_timestamp(),
  published_at timestamptz,
  primary key (document_id, version)
);
alter table public.legal_document_versions enable row level security;
create policy legal_document_versions_select on public.legal_document_versions for select
  using (published_at is not null);
revoke insert, update, delete, truncate on public.legal_document_versions from anon, authenticated;

create table public.legal_document_policy (
  document_id text primary key,
  version text not null,
  digest text not null,
  published_at timestamptz not null,
  foreign key (document_id, version) references public.legal_document_versions(document_id, version)
);
alter table public.legal_document_policy enable row level security;
create policy legal_document_policy_select on public.legal_document_policy for select using (true);
revoke insert, update, delete, truncate on public.legal_document_policy from anon, authenticated;
-- Leitura pública somente do que foi publicado (RLS acima); escrita só pelo service role.
grant select on public.legal_document_versions, public.legal_document_policy to anon, authenticated;

create or replace function private.legal_document_digest(p_content jsonb) returns text
language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_content::text, 'UTF8')), 'hex')
$$;
revoke all on function private.legal_document_digest(jsonb) from public, anon, authenticated, service_role;

create or replace function private.legal_document_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'LEGAL_HISTORY_IMMUTABLE' using errcode = '42501'; end if;
  if tg_op = 'INSERT' then
    if new.digest is distinct from private.legal_document_digest(new.content)
       or new.content->>'documentId' is distinct from new.document_id
       or new.content->>'version' is distinct from new.version then
      raise exception 'LEGAL_VERSION_INVALID' using errcode = '22023';
    end if;
    return new;
  end if;
  if (new.document_id, new.version, new.title, new.content, new.digest, new.registered_at)
     is distinct from (old.document_id, old.version, old.title, old.content, old.digest, old.registered_at)
     or (old.published_at is not null and new.published_at is distinct from old.published_at) then
    raise exception 'LEGAL_VERSION_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.legal_document_guard() from public, anon, authenticated, service_role;
create trigger legal_document_versions_guard before insert or update or delete on public.legal_document_versions
  for each row execute function private.legal_document_guard();

-- Publica (registra + ativa) uma versão aprovada. Idempotente para o mesmo conteúdo;
-- recusa conteúdo divergente para uma versão já registrada e qualquer minuta.
create or replace function private.publish_legal_document(p_content jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_doc text := p_content->>'documentId';
  v_version text := p_content->>'version';
  v_digest text;
  v_row public.legal_document_versions;
  v_policy public.legal_document_policy;
begin
  if jsonb_typeof(p_content) is distinct from 'object' or v_doc is null or v_version is null
     or coalesce(p_content->>'title', '') = '' then
    raise exception 'LEGAL_VERSION_INVALID';
  end if;
  if p_content->'approved' is distinct from 'true'::jsonb then
    raise exception 'LEGAL_DRAFT_NOT_PUBLISHABLE';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(84203, pg_catalog.hashtext(v_doc));
  v_digest := private.legal_document_digest(p_content);
  select * into v_row from public.legal_document_versions where document_id = v_doc and version = v_version for update;
  if found and v_row.digest <> v_digest then raise exception 'LEGAL_VERSION_IMMUTABLE'; end if;
  if not found then
    insert into public.legal_document_versions (document_id, version, title, content, digest)
    values (v_doc, v_version, p_content->>'title', p_content, v_digest) returning * into v_row;
  end if;
  select * into v_policy from public.legal_document_policy where document_id = v_doc for update;
  if found and v_policy.version = v_version and v_policy.digest = v_digest then
    return jsonb_build_object('documentId', v_doc, 'version', v_version, 'digest', v_digest, 'repeated', true);
  end if;
  update public.legal_document_versions set published_at = clock_timestamp()
   where document_id = v_doc and version = v_version and published_at is null;
  insert into public.legal_document_policy (document_id, version, digest, published_at)
  values (v_doc, v_version, v_digest, clock_timestamp())
  on conflict (document_id) do update set version = excluded.version, digest = excluded.digest,
    published_at = excluded.published_at;
  return jsonb_build_object('documentId', v_doc, 'version', v_version, 'digest', v_digest, 'repeated', false);
end $$;
revoke all on function private.publish_legal_document(jsonb) from public, anon, authenticated;
grant execute on function private.publish_legal_document(jsonb) to service_role;

create or replace function public.admin_publish_legal_document(p_content jsonb) returns jsonb
language sql security definer set search_path = '' as $$ select private.publish_legal_document(p_content) $$;
revoke all on function public.admin_publish_legal_document(jsonb) from public, anon, authenticated;
grant execute on function public.admin_publish_legal_document(jsonb) to service_role;

-- Documento aplicável a cada oferta. Nenhuma oferta fica isenta: oferta sem documento
-- mapeado e publicado não pode ser contratada.
create table private.commercial_offering_documents (
  offering_code text primary key references public.commercial_offerings(code),
  document_id text not null check (document_id ~ '^[a-z][a-z0-9-]{2,63}$')
);
revoke all on private.commercial_offering_documents from public, anon, authenticated, service_role;
insert into private.commercial_offering_documents (offering_code, document_id) values
  ('ad_community', 'advertising-terms'),
  ('ad_community_banner', 'advertising-terms'),
  ('ad_home', 'advertising-terms'),
  ('ad_network', 'advertising-terms'),
  ('post_boost', 'advertising-terms'),
  ('community_boost', 'advertising-terms'),
  ('product_storefront', 'showcase-publication-terms'),
  ('professional_profile', 'showcase-publication-terms'),
  ('establishment_profile', 'showcase-publication-terms');

-- ---------------------------------------------------------------------------------
-- 2) Snapshot de termos e condições na cotação
-- ---------------------------------------------------------------------------------
create table private.commercial_quote_terms (
  id uuid primary key default gen_random_uuid(),
  order_id uuid unique references public.commercial_orders(id),
  cash_quote_id uuid unique references public.evocash_purchase_quotes(id),
  check (num_nonnulls(order_id, cash_quote_id) = 1),
  document_id text,
  document_version text,
  document_digest text,
  check ((document_version is null) = (document_digest is null)),
  conditions jsonb not null,
  conditions_digest text not null,
  captured_at timestamptz not null default clock_timestamp()
);
revoke all on private.commercial_quote_terms from public, anon, authenticated, service_role;
create trigger commercial_quote_terms_immutable before update or delete on private.commercial_quote_terms
  for each row execute function private.commercial_immutable();

create or replace function private.capture_commercial_quote_terms() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_doc text;
  v_policy public.legal_document_policy;
  v_refund text;
  v_conditions jsonb;
begin
  select p.version into v_refund from public.refund_policies p
    join private.refund_settings s on s.policy_version = p.version;
  if tg_table_name = 'commercial_orders' then
    select document_id into v_doc from private.commercial_offering_documents where offering_code = new.offering_code;
    v_conditions := jsonb_build_object('kind', 'commercial_order', 'offeringCode', new.offering_code,
      'resourceId', new.resource_id, 'contentRevision', new.content_revision::text,
      'priceVersionId', new.price_version_id, 'durationDays', new.duration_days::text,
      'unitPriceCash', new.unit_price_cash::text, 'totalCash', new.total_cash::text, 'unit', 'EvoCash',
      'quoteExpiresAt', new.quote_expires_at, 'autoRenewal', false, 'refundPolicyVersion', v_refund);
  else
    v_doc := 'evocash-terms';
    v_conditions := jsonb_build_object('kind', 'evocash_purchase', 'quantity', new.quantity::text,
      'unitPriceCentavos', new.unit_price_centavos::text, 'totalCentavos', new.total_centavos::text,
      'currency', 'BRL', 'priceVersionId', new.price_version_id, 'quoteExpiresAt', new.expires_at,
      'paymentProvider', 'infinitepay', 'autoRenewal', false, 'refundPolicyVersion', v_refund);
  end if;
  if v_doc is not null then
    select * into v_policy from public.legal_document_policy where document_id = v_doc;
  end if;
  insert into private.commercial_quote_terms (order_id, cash_quote_id, document_id, document_version,
    document_digest, conditions, conditions_digest)
  values (case when tg_table_name = 'commercial_orders' then new.id end,
          case when tg_table_name = 'evocash_purchase_quotes' then new.id end,
          v_doc, v_policy.version, v_policy.digest, v_conditions,
          private.legal_document_digest(v_conditions));
  return new;
end $$;
revoke all on function private.capture_commercial_quote_terms() from public, anon, authenticated, service_role;
create trigger commercial_order_capture_terms after insert on public.commercial_orders
  for each row execute function private.capture_commercial_quote_terms();
create trigger evocash_quote_capture_terms after insert on public.evocash_purchase_quotes
  for each row execute function private.capture_commercial_quote_terms();

-- ---------------------------------------------------------------------------------
-- 3) Evidência de aceite por operação
-- ---------------------------------------------------------------------------------
create table public.commercial_terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  order_id uuid unique references public.commercial_orders(id),
  cash_quote_id uuid unique references public.evocash_purchase_quotes(id),
  check (num_nonnulls(order_id, cash_quote_id) = 1),
  document_id text not null,
  document_version text not null,
  document_digest text not null,
  foreign key (document_id, document_version) references public.legal_document_versions(document_id, version),
  conditions jsonb not null,
  conditions_digest text not null,
  accepted_at timestamptz not null default clock_timestamp()
);
create index commercial_terms_acceptances_user_idx on public.commercial_terms_acceptances(user_id, accepted_at desc);
alter table public.commercial_terms_acceptances enable row level security;
create policy commercial_terms_acceptances_select on public.commercial_terms_acceptances for select
  using (user_id = (select auth.uid()) or public.is_superadmin());
revoke insert, update, delete, truncate on public.commercial_terms_acceptances from anon, authenticated;
grant select on public.commercial_terms_acceptances to authenticated;
create trigger commercial_terms_acceptances_immutable before update or delete on public.commercial_terms_acceptances
  for each row execute function private.commercial_immutable();

create or replace function private.commercial_terms_json(t private.commercial_quote_terms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when t.id is null then null else jsonb_build_object(
    'documentId', t.document_id, 'version', t.document_version, 'digest', t.document_digest,
    'title', (select v.title from public.legal_document_versions v
               where v.document_id = t.document_id and v.version = t.document_version),
    'conditions', t.conditions, 'conditionsDigest', t.conditions_digest,
    'current', exists(select 1 from public.legal_document_policy p
                       where p.document_id = t.document_id and p.version = t.document_version
                         and p.digest = t.document_digest),
    'acceptedAt', (select a.accepted_at from public.commercial_terms_acceptances a
                    where (a.order_id = t.order_id and t.order_id is not null)
                       or (a.cash_quote_id = t.cash_quote_id and t.cash_quote_id is not null))) end
$$;

-- Recriada sobre a definição de 20261207000002 para acrescentar `terms` (o snapshot e o
-- aceite). As demais chaves continuam idênticas.
create or replace function private.commercial_order_json(o public.commercial_orders) returns jsonb
language sql stable set search_path = '' as $$
select jsonb_build_object('id',o.id,'resourceId',o.resource_id,'offeringCode',o.offering_code,'priceVersionId',o.price_version_id,
 'contentRevision',o.content_revision::text,'durationDays',o.duration_days::text,'unitPriceCash',o.unit_price_cash::text,'totalCash',o.total_cash::text,
 'status',o.status,'createdAt',o.created_at,'quoteExpiresAt',o.quote_expires_at,'fulfilledAt',o.fulfilled_at,'periodStart',o.period_start,'periodEnd',o.period_end,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where order_id=o.id),
 'terms',(select private.commercial_terms_json(t) from private.commercial_quote_terms t where t.order_id=o.id))
$$;
create or replace function private.evocash_quote_json(q public.evocash_purchase_quotes) returns jsonb
language sql stable set search_path = '' as $$
select jsonb_build_object('quoteId',q.id,'priceVersionId',q.price_version_id,'quantity',q.quantity::text,
 'unitPriceCentavos',q.unit_price_centavos::text,'totalCentavos',q.total_centavos::text,
 'currency','BRL','createdAt',q.created_at,'expiresAt',q.expires_at,
 'refundPolicy',(select policy_snapshot from private.refund_quote_terms where cash_quote_id=q.id),
 'terms',(select private.commercial_terms_json(t) from private.commercial_quote_terms t where t.cash_quote_id=q.id))
$$;
revoke all on function private.commercial_order_json(public.commercial_orders), private.evocash_quote_json(public.evocash_purchase_quotes),
  private.commercial_terms_json(private.commercial_quote_terms) from public, anon, authenticated, service_role;

create or replace function public.accept_commercial_terms(
  p_source_type text, p_source_id uuid, p_document_version text, p_document_digest text, p_conditions_digest text
) returns jsonb language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  v_uid uuid := (select auth.uid());
  v_terms private.commercial_quote_terms;
  v_order public.commercial_orders;
  v_quote public.evocash_purchase_quotes;
  v_policy public.legal_document_policy;
  v_existing public.commercial_terms_acceptances;
begin
  perform private.require_commercial_user();
  if p_source_type is null or p_source_type not in ('order', 'evocash_quote') or p_source_id is null then
    raise exception 'INVALID_REQUEST';
  end if;
  -- Mesmo primeiro lock das operações comerciais do usuário (user -> ... -> order).
  perform 1 from public.users where id = v_uid for no key update;
  if p_source_type = 'order' then
    select * into v_order from public.commercial_orders where id = p_source_id and payer_user_id = v_uid for update;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
    select * into v_existing from public.commercial_terms_acceptances where order_id = v_order.id;
    if found then return to_jsonb(v_existing) - 'user_id'; end if;
    if v_order.status <> 'quoted' then raise exception 'ORDER_NOT_QUOTED'; end if;
    if v_order.quote_expires_at <= clock_timestamp() then raise exception 'QUOTE_EXPIRED'; end if;
    select * into v_terms from private.commercial_quote_terms where order_id = v_order.id;
  else
    select * into v_quote from public.evocash_purchase_quotes where id = p_source_id and user_id = v_uid for update;
    if not found then raise exception 'QUOTE_NOT_FOUND'; end if;
    select * into v_existing from public.commercial_terms_acceptances where cash_quote_id = v_quote.id;
    if found then return to_jsonb(v_existing) - 'user_id'; end if;
    if v_quote.expires_at <= clock_timestamp() then raise exception 'QUOTE_EXPIRED'; end if;
    select * into v_terms from private.commercial_quote_terms where cash_quote_id = v_quote.id;
  end if;
  if v_terms.id is null or v_terms.document_version is null then
    raise exception 'COMMERCIAL_TERMS_UNAVAILABLE';
  end if;
  if p_document_version is distinct from v_terms.document_version
     or p_document_digest is distinct from v_terms.document_digest then
    raise exception 'COMMERCIAL_TERMS_MISMATCH';
  end if;
  if p_conditions_digest is distinct from v_terms.conditions_digest then
    raise exception 'COMMERCIAL_CONDITIONS_MISMATCH';
  end if;
  select * into v_policy from public.legal_document_policy where document_id = v_terms.document_id for share;
  if v_policy.version is distinct from v_terms.document_version or v_policy.digest is distinct from v_terms.document_digest then
    raise exception 'COMMERCIAL_TERMS_CHANGED';
  end if;
  insert into public.commercial_terms_acceptances (user_id, order_id, cash_quote_id, document_id, document_version,
    document_digest, conditions, conditions_digest)
  values (v_uid, v_terms.order_id, v_terms.cash_quote_id, v_terms.document_id, v_terms.document_version,
    v_terms.document_digest, v_terms.conditions, v_terms.conditions_digest)
  returning * into v_existing;
  return to_jsonb(v_existing) - 'user_id';
end $$;
revoke all on function public.accept_commercial_terms(text, uuid, text, text, text) from public, anon, service_role;
grant execute on function public.accept_commercial_terms(text, uuid, text, text, text) to authenticated;

-- Aceite + confirmação na mesma transação (o débito só acontece com aceite gravado).
create or replace function public.confirm_commercial_order_with_terms(
  p_order_id uuid, p_document_version text, p_document_digest text, p_conditions_digest text
) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform public.accept_commercial_terms('order', p_order_id, p_document_version, p_document_digest, p_conditions_digest);
  return public.confirm_commercial_order(p_order_id, true);
end $$;
revoke all on function public.confirm_commercial_order_with_terms(uuid, text, text, text) from public, anon, service_role;
grant execute on function public.confirm_commercial_order_with_terms(uuid, text, text, text) to authenticated;

-- Recibo: condições e versão que regeram a operação, sem depender da versão vigente.
create or replace function public.get_my_commercial_terms(p_source_type text, p_source_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_terms private.commercial_quote_terms;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_source_type = 'order' then
    select t.* into v_terms from private.commercial_quote_terms t
      join public.commercial_orders o on o.id = t.order_id
     where t.order_id = p_source_id and o.payer_user_id = v_uid;
  elsif p_source_type = 'evocash_quote' then
    select t.* into v_terms from private.commercial_quote_terms t
      join public.evocash_purchase_quotes q on q.id = t.cash_quote_id
     where t.cash_quote_id = p_source_id and q.user_id = v_uid;
  elsif p_source_type = 'purchase' then
    select t.* into v_terms from private.commercial_quote_terms t
      join public.cash_purchases c on c.quote_id = t.cash_quote_id
     where c.id = p_source_id and c.user_id = v_uid;
  else
    raise exception 'INVALID_REQUEST';
  end if;
  return private.commercial_terms_json(v_terms);
end $$;
revoke all on function public.get_my_commercial_terms(text, uuid) from public, anon, service_role;
grant execute on function public.get_my_commercial_terms(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- 4) Exigência no ponto de cobrança (inclusive por API direta)
-- ---------------------------------------------------------------------------------
create or replace function private.require_commercial_terms_acceptance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_acceptance public.commercial_terms_acceptances; v_policy public.legal_document_policy;
begin
  if tg_table_name = 'commercial_orders' then
    if not (old.status = 'quoted' and new.status = 'fulfilled') then return new; end if;
    select * into v_acceptance from public.commercial_terms_acceptances where order_id = new.id;
  else
    if new.quote_id is null then return new; end if;
    select * into v_acceptance from public.commercial_terms_acceptances where cash_quote_id = new.quote_id;
  end if;
  if v_acceptance.id is null then raise exception 'COMMERCIAL_TERMS_ACCEPTANCE_REQUIRED' using errcode = '42501'; end if;
  select * into v_policy from public.legal_document_policy where document_id = v_acceptance.document_id;
  if v_policy.version is distinct from v_acceptance.document_version
     or v_policy.digest is distinct from v_acceptance.document_digest then
    raise exception 'COMMERCIAL_TERMS_CHANGED';
  end if;
  return new;
end $$;
revoke all on function private.require_commercial_terms_acceptance() from public, anon, authenticated, service_role;
create trigger commercial_order_terms_required before update on public.commercial_orders
  for each row execute function private.require_commercial_terms_acceptance();
create trigger cash_purchase_terms_required before insert on public.cash_purchases
  for each row execute function private.require_commercial_terms_acceptance();

-- ---------------------------------------------------------------------------------
-- 5) Política de reembolsos: ativação somente de versão aprovada
-- ---------------------------------------------------------------------------------
-- refund_policies é imutável (20261207000001). Uma versão aprovada entra como linha nova
-- (approved=true) e é ativada por esta função; contratos antigos mantêm o snapshot que
-- já congelaram. draft-1 continua minuta e vigente apenas como texto não contratual.
create or replace function public.admin_activate_refund_policy(p_version text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v public.refund_policies; s private.refund_settings;
begin
  select * into v from public.refund_policies where version = p_version;
  if not found then raise exception 'REFUND_POLICY_NOT_FOUND'; end if;
  if not v.approved then raise exception 'REFUND_POLICY_NOT_APPROVED'; end if;
  select * into s from private.refund_settings where id for update;
  if s.policy_version = p_version then
    return jsonb_build_object('version', p_version, 'repeated', true);
  end if;
  update private.refund_settings set policy_version = p_version where id;
  return jsonb_build_object('version', p_version, 'repeated', false);
end $$;
revoke all on function public.admin_activate_refund_policy(text) from public, anon, authenticated;
grant execute on function public.admin_activate_refund_policy(text) to service_role;
