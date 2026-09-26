-- Row Level Security policies. Every domain table gets RLS enabled; tables with no
-- policy for a given role deny that role entirely (Postgres RLS default-deny).

-- users
alter table public.users enable row level security;
create policy users_select on public.users for select
  using (id = auth.uid() or public.is_superadmin());
create policy users_update on public.users for update
  using (id = auth.uid())
  with check (id = auth.uid());
create policy users_delete_fresh on public.users for delete
  using (id = auth.uid() and created_at > now() - interval '10 minutes');

-- usernames (public: needed to check handle availability before signup)
alter table public.usernames enable row level security;
create policy usernames_select on public.usernames for select using (true);

-- public_profiles / statistics
alter table public.public_profiles enable row level security;
create policy public_profiles_select on public.public_profiles for select using (true);

alter table public.public_profile_statistics enable row level security;
create policy public_profile_statistics_select on public.public_profile_statistics for select
  using (exists (
    select 1 from public.public_profiles p
    where p.user_id = public_profile_statistics.user_id and p.share_statistics
  ));

-- exercises / workouts
alter table public.exercises enable row level security;
create policy exercises_all on public.exercises for all
  using (user_id = auth.uid() and public.has_app_access())
  with check (user_id = auth.uid() and public.has_app_access());

alter table public.workouts enable row level security;
create policy workouts_all on public.workouts for all
  using (user_id = auth.uid() and public.has_app_access())
  with check (user_id = auth.uid() and public.has_app_access());

-- communities / membership
alter table public.communities enable row level security;
create policy communities_select on public.communities for select
  using (public.has_app_access());
create policy communities_write on public.communities for all
  using (public.is_superadmin())
  with check (public.is_superadmin());

alter table public.community_members enable row level security;
create policy community_members_select on public.community_members for select
  using (user_id = auth.uid() or public.is_superadmin());
create policy community_members_insert on public.community_members for insert
  with check (user_id = auth.uid() and public.has_app_access() and public.community_access_allowed(community_id));
create policy community_members_delete on public.community_members for delete
  using (user_id = auth.uid());

-- statuses and sub-resources
alter table public.statuses enable row level security;
create policy statuses_select on public.statuses for select
  using (public.is_community_member(community_id) or public.is_superadmin());
create policy statuses_insert on public.statuses for insert
  with check (author_id = auth.uid() and public.is_community_member(community_id));
create policy statuses_delete on public.statuses for delete
  using (author_id = auth.uid() or public.is_superadmin());

alter table public.status_votes enable row level security;
create policy status_votes_all on public.status_votes for all
  using (user_id = auth.uid() and public.is_community_member(
    (select community_id from public.statuses where id = status_votes.status_id)
  ))
  with check (user_id = auth.uid());

alter table public.status_participants enable row level security;
create policy status_participants_all on public.status_participants for all
  using (user_id = auth.uid() and public.is_community_member(
    (select community_id from public.statuses where id = status_participants.status_id)
  ))
  with check (user_id = auth.uid());

-- support / moderation: read-only for the owner or superadmin; all writes go through
-- security-definer RPCs (see phase 5), never direct client insert/update/delete.
alter table public.support_requests enable row level security;
create policy support_requests_select on public.support_requests for select
  using (user_id = auth.uid() or public.is_superadmin());

alter table public.moderation_decisions enable row level security;
create policy moderation_decisions_select on public.moderation_decisions for select
  using (public.is_superadmin());

alter table public.account_restrictions enable row level security;
create policy account_restrictions_select on public.account_restrictions for select
  using (user_id = auth.uid() or public.is_superadmin());

alter table public.community_restrictions enable row level security;
create policy community_restrictions_select on public.community_restrictions for select
  using (user_id = auth.uid() or public.is_superadmin());

alter table public.legal_acceptances enable row level security;
create policy legal_acceptances_select on public.legal_acceptances for select
  using (user_id = auth.uid() or public.is_superadmin());

alter table public.notices enable row level security;
create policy notices_select on public.notices for select
  using (user_id = auth.uid());

-- legal policy / versions (public, read-only)
alter table public.legal_policy enable row level security;
create policy legal_policy_select on public.legal_policy for select using (true);

alter table public.legal_versions enable row level security;
create policy legal_versions_select on public.legal_versions for select using (true);

-- server-only tables: RLS enabled, deliberately no policies for anon/authenticated.
alter table public.deletion_jobs enable row level security;
alter table public.support_limits enable row level security;
