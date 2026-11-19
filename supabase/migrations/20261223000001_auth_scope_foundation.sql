-- Additive foundation. Do not enable the Auth hook in a hosted project until the
-- corresponding client and direct-API tests have passed in a separate environment.
set local lock_timeout = '5s';

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'auth_signup') then
    create role auth_signup nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'auth_recovery') then
    create role auth_recovery nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'auth_setup') then
    create role auth_setup nologin;
  end if;
end $$;
grant auth_signup, auth_recovery, auth_setup to authenticator;
grant usage on schema public to auth_signup, auth_recovery, auth_setup;

-- The client never writes this marker. The historical backfill follows the old
-- set_username-last contract; new completions must pass the transactional RPC.
create table if not exists private.auth_onboarding_completed (
  user_id uuid primary key references auth.users(id) on delete cascade,
  completed_at timestamptz not null,
  source text not null check (source in ('legacy', 'signup'))
);
alter table private.auth_onboarding_completed enable row level security;
insert into private.auth_onboarding_completed(user_id, completed_at, source)
select u.id, coalesce(u.legal_acceptance_accepted_at, u.created_at), 'legacy'
from public.users u
join auth.users a on a.id = u.id
where u.username is not null and a.email_confirmed_at is not null
on conflict (user_id) do nothing;
revoke all on private.auth_onboarding_completed from public, anon, authenticated;

-- GoTrue signs the role; user_metadata and a client RPC cannot set it. The hook
-- deliberately relies on the signed AMR carried through refresh, not on aal1 or
-- client-provided purpose. OTP for signup and recovery is restricted in both cases.
create or replace function private.auth_scope_access_token(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_claims jsonb := event->'claims';
  v_user uuid;
  v_password boolean;
  v_completed boolean;
  v_role text;
begin
  if jsonb_typeof(v_claims) is distinct from 'object'
     or (event->>'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or (v_claims->>'sub') is distinct from (event->>'user_id') then
    raise exception 'INVALID_AUTH_HOOK_EVENT';
  end if;
  v_user := (event->>'user_id')::uuid;
  select coalesce(bool_or(item->>'method' = 'password'), false)
    into v_password
  from jsonb_array_elements(
    case when jsonb_typeof(v_claims->'amr') = 'array' then v_claims->'amr' else '[]'::jsonb end
  ) item;
  select exists(select 1 from private.auth_onboarding_completed c where c.user_id = v_user)
    into v_completed;
  v_role := case
    when v_password and v_completed then 'authenticated'
    when v_password then 'auth_setup'
    when v_completed then 'auth_recovery'
    else 'auth_signup'
  end;
  v_claims := jsonb_set(v_claims, '{role}', to_jsonb(v_role));
  return jsonb_set(event, '{claims}', v_claims);
end;
$$;
revoke all on function private.auth_scope_access_token(jsonb) from public, anon, authenticated;
grant usage on schema private to supabase_auth_admin;
grant execute on function private.auth_scope_access_token(jsonb) to supabase_auth_admin;

-- Existing profile and legal functions remain unchanged for established users.
-- New signup sessions receive only this RPC and published legal documents.
create or replace function public.complete_user_onboarding(p_profile jsonb, p_legal jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
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
revoke all on function public.complete_user_onboarding(jsonb,jsonb) from public, anon;
grant execute on function public.complete_user_onboarding(jsonb,jsonb) to authenticated, auth_signup;
grant select on public.legal_policy, public.legal_versions to auth_signup;

-- These SECURITY DEFINER helpers were callable by PUBLIC. Preserve anon and
-- authenticated callers explicitly, while excluding the new transient roles.
revoke execute on function public.is_superadmin() from public;
revoke execute on function public.has_app_access() from public;
revoke execute on function public.community_access_allowed(uuid) from public;
revoke execute on function public.is_community_member(uuid) from public;
revoke execute on function public.is_community_owner(uuid) from public;
revoke execute on function public.can_post_in_community(uuid) from public;
revoke execute on function public.push_delivery_ack(text,text,text) from public;
revoke execute on function public.submit_commercial_lead(text,text,text,text,text,text,text,text,boolean,text) from public;
revoke execute on function public.public_product_catalog(text,text,text,text,integer,integer) from public;
revoke execute on function public.public_list_professionals(text,text,text,text,text,integer,integer) from public;
revoke execute on function public.public_get_professional(uuid) from public;
revoke execute on function public.public_professional_avatar_visible(text) from public;
revoke execute on function public.public_storefront_sitemap(uuid,integer) from public;
revoke execute on function public.public_listing_sitemap(uuid,integer) from public;
revoke execute on function public.authorize_storefront_media(uuid) from public;

grant execute on function public.is_superadmin() to anon, authenticated;
grant execute on function public.has_app_access() to anon, authenticated;
grant execute on function public.community_access_allowed(uuid) to anon, authenticated;
grant execute on function public.is_community_member(uuid) to anon, authenticated;
grant execute on function public.is_community_owner(uuid) to anon, authenticated;
grant execute on function public.can_post_in_community(uuid) to anon, authenticated;
grant execute on function public.push_delivery_ack(text,text,text) to anon, authenticated;
grant execute on function public.submit_commercial_lead(text,text,text,text,text,text,text,text,boolean,text) to anon, authenticated;
grant execute on function public.public_product_catalog(text,text,text,text,integer,integer) to anon, authenticated;
grant execute on function public.public_list_professionals(text,text,text,text,text,integer,integer) to anon, authenticated;
grant execute on function public.public_get_professional(uuid) to anon, authenticated;
grant execute on function public.public_professional_avatar_visible(text) to anon, authenticated;
grant execute on function public.public_storefront_sitemap(uuid,integer) to anon, authenticated;
grant execute on function public.public_listing_sitemap(uuid,integer) to anon, authenticated;
grant execute on function public.authorize_storefront_media(uuid) to anon, authenticated;
