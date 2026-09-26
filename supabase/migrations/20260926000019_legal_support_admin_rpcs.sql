-- legal_policy needs the manifest's minimum age available server-side (the Firestore
-- version only ever had it in the Cloud Function's bundled manifest.json, never in the
-- document itself) so accept_legal_documents can check it without trusting the client.
alter table public.legal_policy add column minimum_age smallint;

-- Equivalent to acceptLegalDocuments. legal_acceptances.ip is nullable (see
-- 20260926000007_legal.sql) because the real end-user IP isn't reliably available
-- inside a plain Postgres RPC called through PostgREST (inet_client_addr() here would be
-- the pooler's connection, not the browser's) — that would require an Edge Function
-- reading x-forwarded-for, not yet built. The client computes `digest` itself (same
-- manifest/documents JSON bundled into the frontend, same sha256-of-JSON algorithm as
-- functions/legal-core.js's legalDigest) — this only ever checks it against the digest
-- already on record in legal_policy (written once by the seed script), so a client can
-- accept the actual published content, never an arbitrary one it makes up.
create or replace function public.accept_legal_documents(payload jsonb) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_policy record;
  v_birth date;
  v_age int;
  v_version text := payload->>'version';
  v_digest text := payload->>'digest';
begin
  if coalesce((payload->>'accepted')::boolean, false) is not true
     or coalesce((payload->>'healthDataConsent')::boolean, false) is not true then
    raise exception 'CONFIRMATION_REQUIRED';
  end if;

  select * into v_policy from public.legal_policy where id;
  if v_policy is null or not v_policy.published or v_policy.version is distinct from v_version
     or v_policy.digest is distinct from v_digest then
    raise exception 'POLICY_MISMATCH';
  end if;

  select data_nascimento into v_birth from public.users where id = auth.uid();
  if v_birth is null then
    raise exception 'BIRTHDATE_REQUIRED';
  end if;
  v_age := extract(year from age(now(), v_birth));
  if v_age < coalesce(v_policy.minimum_age, 18) then
    raise exception 'MINIMUM_AGE';
  end if;

  insert into public.legal_acceptances (user_id, version, digest, accepted, health_data_consent)
  values (auth.uid(), v_version, v_digest, true, true)
  on conflict (user_id, version) do nothing;

  insert into public.legal_versions (version, manifest, documents, digest)
  values (v_version, payload->'manifest', payload->'documents', v_digest)
  on conflict (version) do nothing;

  update public.users set
    legal_acceptance_version = v_version,
    legal_acceptance_digest = v_digest,
    legal_acceptance_accepted_at = now()
  where id = auth.uid();
end;
$$;

-- Equivalent to submitSupportRequest. security definer: supportLimits/supportRequests
-- have no client-facing write policy, only this RPC (and decide/cancel below) may touch
-- them.
create or replace function public.submit_support_request(payload jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_kind text := payload->>'kind';
  v_message text := trim(coalesce(payload->>'message', ''));
  v_status_id uuid := nullif(payload->>'statusId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_decision_id uuid := nullif(payload->>'decisionId', '')::uuid;
  v_last_request timestamptz;
  v_status record;
  v_author_role text;
  v_snapshot jsonb;
  v_request_id uuid;
begin
  if v_kind not in ('report', 'appeal', 'privacy') then
    raise exception 'INVALID_KIND';
  end if;
  if char_length(v_message) < 10 or char_length(payload->>'message') > 3000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if (select account_status from public.users where id = auth.uid()) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select last_request_at into v_last_request from public.support_limits where user_id = auth.uid();
  if v_last_request is not null and now() - v_last_request < interval '60 seconds' then
    raise exception 'RATE_LIMITED';
  end if;

  if v_status_id is not null and v_kind = 'report' then
    select * into v_status from public.statuses where id = v_status_id;
    if v_status is null then
      raise exception 'STATUS_NOT_FOUND';
    end if;
    v_community_id := v_status.community_id;
    if not exists (
      select 1 from public.community_members
      where community_id = v_community_id and user_id = auth.uid()
    ) then
      raise exception 'PERMISSION_DENIED';
    end if;
    if v_status.author_id = auth.uid() then
      raise exception 'CANNOT_REPORT_SELF';
    end if;
    select role into v_author_role from public.users where id = v_status.author_id;
    if v_author_role in ('admin', 'superadmin') then
      raise exception 'PROTECTED_AUTHOR';
    end if;
    v_snapshot := to_jsonb(v_status);
  end if;

  if v_kind = 'appeal' then
    if v_decision_id is null or not exists (
      select 1 from public.moderation_decisions where id = v_decision_id and target_user_id = auth.uid()
    ) then
      raise exception 'DECISION_NOT_FOUND';
    end if;
  end if;

  insert into public.support_requests (user_id, kind, message, status_id, community_id, decision_id, content_snapshot, state)
  values (
    auth.uid(), v_kind, v_message,
    case when v_kind = 'report' then v_status_id else null end,
    v_community_id,
    case when v_kind = 'appeal' then v_decision_id else null end,
    v_snapshot, 'open'
  )
  returning id into v_request_id;

  insert into public.support_limits (user_id, last_request_at) values (auth.uid(), now())
    on conflict (user_id) do update set last_request_at = now();

  return v_request_id;
end;
$$;

-- Equivalent to cancelSupportRequest: only the author, only while still open.
create or replace function public.cancel_support_request(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update public.support_requests
    set state = 'closed', response = 'Cancelado pelo usuário.', decided_at = now()
    where id = p_request_id and user_id = auth.uid() and state = 'open';
  if not found then
    raise exception 'NOT_FOUND';
  end if;
end;
$$;

-- Equivalent to decideSupportRequest: superadmin only, applies the moderation action
-- (notice, restriction, content removal) atomically with closing the request.
create or replace function public.decide_support_request(payload jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_request_id uuid := (payload->>'requestId')::uuid;
  v_action text := payload->>'action';
  v_reason text := trim(coalesce(payload->>'reason', ''));
  v_rule text := trim(coalesce(payload->>'rule', ''));
  v_evidence text := trim(coalesce(payload->>'evidence', ''));
  v_target_user_id uuid := nullif(payload->>'targetUserId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_days int := (payload->>'days')::int;
  v_request record;
  v_target_role text;
  v_until timestamptz;
  v_decision_id uuid;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_action not in ('no_action','warning','remove_content','temporary_suspension','community_ban','system_ban','restore') then
    raise exception 'INVALID_ACTION';
  end if;
  if char_length(v_reason) < 5 or char_length(v_rule) < 5 or char_length(v_evidence) < 5 then
    raise exception 'INVALID_FIELDS';
  end if;

  select * into v_request from public.support_requests where id = v_request_id;
  if v_request is null or v_request.state <> 'open' then
    raise exception 'NOT_FOUND_OR_CLOSED';
  end if;
  if not (v_request.kind in ('report', 'appeal')) and v_action <> 'no_action' then
    raise exception 'PRIVACY_NO_ACTION';
  end if;

  if v_target_user_id is not null then
    select role into v_target_role from public.users where id = v_target_user_id;
    if v_target_role is null or v_target_role in ('admin', 'superadmin') or v_target_user_id = auth.uid() then
      raise exception 'INVALID_TARGET';
    end if;
  end if;
  if v_action = 'community_ban' and v_community_id is distinct from v_request.community_id then
    raise exception 'COMMUNITY_MISMATCH';
  end if;
  if v_action = 'remove_content' and v_request.status_id is null then
    raise exception 'NO_STATUS';
  end if;
  if v_action = 'temporary_suspension' and (v_days is null or v_days < 1 or v_days > 30) then
    raise exception 'INVALID_DAYS';
  end if;

  v_until := case when v_action = 'temporary_suspension' then now() + (v_days || ' days')::interval else null end;

  insert into public.moderation_decisions (request_id, admin_id, target_user_id, action, community_id, rule, reason, evidence, until)
  values (v_request_id, auth.uid(), v_target_user_id, v_action, v_community_id, v_rule, v_reason, v_evidence, v_until)
  returning id into v_decision_id;

  update public.support_requests
    set state = 'closed', response = v_reason, decision_id = v_decision_id, decided_at = now()
    where id = v_request_id;

  if v_target_user_id is not null then
    insert into public.notices (user_id, action, rule, reason, community_id, until)
    values (v_target_user_id, v_action, v_rule, v_reason, v_community_id, v_until);
  end if;

  if v_action in ('temporary_suspension', 'system_ban') then
    insert into public.account_restrictions (user_id, action, until, decision_id)
    values (v_target_user_id, v_action, v_until, v_decision_id)
    on conflict (user_id) do update set action = excluded.action, until = excluded.until, decision_id = excluded.decision_id;
  end if;

  if v_action = 'community_ban' then
    insert into public.community_restrictions (community_id, user_id, decision_id)
    values (v_community_id, v_target_user_id, v_decision_id)
    on conflict (community_id, user_id) do update set decision_id = excluded.decision_id;
  end if;

  if v_action = 'restore' then
    if v_community_id is not null then
      delete from public.community_restrictions where community_id = v_community_id and user_id = v_target_user_id;
    else
      delete from public.account_restrictions where user_id = v_target_user_id;
    end if;
  end if;

  if v_action = 'remove_content' then
    delete from public.statuses where id = v_request.status_id;
  end if;

  return v_decision_id;
end;
$$;

-- Equivalent to setAccountStatus. Returns the joined admin view (auth.users.email +
-- public.users) directly — unlike Firestore/Firebase Auth, both live in the same
-- Postgres database here, so no Admin SDK / Edge Function round trip is needed.
create or replace function public.set_account_status(p_user_id uuid, p_disabled boolean, p_reason text default '')
  returns table (id uuid, email text, username text, role text, account_status text, disabled_reason text, created_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare
  v_target_role text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  select u.role into v_target_role from public.users u where u.id = p_user_id;
  if v_target_role is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target_role = 'superadmin' then
    raise exception 'CANNOT_DISABLE_ADMIN';
  end if;
  if p_disabled and (char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500) then
    raise exception 'INVALID_REASON';
  end if;

  update public.users set
    account_status = case when p_disabled then 'disabled' else 'active' end,
    disabled_at = case when p_disabled then now() else null end,
    disabled_by = case when p_disabled then auth.uid() else null end,
    disabled_reason = case when p_disabled then trim(p_reason) else null end
  where public.users.id = p_user_id;

  return query
    select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
    from public.users u join auth.users au on au.id = u.id
    where u.id = p_user_id;
end;
$$;

-- Equivalent to listAccountsForAdmin/accounts-service.js. Same simplification as
-- above: a plain SQL join, no Admin SDK needed. search: exact match on email (contains
-- "@" and no leading "@") or UID, otherwise a "@username" prefix search, otherwise a
-- plain paginated listing — same three modes as the original, minus the Admin SDK.
create or replace function public.admin_list_accounts(p_search text default '', p_cursor uuid default null, p_page_size int default 50)
  returns table (id uuid, email text, username text, role text, account_status text, disabled_reason text, created_at timestamptz)
  language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := trim(coalesce(p_search, ''));
  v_prefix text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_page_size < 1 or p_page_size > 50 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  if v_term <> '' and v_term !~ '^@' and v_term ~ '@' then
    return query
      select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
      from public.users u join auth.users au on au.id = u.id
      where lower(au.email) = lower(v_term)
      limit 1;
    return;
  end if;

  if v_term <> '' and v_term !~ '@' and v_term ~ '^[0-9a-fA-F-]{36}$' then
    return query
      select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
      from public.users u join auth.users au on au.id = u.id
      where u.id = v_term::uuid
      limit 1;
    return;
  end if;

  if v_term <> '' then
    v_prefix := lower(regexp_replace(v_term, '^@', ''));
    return query
      select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
      from public.users u join auth.users au on au.id = u.id
      where u.username like v_prefix || '%'
        and (p_cursor is null or u.id > p_cursor)
      order by u.username, u.id
      limit p_page_size;
    return;
  end if;

  return query
    select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
    from public.users u join auth.users au on au.id = u.id
    where (p_cursor is null or u.id > p_cursor)
    order by u.id
    limit p_page_size;
end;
$$;
