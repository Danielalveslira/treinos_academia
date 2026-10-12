-- AUD-01: rollback imediato desativado. Toda exclusão usa queue_deletion + revisão + worker.
-- Não é possível provar ausência de obrigações por idade da conta ou pelas FKs.
begin;
create or replace function public.delete_own_account() returns void
language plpgsql security invoker set search_path = '' as $$
begin
  raise exception using errcode = '42501', message = 'ACCOUNT_DELETION_REQUIRES_OFFICIAL_FLOW';
end;
$$;
alter function public.delete_own_account() owner to postgres;
revoke all on function public.delete_own_account() from public, anon, authenticated, service_role;

drop policy if exists users_delete_fresh on public.users;
drop policy if exists public_profiles_delete_fresh on public.public_profiles;
drop policy if exists usernames_delete on public.usernames;
revoke delete, truncate on public.users, public.public_profiles, public.public_profile_statistics,
  public.usernames, auth.users from public, anon, authenticated;
-- Não revogar o worker/service_role: suas RPCs continuam com as validações oficiais.
commit;
