-- PROMPT final de conclusão do logout global, Etapa 3: recálculo do inventário mostrou que as 8
-- leituras administrativas (admin_accounts_snapshot, admin_list_accounts, admin_list_audit_log,
-- admin_account_communities, admin_account_financial, admin_list_support_requests,
-- admin_push_job_trace, list_community_restrictions) já chamam public.is_superadmin() -- ficam
-- automaticamente protegidas quando 20261114000001 (que embute private.current_session_active()
-- em is_superadmin()) for aplicada, sem precisar de nenhuma mudança aqui.
--
-- Os dois gaps reais que restavam (nem admin, nem financeiro, por isso fora do escopo anterior,
-- mas "operação sensível" de qualquer forma -- exclusão é irreversível e comment_delete também
-- cobre a ação de MODERADOR, não só a do próprio autor):
--   - private.comment_delete: implementação real de public.comment_delete (wrapper de 1 linha).
--   - public.delete_professional_listing: exclusão definitiva, pelo próprio titular.
-- Raio de impacto: só estas duas funções. Não toca has_app_access()/is_superadmin() (já cobertos
-- por 20261114000001) nem nenhuma RPC financeira.
set local lock_timeout = '5s';

create or replace function private.comment_delete(p_comment_id uuid) returns public.post_comments
  language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_comment public.post_comments;
  v_moderator boolean;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;
  select * into v_comment from public.post_comments where id = p_comment_id for update;
  if not found then raise exception 'COMMENT_NOT_FOUND'; end if;
  v_moderator := private.can_moderate_status(v_comment.status_id, v_uid);
  if v_comment.author_id is distinct from v_uid and not v_moderator then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_comment.status <> 'active' then return v_comment; end if;

  update public.post_comments
  set body = null,
      status = case when v_moderator and v_comment.author_id is distinct from v_uid
                    then 'removed_by_moderation'::public.comment_status
                    else 'deleted_by_author'::public.comment_status end,
      deleted_at = now(),
      updated_at = now()
  where id = p_comment_id
  returning * into v_comment;
  return v_comment;
end;
$$;

create or replace function public.delete_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(private.current_session_active(), false) then raise exception 'SESSION_REVOKED'; end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or v_listing.owner_id <> v_uid then raise exception 'LISTING_NOT_FOUND'; end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.professional_listings where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'deleted', true, 'revokedAvatarPath', v_avatar_path);
end;
$$;
revoke execute on function public.delete_professional_listing(uuid) from public, anon;
grant execute on function public.delete_professional_listing(uuid) to authenticated;
