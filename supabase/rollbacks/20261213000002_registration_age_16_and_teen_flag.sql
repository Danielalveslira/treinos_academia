-- Rollback de 20261213000002: restaura o piso de 18 anos em set_birth_info e
-- accept_legal_documents, remove o sinalizador de moderação para adolescentes e
-- restaura admin_list_support_requests sem isProtectedTeen.
-- Não modifica ou exclui contas, datas de nascimento, aceites ou denúncias.
create or replace function public.set_birth_info(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_birth date;
  v_current date;
  v_username text;
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not private.current_session_active() then
    raise exception 'APP_ACCESS_DENIED' using errcode = '42501';
  end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then
    raise exception 'INVALID_REQUEST';
  end if;

  if payload ? 'dataNascimento' then
    if jsonb_typeof(payload->'dataNascimento') is distinct from 'string'
       or (payload->>'dataNascimento') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'BIRTHDATE_REQUIRED';
    end if;
    begin
      v_birth := (payload->>'dataNascimento')::date;
    exception when invalid_datetime_format or datetime_field_overflow then
      raise exception 'INVALID_BIRTHDATE';
    end;
    if v_birth > (v_today - interval '18 years')::date then
      raise exception 'MINIMUM_AGE' using errcode = '22023';
    end if;
    if v_birth < (v_today - interval '120 years')::date then
      raise exception 'INVALID_BIRTHDATE';
    end if;
    select data_nascimento, username into v_current, v_username
      from public.users where id = v_uid for update;
    if v_current is not null and v_username is not null and v_current <> v_birth then
      raise exception 'BIRTHDATE_LOCKED' using errcode = '42501';
    end if;
  end if;

  if payload ? 'sexo' then
    if coalesce(payload->>'sexo', '') not in ('masculino', 'feminino', 'nao_informar') then
      raise exception 'INVALID_SEXO';
    end if;
    update public.users set sexo = payload->>'sexo' where id = v_uid;
  end if;
  if payload ? 'dataNascimento' then
    update public.users set data_nascimento = v_birth where id = v_uid;
  end if;
end $$;
revoke all on function public.set_birth_info(jsonb) from public, anon;
grant execute on function public.set_birth_info(jsonb) to authenticated;

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

  select data_nascimento, account_status into v_birth, v_status
    from public.users where id = v_uid for no key update;
  if v_status is null then raise exception 'PERMISSION_DENIED'; end if;
  if v_status = 'deleting' then raise exception 'ACCOUNT_DELETING'; end if;

  select * into v_policy from public.legal_policy where id for share;
  if v_policy is null or not v_policy.published or v_policy.version is distinct from v_version
     or v_policy.digest is distinct from v_digest then
    raise exception 'POLICY_MISMATCH';
  end if;
  select * into v_archive from public.legal_versions where version = v_version;
  if v_archive is null or v_archive.digest is distinct from v_digest
     or v_archive.manifest->>'published' is distinct from 'true' then
    raise exception 'POLICY_MISMATCH_UNREGISTERED';
  end if;

  if v_birth is null then raise exception 'BIRTHDATE_REQUIRED'; end if;
  v_min := greatest(18, coalesce(v_policy.minimum_age::int,
    case when v_archive.manifest->>'minimumAge' ~ '^[0-9]{1,2}$' then (v_archive.manifest->>'minimumAge')::int end, 18));
  v_age := extract(year from age((now() at time zone 'America/Sao_Paulo')::date, v_birth));
  if v_age < v_min then raise exception 'MINIMUM_AGE'; end if;

  insert into public.legal_acceptances (user_id, version, digest, accepted, health_data_consent, source, privacy_notice_presented)
  values (v_uid, v_version, v_digest, true, v_health is not null, v_source, true)
  on conflict (user_id, version) do nothing;

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

create or replace function public.admin_list_support_requests(
  p_state text default '',
  p_listing_id uuid default null,
  p_cursor timestamptz default null,
  p_page_size int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  v_rows jsonb;
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_state <> '' and p_state not in ('open', 'closed') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select coalesce(jsonb_agg(sub.obj order by sub.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', sr.id,
      'userId', sr.user_id,
      'kind', sr.kind,
      'message', sr.message,
      'statusId', sr.status_id,
      'commentId', sr.comment_id,
      'communityId', sr.community_id,
      'decisionId', sr.decision_id,
      'category', sr.category,
      'listingId', sr.listing_id,
      'listingOwnerId', sr.listing_owner_id,
      'listingKind', sr.listing_kind,
      'listingDisplayName', d.display_name,
      'listingLifecycleState', pl.lifecycle_state,
      'contentSnapshot', sr.content_snapshot,
      'state', sr.state,
      'createdAt', sr.created_at,
      'response', sr.response,
      'decidedAt', sr.decided_at,
      'evidencePath', sr.evidence_path
    ) as obj,
    sr.created_at
    from public.support_requests sr
    left join public.professional_listings pl on pl.id = sr.listing_id
    left join public.professional_listing_drafts d on d.listing_id = sr.listing_id
    where (p_state = '' or sr.state = p_state)
      and (p_listing_id is null or sr.listing_id = p_listing_id)
      and (p_cursor is null or sr.created_at < p_cursor)
    order by sr.created_at desc
    limit v_page_size
  ) sub;

  return jsonb_build_object(
    'items', v_rows,
    'nextCursor', case
      when jsonb_array_length(v_rows) = v_page_size
        then v_rows->(jsonb_array_length(v_rows) - 1)->>'createdAt'
      else null
    end
  );
end;
$$;

drop function if exists private.is_protected_teen(date);

notify pgrst, 'reload schema';
