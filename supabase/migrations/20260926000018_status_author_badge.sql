-- Equivalent to firestore.rules' "authorIsSuperAdmin == isSuperAdmin()": the badge
-- shown in the feed must reflect the real role, never whatever the client sends.
create or replace function public.enforce_status_author_badge() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  new.author_is_superadmin := public.is_superadmin();
  return new;
end;
$$;

create trigger statuses_enforce_author_badge
  before insert on public.statuses
  for each row execute function public.enforce_status_author_badge();
