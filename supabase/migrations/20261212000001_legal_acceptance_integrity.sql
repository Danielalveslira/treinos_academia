-- Integridade do aceite jurídico geral, consentimentos específicos de privacidade e
-- trava de compras para menores de 18 anos.
--
-- Aditiva: nenhum aceite, versão, medida corporal ou dado financeiro é apagado ou
-- reescrito. Nenhum documento é publicado nem ativado por esta migration.
--
-- 1. accept_legal_documents deixa de gravar em legal_versions o conteúdo enviado pelo
--    cliente (payload.manifest/payload.documents eram confiados). A versão aceita precisa
--    existir previamente, registrada pelo fluxo administrativo (scripts/seed-legal.mjs com
--    service role) e com o mesmo digest de legal_policy.
-- 2. legal_versions vira histórico imutável: conteúdo/digest de uma versão registrada não
--    muda; a mesma versão com o mesmo conteúdo continua idempotente (upsert idêntico).
--    Versões nunca publicadas deixam de ser legíveis pelo público.
-- 3. Publicação da política geral passa por private.publish_legal_policy (service role):
--    exige versão registrada, digest igual, manifesto marcado como publicado e idade
--    mínima derivada do próprio manifesto -- uma minuta não pode ser ativada por engano.
-- 4. O consentimento de dados de saúde deixa de ser condição para criar/regularizar a
--    conta. Passa a ser um consentimento específico, opcional, com histórico de concessão
--    e revogação (privacy_consent_events), exigido só para registrar novas medidas
--    corporais. Contas antigas não ganham consentimento presumido.
-- 5. Menores de 18 anos (idade calculada no servidor) não iniciam compras de EvoCash nem
--    contratações comerciais. Não existe vínculo com responsável legal nem ferramenta de
--    supervisão de compras (Lei 15.211/2025, art. 18, II); o fluxo de risco fica isolado
--    até decisão humana. Atendimento, reembolso e consulta de histórico não são afetados.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- ---------------------------------------------------------------------------------
-- 1) Histórico imutável de legal_versions
-- ---------------------------------------------------------------------------------
alter table public.legal_versions add column if not exists published_at timestamptz;

-- Linhas existentes chegaram por seed (que publicava) ou pelo aceite antigo (que só
-- gravava a versão igual à política publicada). Só manifestos marcados como publicados
-- recebem marca de publicação; minutas eventualmente registradas continuam privadas.
update public.legal_versions
   set published_at = created_at
 where published_at is null and manifest->>'published' = 'true';

create or replace function private.legal_version_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'LEGAL_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.digest !~ '^[0-9a-f]{64}$' or new.version !~ '^[0-9]+\.[0-9]+\.[0-9]+$'
       or jsonb_typeof(new.manifest) <> 'object' or jsonb_typeof(new.documents) <> 'array'
       or new.manifest->>'version' is distinct from new.version then
      raise exception 'LEGAL_VERSION_INVALID' using errcode = '22023';
    end if;
    if new.manifest->>'published' is distinct from 'true' then
      new.published_at := null;
    end if;
    return new;
  end if;
  -- UPDATE: conteúdo é imutável; publicação só pode ser marcada uma vez.
  if (new.version, new.manifest, new.documents, new.digest, new.created_at)
     is distinct from (old.version, old.manifest, old.documents, old.digest, old.created_at) then
    raise exception 'LEGAL_VERSION_IMMUTABLE' using errcode = '42501';
  end if;
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'LEGAL_VERSION_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.legal_version_guard() from public, anon, authenticated, service_role;

drop trigger if exists legal_versions_guard on public.legal_versions;
create trigger legal_versions_guard before insert or update or delete on public.legal_versions
  for each row execute function private.legal_version_guard();

drop policy if exists legal_versions_select on public.legal_versions;
create policy legal_versions_select on public.legal_versions for select
  using (published_at is not null);

revoke insert, update, delete, truncate on public.legal_versions from anon, authenticated;
revoke insert, update, delete, truncate on public.legal_policy from anon, authenticated;
revoke insert, update, delete, truncate on public.legal_acceptances from anon, authenticated;

-- ---------------------------------------------------------------------------------
-- 2) Publicação controlada da política geral (service role)
-- ---------------------------------------------------------------------------------
create or replace function private.publish_legal_policy(p_version text, p_digest text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_archive public.legal_versions;
  v_policy public.legal_policy;
  v_min smallint;
begin
  perform pg_catalog.pg_advisory_xact_lock(84201, 1);
  select * into v_archive from public.legal_versions where version = p_version;
  if not found or v_archive.digest is distinct from p_digest then
    raise exception 'LEGAL_VERSION_NOT_REGISTERED';
  end if;
  if v_archive.manifest->>'published' is distinct from 'true' then
    raise exception 'LEGAL_DRAFT_NOT_PUBLISHABLE';
  end if;
  if coalesce(v_archive.manifest->>'minimumAge', '') !~ '^[0-9]{1,2}$' then
    raise exception 'LEGAL_MINIMUM_AGE_INVALID';
  end if;
  v_min := (v_archive.manifest->>'minimumAge')::smallint;

  select * into v_policy from public.legal_policy where id for update;
  if found and v_policy.published and v_policy.version = p_version and v_policy.digest = p_digest then
    return jsonb_build_object('version', p_version, 'digest', p_digest, 'repeated', true);
  end if;

  insert into public.legal_policy (id, version, published, digest, minimum_age, published_at)
  values (true, p_version, true, p_digest, v_min, clock_timestamp())
  on conflict (id) do update set version = excluded.version, published = true,
    digest = excluded.digest, minimum_age = excluded.minimum_age, published_at = excluded.published_at;

  update public.legal_versions set published_at = clock_timestamp()
   where version = p_version and published_at is null;

  return jsonb_build_object('version', p_version, 'digest', p_digest, 'repeated', false);
end $$;
revoke all on function private.publish_legal_policy(text, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.publish_legal_policy(text, text) to service_role;

-- Wrapper exposto apenas ao service role (PostgREST só enxerga o schema public).
create or replace function public.admin_publish_legal_policy(p_version text, p_digest text)
returns jsonb language sql security definer set search_path = '' as $$
  select private.publish_legal_policy(p_version, p_digest)
$$;
revoke all on function public.admin_publish_legal_policy(text, text) from public, anon, authenticated;
grant execute on function public.admin_publish_legal_policy(text, text) to service_role;

-- ---------------------------------------------------------------------------------
-- 3) Consentimentos específicos de privacidade
-- ---------------------------------------------------------------------------------
create table public.privacy_consent_texts (
  purpose text not null check (purpose in ('health_data')),
  version text not null check (version ~ '^[a-z0-9-]{3,40}$'),
  body text not null check (char_length(body) between 40 and 2000),
  created_at timestamptz not null default clock_timestamp(),
  retired_at timestamptz,
  primary key (purpose, version)
);
create unique index privacy_consent_texts_one_active
  on public.privacy_consent_texts(purpose) where retired_at is null;
alter table public.privacy_consent_texts enable row level security;
create policy privacy_consent_texts_select on public.privacy_consent_texts for select using (true);
revoke insert, update, delete, truncate on public.privacy_consent_texts from anon, authenticated;
grant select on public.privacy_consent_texts to anon, authenticated;

-- O texto do pedido de consentimento é o mesmo exibido no app (src/utils/privacyConsent.js);
-- teste automatizado garante a igualdade. Texto novo = nova versão, nunca edição.
insert into public.privacy_consent_texts (purpose, version, body) values (
  'health_data', 'health-data-1',
  'Autorizo o Evolutus a armazenar e usar as medidas corporais que eu registrar (como peso, percentual de gordura, circunferências, massa magra e massa gorda) para manter meu histórico privado e calcular meus indicadores. Posso revogar esta autorização a qualquer momento no Perfil. Ela não autoriza divulgação na comunidade nem uso em publicidade.'
);

create or replace function private.privacy_text_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'PRIVACY_HISTORY_IMMUTABLE' using errcode = '42501'; end if;
  if (new.purpose, new.version, new.body, new.created_at) is distinct from (old.purpose, old.version, old.body, old.created_at)
     or (old.retired_at is not null and new.retired_at is distinct from old.retired_at) then
    raise exception 'PRIVACY_HISTORY_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.privacy_text_guard() from public, anon, authenticated, service_role;
create trigger privacy_consent_texts_guard before update or delete on public.privacy_consent_texts
  for each row execute function private.privacy_text_guard();

create table public.privacy_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  purpose text not null check (purpose in ('health_data')),
  granted boolean not null,
  text_version text,
  source text not null check (source in ('signup', 'reacceptance', 'settings', 'feature_prompt')),
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (purpose, text_version) references public.privacy_consent_texts(purpose, version),
  check (not granted or text_version is not null)
);
create index privacy_consent_events_user_purpose_idx
  on public.privacy_consent_events(user_id, purpose, id desc);
alter table public.privacy_consent_events enable row level security;
create policy privacy_consent_events_select on public.privacy_consent_events for select
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.privacy_consent_events from anon, authenticated;
grant select on public.privacy_consent_events to authenticated;

-- Eventos não mudam. A exclusão da conta remove as linhas pela FK (mesma regra das
-- demais tabelas pessoais); por isso o guard bloqueia só UPDATE.
create or replace function private.privacy_event_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'PRIVACY_HISTORY_IMMUTABLE' using errcode = '42501';
end $$;
revoke all on function private.privacy_event_guard() from public, anon, authenticated, service_role;
create trigger privacy_consent_events_guard before update on public.privacy_consent_events
  for each row execute function private.privacy_event_guard();

create or replace function private.has_privacy_consent(p_user_id uuid, p_purpose text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((
    select e.granted from public.privacy_consent_events e
     where e.user_id = p_user_id and e.purpose = p_purpose
     order by e.id desc limit 1
  ), false)
$$;
revoke all on function private.has_privacy_consent(uuid, text) from public, anon, authenticated, service_role;

-- Grava a transição (concessão ou revogação) só quando o estado muda: idempotente.
create or replace function private.record_privacy_consent(
  p_user_id uuid, p_purpose text, p_granted boolean, p_text_version text, p_source text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_last public.privacy_consent_events;
  v_active text;
begin
  if p_purpose is distinct from 'health_data' then raise exception 'INVALID_CONSENT_PURPOSE'; end if;
  if p_granted is null then raise exception 'INVALID_CONSENT_CHOICE'; end if;
  perform pg_catalog.pg_advisory_xact_lock(84202, pg_catalog.hashtext(p_user_id::text || ':' || p_purpose));
  select version into v_active from public.privacy_consent_texts where purpose = p_purpose and retired_at is null;
  if p_granted and (p_text_version is null or p_text_version is distinct from v_active) then
    raise exception 'CONSENT_TEXT_OUTDATED';
  end if;
  select * into v_last from public.privacy_consent_events
   where user_id = p_user_id and purpose = p_purpose order by id desc limit 1;
  if found and v_last.granted = p_granted
     and (not p_granted or v_last.text_version is not distinct from p_text_version) then
    return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
      'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', false);
  end if;
  if not found and not p_granted then
    -- Nunca concedido: recusa não precisa de evento (e nada é presumido).
    return jsonb_build_object('purpose', p_purpose, 'granted', false, 'textVersion', null,
      'occurredAt', null, 'changed', false);
  end if;
  insert into public.privacy_consent_events (user_id, purpose, granted, text_version, source)
  values (p_user_id, p_purpose, p_granted, case when p_granted then p_text_version end, p_source)
  returning * into v_last;
  return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
    'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', true);
end $$;
revoke all on function private.record_privacy_consent(uuid, text, boolean, text, text) from public, anon, authenticated, service_role;

-- Revogar é sempre possível para o titular com sessão (inclusive com termos desatualizados
-- ou conta restrita). Conceder exige conta em situação regular.
create or replace function public.set_privacy_consent(
  p_purpose text, p_granted boolean, p_text_version text default null, p_source text default 'settings'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_status text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_source is null or p_source not in ('settings', 'feature_prompt') then raise exception 'INVALID_CONSENT_SOURCE'; end if;
  select account_status into v_status from public.users where id = v_uid;
  if v_status is null or v_status = 'deleting' then raise exception 'ACCOUNT_UNAVAILABLE'; end if;
  if p_granted and not private.has_account_standing() then raise exception 'PERMISSION_DENIED'; end if;
  return private.record_privacy_consent(v_uid, p_purpose, p_granted, p_text_version, p_source);
end $$;
revoke all on function public.set_privacy_consent(text, boolean, text, text) from public, anon;
grant execute on function public.set_privacy_consent(text, boolean, text, text) to authenticated;

create or replace function public.get_my_privacy_consents() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_last public.privacy_consent_events; v_text public.privacy_consent_texts;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select * into v_last from public.privacy_consent_events
   where user_id = v_uid and purpose = 'health_data' order by id desc limit 1;
  select * into v_text from public.privacy_consent_texts where purpose = 'health_data' and retired_at is null;
  return jsonb_build_object('healthData', jsonb_build_object(
    'granted', coalesce(v_last.granted, false),
    'textVersion', v_last.text_version,
    'occurredAt', v_last.occurred_at,
    'activeTextVersion', v_text.version,
    'activeText', v_text.body));
end $$;
revoke all on function public.get_my_privacy_consents() from public, anon;
grant execute on function public.get_my_privacy_consents() to authenticated;

-- Novas medidas corporais (dado de saúde) exigem o consentimento específico vigente.
-- Só se aplica a escritas feitas em nome de um usuário autenticado (save_body_check_in);
-- manutenção administrativa/migrations não passam por aqui. Medidas já existentes não são
-- apagadas nem ocultadas do titular após revogação (direito de acesso e de exclusão);
-- a eliminação automática após revogação depende de decisão jurídica (ver relatório).
create or replace function private.require_health_consent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is not null and not private.has_privacy_consent(new.user_id, 'health_data') then
    raise exception 'HEALTH_CONSENT_REQUIRED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.require_health_consent() from public, anon, authenticated, service_role;
create trigger body_measurements_require_health_consent before insert on public.body_measurements
  for each row execute function private.require_health_consent();

-- ---------------------------------------------------------------------------------
-- 4) Aceite dos documentos gerais
-- ---------------------------------------------------------------------------------
alter table public.legal_acceptances alter column health_data_consent set default false;
alter table public.legal_acceptances add column if not exists source text
  check (source is null or source in ('signup', 'reacceptance'));
alter table public.legal_acceptances add column if not exists privacy_notice_presented boolean;

comment on column public.legal_acceptances.health_data_consent is
  'Histórico: até 20261212000001 o cadastro exigia esta autorização como condição da conta. '
  'Não é usado como consentimento vigente; o estado atual está em privacy_consent_events.';

create or replace function public.accept_legal_documents(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_policy public.legal_policy;
  v_archive public.legal_versions;
  v_birth date;
  v_status text;
  v_age int;
  v_min int;
  v_version text;
  v_digest text;
  v_health text;
  v_source text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'CONFIRMATION_REQUIRED'; end if;
  v_version := payload->>'version';
  v_digest := payload->>'digest';
  v_health := nullif(payload->>'healthConsentTextVersion', '');
  v_source := coalesce(nullif(payload->>'source', ''), 'reacceptance');
  if payload->'accepted' is distinct from 'true'::jsonb then
    raise exception 'CONFIRMATION_REQUIRED';
  end if;
  if v_source not in ('signup', 'reacceptance') then raise exception 'INVALID_SOURCE'; end if;

  -- Serializa aceites do mesmo usuário (duplo clique, abas paralelas).
  select data_nascimento, account_status into v_birth, v_status
    from public.users where id = v_uid for no key update;
  if v_status is null then raise exception 'PERMISSION_DENIED'; end if;
  if v_status = 'deleting' then raise exception 'ACCOUNT_DELETING'; end if;

  select * into v_policy from public.legal_policy where id for share;
  if v_policy is null or not v_policy.published or v_policy.version is distinct from v_version
     or v_policy.digest is distinct from v_digest then
    raise exception 'POLICY_MISMATCH';
  end if;
  -- Conteúdo autoritativo: só o arquivo previamente registrado. Nada vindo do cliente
  -- (manifest/documents do payload são ignorados) cria ou altera histórico jurídico.
  select * into v_archive from public.legal_versions where version = v_version;
  if v_archive is null or v_archive.digest is distinct from v_digest
     or v_archive.manifest->>'published' is distinct from 'true' then
    raise exception 'POLICY_MISMATCH_UNREGISTERED';
  end if;

  if v_birth is null then raise exception 'BIRTHDATE_REQUIRED'; end if;
  -- A regra de cadastro 18+ é independente da versão histórica ainda publicada.
  v_min := greatest(18, coalesce(v_policy.minimum_age::int,
    case when v_archive.manifest->>'minimumAge' ~ '^[0-9]{1,2}$' then (v_archive.manifest->>'minimumAge')::int end, 18));
  v_age := extract(year from age((now() at time zone 'America/Sao_Paulo')::date, v_birth));
  if v_age < v_min then raise exception 'MINIMUM_AGE'; end if;

  insert into public.legal_acceptances (user_id, version, digest, accepted, health_data_consent, source, privacy_notice_presented)
  values (v_uid, v_version, v_digest, true, v_health is not null, v_source, true)
  on conflict (user_id, version) do nothing;

  -- Consentimento opcional e específico; só é registrado quando o app atual o envia com a
  -- versão exata do texto exibido. Clientes antigos (healthDataConsent forçado) não geram
  -- consentimento presumido.
  if v_health is not null then
    perform private.record_privacy_consent(v_uid, 'health_data', true, v_health, v_source);
  end if;

  update public.users set
    legal_acceptance_version = v_version,
    legal_acceptance_digest = v_digest,
    legal_acceptance_accepted_at = now()
  where id = v_uid
    and (legal_acceptance_version is distinct from v_version
         or legal_acceptance_digest is distinct from v_digest
         or legal_acceptance_accepted_at is null);
end $$;
revoke all on function public.accept_legal_documents(jsonb) from public, anon;
grant execute on function public.accept_legal_documents(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------
-- 5) Compras e contratações: bloqueio para menores de 18 anos
-- ---------------------------------------------------------------------------------
-- Idade calculada no servidor (fuso de Brasília) a partir de users.data_nascimento, que o
-- próprio aceite jurídico exige. Sem data de nascimento não há aceite vigente e portanto
-- não há acesso comercial (has_app_access); a regra só decide sobre idades conhecidas.
create or replace function private.is_known_minor(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select u.data_nascimento > ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date
      from public.users u where u.id = p_user_id
  ), false)
$$;
revoke all on function private.is_known_minor(uuid) from public, anon, authenticated, service_role;

create or replace function private.block_minor_purchase() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_payer uuid;
begin
  -- IFs separados: cada expressão só é planejada para a tabela que possui a coluna.
  if tg_table_name = 'commercial_orders' then
    v_payer := new.payer_user_id;
  elsif tg_table_name = 'promotions' then
    v_payer := new.owner_id;
  else
    v_payer := new.user_id;
  end if;
  if private.is_known_minor(v_payer) then
    raise exception 'MINOR_PURCHASE_BLOCKED' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.block_minor_purchase() from public, anon, authenticated, service_role;

create trigger evocash_quotes_block_minor before insert on public.evocash_purchase_quotes
  for each row execute function private.block_minor_purchase();
create trigger cash_purchases_block_minor before insert on public.cash_purchases
  for each row execute function private.block_minor_purchase();
create trigger commercial_orders_block_minor before insert on public.commercial_orders
  for each row execute function private.block_minor_purchase();
create trigger promotions_block_minor before insert on public.promotions
  for each row execute function private.block_minor_purchase();
