-- Comunidades ganharam dono opcional (Fase 5 do main): uma comunidade "oficial" criada
-- pelo painel admin nasce sem owner_id e continua só de superadmin; o único caminho que
-- grava owner_id de verdade é a criação paga (economia, ainda não portada) — aqui só
-- preparamos a coluna e as policies que já dependem dela.
alter table public.communities add column if not exists owner_id uuid references public.users(id);

create or replace function public.is_community_owner(p_community_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select owner_id = auth.uid() from public.communities where id = p_community_id
$$;

-- communities: dono também pode atualizar (antes só superadmin), createdBy/createdAt/
-- ownerId permanecem imutáveis (reforçado por trigger, já que RLS não compara OLD/NEW
-- diretamente).
-- communities_select (leitura) já existe desde a migration 010 e não muda aqui.
drop policy if exists communities_write on public.communities;
create policy communities_insert on public.communities for insert
  with check (public.is_superadmin());
create policy communities_update on public.communities for update
  using (public.is_superadmin() or public.is_community_owner(id))
  with check (public.is_superadmin() or public.is_community_owner(id));
create policy communities_delete on public.communities for delete
  using (public.is_superadmin());

create or replace function public.enforce_community_immutable_fields() returns trigger
  language plpgsql as $$
begin
  if new.created_by <> old.created_by then raise exception 'CREATED_BY_IMMUTABLE'; end if;
  if new.created_at <> old.created_at then raise exception 'CREATED_AT_IMMUTABLE'; end if;
  if new.owner_id is distinct from old.owner_id and not public.is_superadmin() then
    raise exception 'OWNER_ID_IMMUTABLE';
  end if;
  return new;
end;
$$;

create trigger communities_enforce_immutable
  before update on public.communities
  for each row execute function public.enforce_community_immutable_fields();

-- community_members: leitura também liberada para o dono da comunidade (antes só o
-- próprio membro ou superadmin).
drop policy if exists community_members_select on public.community_members;
create policy community_members_select on public.community_members for select
  using (user_id = auth.uid() or public.is_superadmin() or public.is_community_owner(community_id));
