-- Enforcement after the hook, onboarding client and legacy-session rollout have
-- been verified. Deploying this migration alone is compatible with password
-- sessions that have a completed onboarding marker.
set local lock_timeout = '5s';

create function public.is_full_login_session() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.role() = 'authenticated'
     and coalesce(private.current_session_active(), false)
     and exists(select 1 from private.auth_onboarding_completed c where c.user_id = auth.uid())
     and exists (
       select 1 from jsonb_array_elements(
         case when jsonb_typeof(auth.jwt()->'amr') = 'array'
              then auth.jwt()->'amr' else '[]'::jsonb end
       ) item where item->>'method' = 'password'
     )
$$;
revoke all on function public.is_full_login_session() from public, anon;
grant execute on function public.is_full_login_session() to authenticated;

create or replace function public.has_app_access() returns boolean
language sql stable security definer set search_path = '' as $$
 select case when not public.is_full_login_session() then false else (
select
      u.account_status <> 'deleting'
      and (u.role = 'superadmin' or u.account_status <> 'disabled')
      and (u.role = 'superadmin' or public.email_verified_ok(u.id))
      and (
        not exists (select 1 from public.legal_policy where id and published)
        or (u.legal_acceptance_version = (select version from public.legal_policy where id)
            and u.legal_acceptance_digest = (select digest from public.legal_policy where id))
      )
      and not exists (
        select 1 from public.account_restrictions r
        where r.user_id = auth.uid()
          and not (r.action = 'temporary_suspension' and r.until <= now())
      )
    from public.users u where u.id = auth.uid()
 ) end
$$;

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_full_login_session()
    and exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'superadmin')
$$;
