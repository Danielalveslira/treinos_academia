-- Supabase Auth's client SDK has no "delete my own account" method (unlike Firebase's
-- currentUser.delete()), so registration rollback (Register.jsx) needs a dedicated RPC.
-- Deleting the auth.users row cascades to public.users -> public_profiles/usernames.
create or replace function public.delete_own_account() returns void
  language plpgsql security definer set search_path = public as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

-- Registration rollback (deleteFreshProfile) also needs to delete its own fresh
-- public_profiles/usernames rows directly as the client, mirroring the "delete
-- allowed only in the minutes after signup" rule that already exists on users.
create policy public_profiles_delete_fresh on public.public_profiles for delete
  using (
    user_id = auth.uid()
    and exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.created_at > now() - interval '10 minutes'
    )
  );

create policy usernames_delete on public.usernames for delete
  using (user_id = auth.uid());
