-- Convergência de decide_support_request e admin_list_support_requests (replay do zero == produção).
--
-- Problema: 20261002000006_comments_moderation redefine as duas funções com suporte a moderação de COMENTÁRIOS
-- (support_requests.comment_id, soft delete em post_comments, 'commentId' na listagem admin). Mas
-- 20261003000001_reapply_admin_vitrines_denuncias (que reaplica a migration da Vitrine que falhou em produção)
-- redefine as MESMAS funções, só com a Vitrine -- e, num banco criado do zero (CI/ambiente novo), roda DEPOIS e
-- apaga o comportamento de comentários (2 asserções de comments_system_test quebram). Em produção a ordem de
-- aplicação foi a inversa (os comentários foram aplicados por último), por isso lá nunca falhou.
--
-- Correção: esta migration reaplica, VERBATIM, a versão final combinada que já é a de produção -- a de
-- 20261002000006, que é um superconjunto da Vitrine (listing_id, suspend_listing, listing_owner_id, categoria)
-- mais comentários. Em produção é um no-op (mesmas definições); no replay do zero devolve a moderação de
-- comentários. Mesmas assinaturas e mesmo `create or replace` (grants existentes preservados); nenhuma outra
-- função é tocada e as migrations antigas não são editadas.

-- Integrate comment reports with the existing support/moderation workflow.

create or replace function public.decide_support_request(payload jsonb) returns uuid
  language plpgsql security definer set search_path = '' as $$
declare
  v_request_id uuid := (payload->>'requestId')::uuid;
  v_action text := payload->>'action';
  v_reason text := btrim(coalesce(payload->>'reason', ''));
  v_rule text := btrim(coalesce(payload->>'rule', ''));
  v_evidence text := btrim(coalesce(payload->>'evidence', ''));
  v_target_user_id uuid := nullif(payload->>'targetUserId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_days int := (payload->>'days')::int;
  v_request public.support_requests;
  v_target_role text;
  v_until timestamptz;
  v_decision_id uuid;
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_action not in (
    'no_action', 'warning', 'remove_content', 'suspend_listing',
    'temporary_suspension', 'community_ban', 'system_ban', 'restore'
  ) then
    raise exception 'INVALID_ACTION';
  end if;
  if char_length(v_reason) < 5 or char_length(v_rule) < 5 or char_length(v_evidence) < 5 then
    raise exception 'INVALID_FIELDS';
  end if;

  select * into v_request
  from public.support_requests
  where id = v_request_id
  for update;
  if v_request is null or v_request.state <> 'open' then
    raise exception 'NOT_FOUND_OR_CLOSED';
  end if;
  if not (v_request.kind in ('report', 'appeal')) and v_action <> 'no_action' then
    raise exception 'PRIVACY_NO_ACTION';
  end if;

  if v_request.comment_id is not null then
    select author_id into v_target_user_id
    from public.post_comments
    where id = v_request.comment_id;
    if not found then raise exception 'NO_COMMENT'; end if;
  elsif v_action = 'suspend_listing' then
    v_target_user_id := v_request.listing_owner_id;
  end if;

  if v_target_user_id is not null then
    select role into v_target_role from public.users where id = v_target_user_id;
    if v_target_role is null or v_target_role in ('admin', 'superadmin') or v_target_user_id = (select auth.uid()) then
      raise exception 'INVALID_TARGET';
    end if;
  end if;
  if v_action = 'community_ban' and v_community_id is distinct from v_request.community_id then
    raise exception 'COMMUNITY_MISMATCH';
  end if;
  if v_action = 'remove_content' and v_request.status_id is null and v_request.comment_id is null then
    raise exception 'NO_CONTENT';
  end if;
  if v_action = 'suspend_listing' and v_request.listing_id is null then
    raise exception 'NO_LISTING';
  end if;
  if v_action = 'temporary_suspension' and (v_days is null or v_days < 1 or v_days > 30) then
    raise exception 'INVALID_DAYS';
  end if;

  v_until := case
    when v_action = 'temporary_suspension' then now() + (v_days || ' days')::interval
    else null
  end;

  insert into public.moderation_decisions (
    request_id, admin_id, target_user_id, action, community_id, listing_id,
    rule, reason, evidence, until
  ) values (
    v_request_id, (select auth.uid()), v_target_user_id, v_action, v_community_id,
    case when v_action = 'suspend_listing' then v_request.listing_id else null end,
    v_rule, v_reason, v_evidence, v_until
  ) returning id into v_decision_id;

  update public.support_requests
  set state = 'closed', response = v_reason, decision_id = v_decision_id, decided_at = now()
  where id = v_request_id;

  if v_target_user_id is not null and v_action <> 'suspend_listing' then
    insert into public.notices (user_id, action, rule, reason, community_id, until)
    values (v_target_user_id, v_action, v_rule, v_reason, v_community_id, v_until);
  end if;

  if v_action in ('temporary_suspension', 'system_ban') then
    insert into public.account_restrictions (user_id, action, until, decision_id)
    values (v_target_user_id, v_action, v_until, v_decision_id)
    on conflict (user_id) do update set
      action = excluded.action,
      until = excluded.until,
      decision_id = excluded.decision_id;
  end if;

  if v_action = 'community_ban' then
    insert into public.community_restrictions (community_id, user_id, decision_id)
    values (v_community_id, v_target_user_id, v_decision_id)
    on conflict (community_id, user_id) do update set decision_id = excluded.decision_id;
  end if;

  if v_action = 'restore' then
    if v_community_id is not null then
      delete from public.community_restrictions
      where community_id = v_community_id and user_id = v_target_user_id;
    else
      delete from public.account_restrictions where user_id = v_target_user_id;
    end if;
  end if;

  if v_action = 'remove_content' then
    if v_request.comment_id is not null then
      update public.post_comments
      set body = null,
          status = 'removed_by_moderation',
          deleted_at = coalesce(deleted_at, now()),
          updated_at = now()
      where id = v_request.comment_id and status = 'active';
    else
      delete from public.statuses where id = v_request.status_id;
    end if;
  end if;

  if v_action = 'suspend_listing' then
    perform public.suspend_professional_listing(v_request.listing_id, v_reason);
  end if;

  return v_decision_id;
end;
$$;

create or replace function public.admin_list_support_requests(
  p_state text default '',
  p_listing_id uuid default null,
  p_cursor timestamptz default null,
  p_page_size int default 25
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  v_rows jsonb;
begin
  if not coalesce(public.is_superadmin(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_state <> '' and p_state not in ('open', 'closed') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select coalesce(jsonb_agg(sub.obj order by sub.created_at desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'id', sr.id,
      'userId', sr.user_id,
      'kind', sr.kind,
      'message', sr.message,
      'statusId', sr.status_id,
      'commentId', sr.comment_id,
      'communityId', sr.community_id,
      'decisionId', sr.decision_id,
      'category', sr.category,
      'listingId', sr.listing_id,
      'listingOwnerId', sr.listing_owner_id,
      'listingKind', sr.listing_kind,
      'listingDisplayName', d.display_name,
      'listingLifecycleState', pl.lifecycle_state,
      'contentSnapshot', sr.content_snapshot,
      'state', sr.state,
      'createdAt', sr.created_at,
      'response', sr.response,
      'decidedAt', sr.decided_at,
      'evidencePath', sr.evidence_path
    ) as obj,
    sr.created_at
    from public.support_requests sr
    left join public.professional_listings pl on pl.id = sr.listing_id
    left join public.professional_listing_drafts d on d.listing_id = sr.listing_id
    where (p_state = '' or sr.state = p_state)
      and (p_listing_id is null or sr.listing_id = p_listing_id)
      and (p_cursor is null or sr.created_at < p_cursor)
    order by sr.created_at desc
    limit v_page_size
  ) sub;

  return jsonb_build_object(
    'items', v_rows,
    'nextCursor', case
      when jsonb_array_length(v_rows) = v_page_size
        then v_rows->(jsonb_array_length(v_rows) - 1)->>'createdAt'
      else null
    end
  );
end;
$$;

notify pgrst, 'reload schema';
