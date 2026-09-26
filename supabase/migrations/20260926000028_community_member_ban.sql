alter table public.community_restrictions
  add column if not exists banned_by uuid references public.users(id),
  add column if not exists reason text;

-- Equivalente a setCommunityMemberBan (functions/community-moderation-service.js):
-- superadmin OU dono da comunidade podem banir/desbanir um membro. Uma restrição
-- formal (decision_id preenchido, aplicada via decide_support_request/community_ban)
-- só pode ser removida ou sobrescrita por superadmin — o dono da comunidade nunca
-- desfaz uma decisão de moderação global por cima.
create or replace function public.set_community_member_ban(
  p_community_id uuid, p_target_user_id uuid, p_banned boolean, p_reason text default null
) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
  v_existing record;
begin
  if not (public.is_superadmin() or public.is_community_owner(p_community_id)) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_target_user_id = v_admin_id then
    raise exception 'CANNOT_BAN_SELF';
  end if;
  select role into v_target_role from public.users where id = p_target_user_id;
  if v_target_role in ('admin', 'superadmin') then
    raise exception 'PROTECTED_ROLE';
  end if;

  select * into v_existing from public.community_restrictions
    where community_id = p_community_id and user_id = p_target_user_id;

  if v_existing.decision_id is not null and not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_banned then
    if char_length(trim(coalesce(p_reason, ''))) < 5 then
      raise exception 'INVALID_REASON';
    end if;
    insert into public.community_restrictions (community_id, user_id, banned_by, reason, created_at)
      values (p_community_id, p_target_user_id, v_admin_id, trim(p_reason), now())
      on conflict (community_id, user_id) do update set
        banned_by = excluded.banned_by, reason = excluded.reason, created_at = excluded.created_at,
        decision_id = null;
  else
    delete from public.community_restrictions
      where community_id = p_community_id and user_id = p_target_user_id;
  end if;
end;
$$;

create or replace function public.list_community_restrictions(p_community_id uuid)
  returns setof public.community_restrictions
  language sql stable security definer set search_path = public as $$
    select * from public.community_restrictions
    where community_id = p_community_id
      and (public.is_superadmin() or public.is_community_owner(p_community_id))
$$;
