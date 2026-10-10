-- Remover / Banir / Desbanir membro de comunidade = revogação real de acesso, decidida pelo servidor.
--
-- Problema original: banir só gravava uma linha em community_restrictions. A linha de
-- community_members continuava existindo, então:
--   * is_community_member() já negava posts/comentários/mídia (RLS), mas o app perguntava
--     "sou membro?" lendo community_members (a própria linha é legível pelo dono dela) e
--     concluía que sim: a tela abria, com composer e menu de membro, só que vazia;
--   * toda leitura direta de community_members (anúncios direcionados, denúncia, contagens,
--     member_count) continuava tratando o banido como membro.
--
-- Modelo final (três ações distintas):
--   REMOVER  : apaga o vínculo (community_members). Sem restrição; a pessoa pode entrar de novo.
--   BANIR    : cria a restrição (community_restrictions) E apaga o vínculo; bloqueia a reentrada.
--   DESBANIR : apaga a restrição. NÃO recria o vínculo: a pessoa vira "not_member" e precisa entrar.
-- Invariante: nunca existe "restrição ativa + vínculo ativo" para o mesmo (comunidade, usuário).
-- community_restrictions só representa banimento total (não há tipos parciais: suspensão de conta
-- vive em account_restrictions e não toca em vínculos), então toda linha nela revoga o vínculo.

-- 0) Trava por (comunidade, usuário) que serializa "entrar" x "banir". Vale até o fim da transação.
create or replace function private.lock_membership(p_community_id uuid, p_user_id uuid) returns void
  language sql volatile set search_path = '' as $$
    select pg_advisory_xact_lock(hashtextextended(p_community_id::text || ':' || p_user_id::text, 0))
$$;
revoke execute on function private.lock_membership(uuid, uuid) from public, anon, authenticated;

-- 1) Restrição nova/alterada remove o vínculo (e, via bump_member_count, desconta o contador).
create or replace function private.revoke_membership_on_restriction() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_membership(new.community_id, new.user_id);
  delete from public.community_members
    where community_id = new.community_id and user_id = new.user_id;
  return null;
end;
$$;
revoke execute on function private.revoke_membership_on_restriction() from public, anon, authenticated;

drop trigger if exists community_restrictions_revoke_membership on public.community_restrictions;
create trigger community_restrictions_revoke_membership
  after insert or update of community_id, user_id on public.community_restrictions
  for each row execute function private.revoke_membership_on_restriction();

-- 2) Fecha a janela de corrida do outro lado: um INSERT de vínculo concorrente a um banimento não
-- pode sobreviver a ele. A trava acima faz o INSERT esperar o banimento terminar (e então enxergar
-- a restrição) ou fazer o banimento esperar o INSERT (e então apagá-lo). Vale para qualquer
-- caminho de escrita, inclusive service_role.
create or replace function private.guard_membership_insert() returns trigger
  language plpgsql security definer set search_path = '' as $$
begin
  perform private.lock_membership(new.community_id, new.user_id);
  if exists (select 1 from public.community_restrictions r
             where r.community_id = new.community_id and r.user_id = new.user_id) then
    raise exception 'COMMUNITY_BANNED' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.guard_membership_insert() from public, anon, authenticated;

drop trigger if exists community_members_guard_insert on public.community_members;
create trigger community_members_guard_insert
  before insert on public.community_members
  for each row execute function private.guard_membership_insert();

-- 3) Backfill: quem já está banido hoje e ainda tem vínculo. Remove SOMENTE essas interseções.
delete from public.community_members m
  using public.community_restrictions r
  where r.community_id = m.community_id and r.user_id = m.user_id;

-- 4) BANIR. Só superadmin ou dono; nunca a si mesmo, admin/superadmin ou o dono da comunidade
-- (ele conservaria poderes de moderação por owner_id sem poder participar). Idempotente: banir quem
-- já está banido não altera quem baniu, o motivo nem a data originais. Auditado.
create or replace function public.set_community_member_ban(
  p_community_id uuid, p_target_user_id uuid, p_banned boolean, p_reason text default null
) returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
  v_existing record;
  v_deleted integer;
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
  if exists (select 1 from public.communities where id = p_community_id and owner_id = p_target_user_id) then
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
    -- Já banido: nada a fazer (idempotente). A inserção dispara o trigger que remove o vínculo.
    insert into public.community_restrictions (community_id, user_id, banned_by, reason, created_at)
      values (p_community_id, p_target_user_id, v_admin_id, trim(p_reason), now())
      on conflict (community_id, user_id) do nothing;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      insert into public.admin_audit_log (admin_user_id, target_user_id, action, reason, metadata)
        values (v_admin_id, p_target_user_id, 'community_member_banned', left(trim(p_reason), 500),
                jsonb_build_object('community_id', p_community_id));
    end if;
  else
    delete from public.community_restrictions
      where community_id = p_community_id and user_id = p_target_user_id;
    get diagnostics v_deleted = row_count;
    if v_deleted > 0 then
      insert into public.admin_audit_log (admin_user_id, target_user_id, action, metadata)
        values (v_admin_id, p_target_user_id, 'community_member_unbanned',
                jsonb_build_object('community_id', p_community_id));
    end if;
  end if;
end;
$$;

-- 5) REMOVER (distinto de banir). Mesmas proteções de alvo. Idempotente: remover quem já não é
-- membro é um no-op sem erro. Não existe policy de DELETE para o dono em community_members: o único
-- caminho é esta RPC. Auditado quando de fato remove.
create or replace function public.remove_community_member(p_community_id uuid, p_target_user_id uuid)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_actor uuid := auth.uid();
  v_target_role text;
  v_deleted integer;
begin
  if v_actor is null or not coalesce(public.has_app_access(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not (public.is_superadmin() or public.is_community_owner(p_community_id)) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_target_user_id = v_actor then
    raise exception 'CANNOT_REMOVE_SELF';
  end if;
  select role into v_target_role from public.users where id = p_target_user_id;
  if v_target_role in ('admin', 'superadmin') then
    raise exception 'PROTECTED_ROLE';
  end if;
  if exists (select 1 from public.communities where id = p_community_id and owner_id = p_target_user_id) then
    raise exception 'PROTECTED_ROLE';
  end if;

  delete from public.community_members
    where community_id = p_community_id and user_id = p_target_user_id;
  get diagnostics v_deleted = row_count;
  if v_deleted > 0 then
    insert into public.admin_audit_log (admin_user_id, target_user_id, action, metadata)
      values (v_actor, p_target_user_id, 'community_member_removed',
              jsonb_build_object('community_id', p_community_id));
  end if;
end;
$$;
revoke execute on function public.remove_community_member(uuid, uuid) from public, anon;
grant execute on function public.remove_community_member(uuid, uuid) to authenticated;

-- 6) Estado de acesso do usuário logado a UMA comunidade, calculado no servidor. É a única fonte
-- que o app usa para decidir se abre a área interna ou o bloqueio. Fail-closed: sem sessão/termos/
-- conta ativa, ou comunidade inexistente/inativa => 'unavailable'. Duas consultas por chave primária.
--   member | not_member | banned | unavailable
create or replace function public.get_community_access(p_community_id uuid) returns text
  language sql stable security definer set search_path = public, pg_temp as $$
    select case
      when auth.uid() is null or not coalesce(public.has_app_access(), false) then 'unavailable'
      when c.id is null then 'unavailable'
      when exists (select 1 from public.community_restrictions r
                   where r.community_id = c.id and r.user_id = auth.uid()) then 'banned'
      when not c.is_active then 'unavailable'
      when exists (select 1 from public.community_members m
                   where m.community_id = c.id and m.user_id = auth.uid()) then 'member'
      else 'not_member'
    end
    from (select 1) one
    left join public.communities c on c.id = p_community_id
$$;
revoke execute on function public.get_community_access(uuid) from public, anon;
grant execute on function public.get_community_access(uuid) to authenticated;
