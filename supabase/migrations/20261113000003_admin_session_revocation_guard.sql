-- PROMPT_CORRECAO_LOGOUT_GLOBAL_EVOLUTUS (2ª auditoria), Etapa 4: extensão RPC a RPC do guard de
-- sessão (private.current_session_active(), 20261113000001) para operações administrativas e de
-- superadmin -- a prioridade #2 da auditoria, depois de financeiro (que permanece INTOCADO: a
-- auditoria financeira paralela está revisando exatamente essas funções em
-- supabase/migrations/20261112*, e has_app_access() segue fora do escopo desta migration pelo
-- mesmo motivo). Decisão coordenada com o responsável: aplicar diretamente nestas 5 funções
-- (confirmadas superadmin-only ou community-owner-only via leitura real do projeto hospedado, não
-- do histórico de migrations, que pode ter divergido), sem alterar has_app_access() nem nenhuma
-- RPC financeira.
--
-- Fora do escopo desta migration (documentado como pendência no relatório, não esquecido):
--   - comment_delete / private.comment_delete: usada também por QUALQUER autor apagando o próprio
--     comentário (não é admin-only) -- caminho de alta frequência; adicionar aqui exigiria medir
--     custo de latência separadamente do caso admin, decisão deliberadamente adiada.
--   - delete_professional_listing: ação do PRÓPRIO profissional sobre o próprio anúncio (owner_id
--     = auth.uid()), não uma função administrativa -- fora da prioridade "admin/superadmin" desta
--     etapa.
--   - admin_account_communities/admin_account_financial/admin_accounts_snapshot/admin_list_* e
--     demais LEITURAS administrativas: menor severidade que uma mutação: ficam para uma etapa
--     seguinte (ver relatório final, seção F).
--
-- Todas as 5 funções abaixo já são cobertas por testes que usam o helper compartilhado
-- supabase/tests/_helpers/auth_session.sql (pg_temp.set_test_user), que JÁ cria sessão real em
-- auth.sessions com session_id no JWT -- nenhum teste existente precisa ser adaptado para
-- continuar passando; só testes NOVOS (sessão revogada) foram acrescentados.
set local lock_timeout = '5s';

-- =====================================================================================
-- 1) set_account_status -- cobre admin_set_accounts_status (wrapper em lote) transitivamente,
--    já que ele chama set_account_status por id. Vigente: 20261103000001.
-- =====================================================================================
create or replace function public.set_account_status(p_user_id uuid, p_disabled boolean, p_reason text default '')
returns table(id uuid, email text, username text, role text, account_status text, disabled_reason text, created_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target_role text;
  v_previous_status text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  select u.role, u.account_status into v_target_role, v_previous_status from public.users u where u.id = p_user_id for update;
  if v_target_role is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target_role = 'superadmin' then
    raise exception 'CANNOT_DISABLE_ADMIN';
  end if;
  if v_previous_status = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;
  if p_disabled is null then raise exception 'INVALID_ARGUMENT'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'INVALID_REASON'; end if;
  if p_disabled and (char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500) then
    raise exception 'INVALID_REASON';
  end if;

  if (v_previous_status = 'disabled') is distinct from p_disabled then
  update public.users set
    account_status = case when p_disabled then 'disabled' else 'active' end,
    disabled_at = case when p_disabled then now() else null end,
    disabled_by = case when p_disabled then auth.uid() else null end,
    disabled_reason = case when p_disabled then trim(p_reason) else null end
  where public.users.id = p_user_id;

    insert into public.admin_audit_log (admin_user_id, target_user_id, action, reason, metadata)
    values (
      auth.uid(), p_user_id,
      case when p_disabled then 'account_disabled' else 'account_reactivated' end,
      nullif(trim(coalesce(p_reason, '')), ''),
      jsonb_build_object('previous_status', v_previous_status)
    );
  end if;

  return query
    select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
    from public.users u join auth.users au on au.id = u.id
    where u.id = p_user_id;
end;
$$;
revoke execute on function public.set_account_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_account_status(uuid, boolean, text) to authenticated;

-- =====================================================================================
-- 2) set_community_member_ban -- superadmin OU dono da comunidade. Vigente: 20261022000001.
-- =====================================================================================
create or replace function public.set_community_member_ban(p_community_id uuid, p_target_user_id uuid, p_banned boolean, p_reason text default null)
returns void
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
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;

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
revoke execute on function public.set_community_member_ban(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.set_community_member_ban(uuid, uuid, boolean, text) to authenticated;

-- =====================================================================================
-- 3) suspend_professional_listing -- superadmin only. Vigente: 20260929000005.
-- =====================================================================================
create or replace function public.suspend_professional_listing(p_listing_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'REASON_REQUIRED'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state = 'suspended' then
    return jsonb_build_object('listingId', p_listing_id, 'state', 'suspended', 'revokedAvatarPath', null);
  end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.published_professional_listings where listing_id = p_listing_id;
  update public.professional_listings set
    lifecycle_state = 'suspended', suspended_reason = trim(p_reason), suspended_by = auth.uid(), updated_at = now()
    where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'suspended', 'revokedAvatarPath', v_avatar_path);
end;
$$;
revoke execute on function public.suspend_professional_listing(uuid, text) from public, anon;
grant execute on function public.suspend_professional_listing(uuid, text) to authenticated;

-- =====================================================================================
-- 4) admin_reactivate_professional_listing -- superadmin only. Vigente: 20261003000001.
-- =====================================================================================
create or replace function public.admin_reactivate_professional_listing(p_listing_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_listing public.professional_listings;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state <> 'suspended' then raise exception 'LISTING_NOT_SUSPENDED'; end if;

  update public.professional_listings set
    lifecycle_state = 'draft', suspended_reason = null, suspended_by = null, updated_at = now()
    where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'draft');
end;
$$;
revoke execute on function public.admin_reactivate_professional_listing(uuid) from public, anon;
grant execute on function public.admin_reactivate_professional_listing(uuid) to authenticated;

-- =====================================================================================
-- 5) admin_request_account_deletion -- superadmin only. Vigente: 20261103000001.
-- =====================================================================================
create or replace function public.admin_request_account_deletion(p_user_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existed boolean;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500 then
    raise exception 'INVALID_REASON';
  end if;

  -- Serialize repeated requests through this audited wrapper, including absent jobs.
  perform pg_advisory_xact_lock(hashtextextended('admin-account-deletion:' || p_user_id::text, 0));
  v_existed := exists (
    select 1 from public.deletion_jobs where kind = 'account' and target_id = p_user_id and state <> 'cancelled'
  );
  perform public.queue_deletion('account', p_user_id);

  if not v_existed then
    insert into public.admin_audit_log (admin_user_id, target_user_id, action, reason, metadata)
    values (
      auth.uid(), p_user_id, 'account_deletion_requested', trim(p_reason),
      (select jsonb_build_object('protocol', j.protocol, 'previous_status', j.previous_account_status)
         from public.deletion_jobs j where j.kind = 'account' and j.target_id = p_user_id)
    );
  end if;
end;
$$;
revoke execute on function public.admin_request_account_deletion(uuid, text) from public, anon;
grant execute on function public.admin_request_account_deletion(uuid, text) to authenticated;
