-- Rollback de 20261212000005: restaura record_privacy_consent sem apagar medidas na
-- revogação (comportamento de 20261212000001). Não restaura medidas já apagadas por uma
-- revogação ocorrida enquanto esta migration esteve ativa -- isso é exclusão de dados,
-- irreversível por natureza; não há cópia a recuperar.
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
