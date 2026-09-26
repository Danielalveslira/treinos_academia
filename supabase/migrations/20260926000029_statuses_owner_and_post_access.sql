-- statusCommunityOk (main): respeita postAccess:'admins' considerando o dono da
-- comunidade como admin também. A policy original de insert nunca chegou a checar
-- post_access — corrigido aqui.
create or replace function public.can_post_in_community(p_community_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select public.is_community_member(p_community_id)
      and (
        c.post_access = 'everyone'
        or public.is_superadmin()
        or c.owner_id = auth.uid()
      )
    from public.communities c where c.id = p_community_id
$$;

drop policy if exists statuses_insert on public.statuses;
create policy statuses_insert on public.statuses for insert
  with check (author_id = auth.uid() and public.can_post_in_community(community_id));

-- delete: autor, superadmin, ou dono da comunidade (Fase 5 do main).
drop policy if exists statuses_delete on public.statuses;
create policy statuses_delete on public.statuses for delete
  using (author_id = auth.uid() or public.is_superadmin() or public.is_community_owner(community_id));
