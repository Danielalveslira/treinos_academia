-- Only a trusted server component may attest that GoTrue accepted the new
-- password and revoked other sessions. The browser cannot set this state.
set local lock_timeout = '5s';

create table private.auth_signup_password_progress (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  password_updated_at timestamptz,
  others_revoked_at timestamptz,
  check (others_revoked_at is null or password_updated_at is not null)
);
create index auth_signup_password_progress_user_idx
  on private.auth_signup_password_progress(user_id);
alter table private.auth_signup_password_progress enable row level security;
revoke all on private.auth_signup_password_progress from public, anon, authenticated;

create function public.get_signup_password_progress(p_user_id uuid, p_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'completed', exists(select 1 from private.auth_onboarding_completed c where c.user_id = p_user_id),
    'passwordUpdated', exists(
      select 1 from private.auth_signup_password_progress p
      join auth.sessions s on s.id = p.session_id and s.user_id = p.user_id
      where p.user_id = p_user_id and p.session_id = p_session_id
        and (s.not_after is null or s.not_after > now()) and p.password_updated_at is not null),
    'othersRevoked', exists(
      select 1 from private.auth_signup_password_progress p
      join auth.sessions s on s.id = p.session_id and s.user_id = p.user_id
      where p.user_id = p_user_id and p.session_id = p_session_id
        and (s.not_after is null or s.not_after > now()) and p.others_revoked_at is not null)
  )
$$;
revoke all on function public.get_signup_password_progress(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_signup_password_progress(uuid,uuid) to service_role;

create function public.record_signup_password_progress(p_user_id uuid, p_session_id uuid, p_step text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_step not in ('password_updated', 'others_revoked')
     or not exists(select 1 from auth.sessions s where s.id = p_session_id and s.user_id = p_user_id
                   and (s.not_after is null or s.not_after > now()))
     or exists(select 1 from private.auth_onboarding_completed where user_id = p_user_id) then
    raise exception 'INVALID_SIGNUP_PROGRESS' using errcode = '42501';
  end if;
  if p_step = 'password_updated' then
    insert into private.auth_signup_password_progress(session_id,user_id,password_updated_at)
      values (p_session_id,p_user_id,now())
    on conflict (session_id) do update set password_updated_at = coalesce(
      private.auth_signup_password_progress.password_updated_at, excluded.password_updated_at);
  else
    update private.auth_signup_password_progress
      set others_revoked_at = coalesce(others_revoked_at, now())
      where session_id = p_session_id and user_id = p_user_id and password_updated_at is not null;
    if not found then raise exception 'PASSWORD_UPDATE_REQUIRED' using errcode = '42501'; end if;
  end if;
end;
$$;
revoke all on function public.record_signup_password_progress(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.record_signup_password_progress(uuid,uuid,text) to service_role;

create or replace function public.complete_user_onboarding(p_profile jsonb, p_legal jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session_id text := auth.jwt()->>'session_id';
  v_code text;
  v_amr_otp boolean;
begin
  if v_uid is null or not coalesce(private.current_session_active(), false) then
    raise exception 'SESSION_REVOKED' using errcode = '42501';
  end if;
  select coalesce(bool_or(item->>'method' = 'otp'), false) into v_amr_otp
  from jsonb_array_elements(
    case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end
  ) item;
  if auth.role() not in ('auth_signup', 'authenticated') or not v_amr_otp
     or not public.email_verified_ok(v_uid) then
    raise exception 'ONBOARDING_SESSION_REQUIRED' using errcode = '42501';
  end if;
  if jsonb_typeof(p_profile) is distinct from 'object'
     or jsonb_typeof(p_legal) is distinct from 'object' then
    raise exception 'INVALID_ONBOARDING';
  end if;
  v_code := p_profile->>'residenceMunicipalityCode';
  if v_code !~ '^[0-9]{7}$' then raise exception 'INVALID_MUNICIPALITY'; end if;

  perform public.ensure_user_profile();
  perform 1 from public.users where id = v_uid for update;
  if exists(select 1 from private.auth_onboarding_completed where user_id = v_uid) then
    return true;
  end if;
  if v_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or not exists (
       select 1 from private.auth_signup_password_progress p
       where p.session_id = v_session_id::uuid and p.user_id = v_uid
         and p.password_updated_at is not null and p.others_revoked_at is not null
     ) then
    raise exception 'PASSWORD_PROOF_REQUIRED' using errcode = '42501';
  end if;
  -- A revoked session can retain a cryptographically valid JWT. The session
  -- table is authoritative; no earlier password session may survive promotion.
  if exists(select 1 from auth.sessions s where s.user_id = v_uid and s.id <> v_session_id::uuid
            and (s.not_after is null or s.not_after > now())) then
    raise exception 'SESSION_REVOCATION_REQUIRED' using errcode = '42501';
  end if;
  perform public.set_birth_info(jsonb_build_object(
    'sexo', p_profile->>'sexo', 'dataNascimento', p_profile->>'birthDate'));
  perform public.set_residence_municipality(v_code::integer);
  perform public.set_usage_profile(p_profile->>'usageProfile');
  perform public.set_username(p_profile->>'username');
  perform public.accept_legal_documents(p_legal);
  insert into private.auth_onboarding_completed(user_id, completed_at, source)
    values (v_uid, now(), 'signup');
  return true;
end;
$$;
