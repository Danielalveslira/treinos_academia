-- Completa a revogação de medidas: altura fica em users.height_cm, fora da tabela
-- body_measurements. Não altera aceites, comprovantes ou histórico jurídico.
-- Aplicar apenas após revisão e antes de ativar a política 2.0.0.
begin;
set local lock_timeout = '5s';

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
      update public.users set height_cm = null where id = p_user_id;
    end if;
    return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
      'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', false);
  end if;
  if not found and not p_granted then
    -- Sem evento no novo histórico: apagar qualquer medida legada, sem presumir consentimento.
    delete from public.body_measurements where user_id = p_user_id;
    update public.users set height_cm = null where id = p_user_id;
    return jsonb_build_object('purpose', p_purpose, 'granted', false, 'textVersion', null,
      'occurredAt', null, 'changed', false);
  end if;
  insert into public.privacy_consent_events (user_id, purpose, granted, text_version, source)
  values (p_user_id, p_purpose, p_granted, case when p_granted then p_text_version end, p_source)
  returning * into v_last;
  if p_purpose = 'health_data' and not p_granted then
    delete from public.body_measurements where user_id = p_user_id;
    update public.users set height_cm = null where id = p_user_id;
  end if;
  return jsonb_build_object('purpose', p_purpose, 'granted', v_last.granted,
    'textVersion', v_last.text_version, 'occurredAt', v_last.occurred_at, 'changed', true);
end $$;
revoke all on function private.record_privacy_consent(uuid, text, boolean, text, text) from public, anon, authenticated, service_role;

-- Toda escrita de altura pelo titular usa o mesmo lock da revogação. Limpar a
-- altura (valor NULL) continua permitido, inclusive durante a revogação.
create or replace function private.require_height_consent() returns trigger
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_granted boolean;
begin
  if new.height_cm is not null and new.height_cm is distinct from old.height_cm and v_uid is not null then
    if new.id is distinct from v_uid then raise exception 'NOT_OWNER' using errcode = '42501'; end if;
    perform pg_catalog.pg_advisory_xact_lock(84202, pg_catalog.hashtext(new.id::text || ':health_data'));
    select granted into v_granted from public.privacy_consent_events
      where user_id = new.id and purpose = 'health_data' order by id desc limit 1;
    if not coalesce(v_granted, false) then
      raise exception 'HEALTH_CONSENT_REQUIRED' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.require_height_consent() from public, anon, authenticated, service_role;
drop trigger if exists users_height_require_health_consent on public.users;
create trigger users_height_require_health_consent before update of height_cm on public.users
  for each row execute function private.require_height_consent();

-- Somente alturas de contas com revogação vigente; não presume revogação de
-- contas legadas sem evento. A consulta deve ser revista antes de aplicar em produção.
update public.users u set height_cm = null
where u.height_cm is not null and (
  select e.granted from public.privacy_consent_events e
  where e.user_id = u.id and e.purpose = 'health_data' order by e.id desc limit 1
) is false;
commit;
