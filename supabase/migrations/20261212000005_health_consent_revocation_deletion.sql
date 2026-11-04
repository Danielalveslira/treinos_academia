-- Decisão do titular do produto (04/11/2026): revogar o consentimento de saúde não pode
-- só bloquear novas escritas (regra desde 20261212000001) -- precisa eliminar de fato as
-- medidas corporais já registradas, salvo conservação legalmente justificada. Verificado:
-- body_measurements não é referenciado por nenhuma tabela financeira/jurídica/de caso
-- (sem FK apontando para ela em todo o schema), então não existe hoje nenhuma hipótese
-- concreta de conservação legal para uma medida específica -- a exclusão é incondicional.
-- O que precisa sobreviver como "histórico mínimo de comprovação" já sobrevive sem ação
-- nenhuma: privacy_consent_events é imutável (privacy_event_guard bloqueia UPDATE) e só é
-- removido pelo cascade de users na exclusão da própria conta -- nunca por uma revogação.
--
-- Mudança: toda solicitação explícita de revogação para 'health_data' apaga as medidas
-- do titular, inclusive se o evento já era de revogação ou não existia no novo histórico.
-- Esses casos continuam idempotentes: não criam um novo evento.
--
-- Exclusão de conta não precisa de nenhuma mudança: run_deletion_job já apaga
-- public.users, e body_measurements.user_id é "references ... on delete cascade"
-- (20260929000002) -- confirmado lendo 20260930000002_deletion_worker.sql.
-- Bloqueia gravações durante a substituição das funções e o saneamento dirigido;
-- quando o lock for liberado no commit, o novo trigger já estará visível.
set local lock_timeout = '5s';
lock table public.body_measurements in share row exclusive mode;

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
    if not p_granted then
      delete from public.body_measurements where user_id = p_user_id;
    end if;
    return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
      'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', false);
  end if;
  if not found and not p_granted then
    -- Sem evento no novo histórico: apagar qualquer medida legada, sem presumir consentimento.
    delete from public.body_measurements where user_id = p_user_id;
    return jsonb_build_object('purpose', p_purpose, 'granted', false, 'textVersion', null,
      'occurredAt', null, 'changed', false);
  end if;
  insert into public.privacy_consent_events (user_id, purpose, granted, text_version, source)
  values (p_user_id, p_purpose, p_granted, case when p_granted then p_text_version end, p_source)
  returning * into v_last;
  if p_purpose = 'health_data' and not p_granted then
    delete from public.body_measurements where user_id = p_user_id;
  end if;
  return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
    'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', true);
end $$;
revoke all on function private.record_privacy_consent(uuid, text, boolean, text, text) from public, anon, authenticated, service_role;

-- Se uma revogação já foi registrada antes desta migration, limpe as medidas que a
-- implementação antiga deixou para trás. Ausência de evento não é tratada como
-- revogação retroativa: dados legados sem evento exigem decisão própria de migração.
delete from public.body_measurements m
where (select e.granted from public.privacy_consent_events e
       where e.user_id = m.user_id and e.purpose = 'health_data'
       order by e.id desc limit 1) is false;

-- A inserção precisa disputar o mesmo lock da revogação. Sem isso, uma transação
-- iniciada antes da revogação poderia ler o consentimento antigo e inserir uma
-- medida depois do DELETE, deixando dados de saúde apesar da revogação confirmada.
create or replace function private.require_health_consent() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_granted boolean;
begin
  if v_uid is not null then
    perform pg_catalog.pg_advisory_xact_lock(84202, pg_catalog.hashtext(new.user_id::text || ':health_data'));
    -- Consulta nova após adquirir o lock; a função STABLE has_privacy_consent
    -- poderia reutilizar o snapshot do INSERT iniciado antes da revogação.
    select granted into v_granted from public.privacy_consent_events
      where user_id = new.user_id and purpose = 'health_data'
      order by id desc limit 1;
    if not coalesce(v_granted, false) then
      raise exception 'HEALTH_CONSENT_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.require_health_consent() from public, anon, authenticated, service_role;
