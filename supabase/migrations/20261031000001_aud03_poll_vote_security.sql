-- AUD-03: additive release; never rewrites or removes historical votes.
set local lock_timeout = '5s';

-- Private helper accepts an ID, never a caller-supplied status record. Same member
-- contract as existing poll RPCs (superadmin must also be a member for polls).
create function private.can_access_poll(p_status_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from public.statuses s
    where s.id = p_status_id and s.type = 'poll'
      and coalesce(public.is_community_member(s.community_id), false)
      and coalesce(private.comments_open(s), false)
  )
$$;
revoke all on function private.can_access_poll(uuid) from public, anon;
grant execute on function private.can_access_poll(uuid) to authenticated;

create function private.poll_has_option(p_options jsonb, p_option text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_option is not null and exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_options) = 'array'
      then p_options else '[]'::jsonb end) o
    where jsonb_typeof(o->'id') = 'string' and jsonb_typeof(o->'label') = 'string'
      and o->>'id' = p_option
  ), false)
$$;
revoke all on function private.poll_has_option(jsonb,text) from public, anon;
grant execute on function private.poll_has_option(jsonb,text) to authenticated;

-- Lock exactly one destination row; concurrent privileged option edits/deletion
-- cannot race validation. The PK already serializes competing votes by one user.
create function private.validate_poll_vote() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status public.statuses;
begin
  -- BEFORE triggers precede INSERT WITH CHECK. Deny inaccessible polls before
  -- reporting option validity, which would otherwise disclose protected metadata.
  if current_setting('role',true) in ('anon','authenticated')
    and not private.can_access_poll(new.status_id) then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  select * into v_status from public.statuses where id = new.status_id for share;
  if not found or v_status.type <> 'poll'
    or not private.poll_has_option(v_status.poll_options,new.option_id) then
    raise exception 'INVALID_POLL_OPTION' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (new.status_id is distinct from old.status_id
    or new.user_id is distinct from old.user_id or new.created_at is distinct from old.created_at) then
    raise exception 'IMMUTABLE_POLL_VOTE_IDENTITY' using errcode = '23514';
  end if;
  return new;
end
$$;
revoke all on function private.validate_poll_vote() from public, anon, authenticated;
create trigger validate_poll_vote before insert or update on public.status_votes
for each row execute function private.validate_poll_vote();

-- Reject unknown permissive policies instead of silently leaving an OR bypass.
do $$ begin
  if exists(select 1 from pg_policies where schemaname='public'
    and tablename='status_votes' and policyname <> 'status_votes_all') then
    raise exception 'AUD03_UNEXPECTED_VOTE_POLICY';
  end if;
end $$;
drop policy status_votes_all on public.status_votes;
create policy status_votes_select on public.status_votes for select to authenticated
using (user_id = (select auth.uid()) and private.can_access_poll(status_id));
create policy status_votes_insert on public.status_votes for insert to authenticated
with check (user_id = (select auth.uid()) and private.can_access_poll(status_id));
create policy status_votes_update on public.status_votes for update to authenticated
using (user_id = (select auth.uid()) and private.can_access_poll(status_id))
with check (user_id = (select auth.uid()) and private.can_access_poll(status_id));
create policy status_votes_delete on public.status_votes for delete to authenticated
using (user_id = (select auth.uid()) and private.can_access_poll(status_id));

revoke all on public.status_votes from public, anon, authenticated;
-- Also clear any old column ACLs; table REVOKE alone does not remove them.
do $$ declare c record; begin
  for c in select attname from pg_attribute where attrelid='public.status_votes'::regclass
    and attnum>0 and not attisdropped loop
    execute format('revoke select (%I), insert (%I), update (%I), references (%I) on public.status_votes from public, anon, authenticated',
      c.attname,c.attname,c.attname,c.attname);
  end loop;
end $$;
grant select, delete on public.status_votes to authenticated;
-- PostgREST UPSERT assigns every supplied column, including unchanged PK fields.
-- The trigger makes those fields immutable, while retaining this existing API.
grant insert(status_id,user_id,option_id), update(status_id,user_id,option_id) on public.status_votes to authenticated;

create or replace function public.get_poll_results(p_status_id uuid)
returns table(option_id text,votes bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_access_poll(p_status_id) then
    raise exception 'PERMISSION_DENIED' using errcode = '42501';
  end if;
  return query select sv.option_id,count(*) from public.status_votes sv
    where sv.status_id=p_status_id group by sv.option_id;
end $$;

create or replace function public.get_poll_results_batch(p_status_ids uuid[])
returns table(status_id uuid,option_id text,votes bigint)
language sql stable security definer set search_path = '' as $$
  with visible as materialized (
    select s.id from public.statuses s
    where s.id=any((coalesce(p_status_ids,'{}'::uuid[]))[1:100])
      and auth.uid() is not null and s.type='poll'
      and coalesce(public.is_community_member(s.community_id),false)
      and coalesce(private.comments_open(s),false)
  )
  select sv.status_id,sv.option_id,count(*) from visible v
  join public.status_votes sv on sv.status_id=v.id group by sv.status_id,sv.option_id
$$;
revoke all on function public.get_poll_results(uuid), public.get_poll_results_batch(uuid[]) from public, anon;
grant execute on function public.get_poll_results(uuid), public.get_poll_results_batch(uuid[]) to authenticated;
notify pgrst, 'reload schema';
