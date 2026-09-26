-- One grouped query instead of one count() per option (the Firestore version had to
-- do the latter since it had no GROUP BY equivalent available client-side). security
-- definer because it needs to see every vote for the status, not just the caller's own
-- (RLS on status_votes restricts SELECT to the caller's row) — so the membership check
-- that RLS would normally provide is done explicitly here instead.
create or replace function public.get_poll_results(p_status_id uuid)
  returns table (option_id text, votes bigint)
  language plpgsql stable security definer set search_path = public as $$
declare
  v_community_id uuid;
begin
  select s.community_id into v_community_id from public.statuses s where s.id = p_status_id;
  if v_community_id is null or not public.is_community_member(v_community_id) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return query
    select sv.option_id, count(*) from public.status_votes sv
    where sv.status_id = p_status_id
    group by sv.option_id;
end;
$$;
