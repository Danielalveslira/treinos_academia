-- Helper functions used by RLS policies. security definer because they read rows
-- (other users' role/restrictions) the calling role would not otherwise see.

create or replace function public.is_superadmin() returns boolean
  language sql stable security definer set search_path = public as $$
    select exists(select 1 from public.users where id = auth.uid() and role = 'superadmin')
$$;

-- Equivalent to hasAppAccess() in firestore.rules: terms accepted, account not
-- disabled/deleting, no active restriction. isSignedIn()'s "no pending account
-- deletion job" becomes a direct check on account_status here, since the
-- deletion worker flips it to 'deleting' in the same transaction that queues the job.
create or replace function public.has_app_access() returns boolean
  language sql stable security definer set search_path = public as $$
    select
      u.account_status <> 'deleting'
      and (u.role = 'superadmin' or u.account_status <> 'disabled')
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
$$;

create or replace function public.community_access_allowed(p_community_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select c.is_active
      and not exists (select 1 from public.community_restrictions cr
                       where cr.community_id = p_community_id and cr.user_id = auth.uid())
    from public.communities c where c.id = p_community_id
$$;

create or replace function public.is_community_member(p_community_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select public.has_app_access()
      and public.community_access_allowed(p_community_id)
      and exists (select 1 from public.community_members
                  where community_id = p_community_id and user_id = auth.uid())
$$;
