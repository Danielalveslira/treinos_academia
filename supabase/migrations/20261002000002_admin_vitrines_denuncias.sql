-- Admin de Vitrines + denúncias estruturadas.
--
-- Diagnóstico prévio (docs/prompts) confirmou: não existe tela admin pra listar/agir sobre
-- professional_listings; suspend_professional_listing existe mas não tem UI; o listingId
-- digitado em /atendimento é descartado no submit (nunca chega em support_requests); e os 3
-- `kind` do canal (report/appeal/privacy) são assunto do atendimento, não categoria de
-- denúncia -- não dá pra saber se é golpe, spam, imagem indevida etc.
--
-- Esta migration:
--   1) dá a support_requests uma forma de guardar QUAL vitrine foi denunciada (listing_id)
--      e uma cópia (nunca mais atualizada depois do envio -- mesmo papel de
--      content_snapshot pra denúncia de post) de quem era o titular/kind no momento, pra
--      sobreviver mesmo se a vitrine for apagada depois (on delete set null, mesmo reparo
--      já feito pra status_id em 20260926000020_support_requests_status_fk.sql);
--   2) adiciona `category`, obrigatória só quando kind='report' (reforçada dentro de
--      submit_support_request, não por um check de tabela -- um check de tabela quebraria
--      a migration se já existir denúncia antiga sem categoria);
--   3) ensina decide_support_request uma nova ação, suspend_listing, que chama
--      suspend_professional_listing (não duplica a lógica de suspensão -- só liga o fio que
--      faltava entre "decisão de denúncia" e "efeito real na vitrine");
--   4) estende moderation_decisions com listing_id (mesmo modelo de auditoria, não um
--      paralelo) pra dar histórico por vitrine;
--   5) libera unpublish_professional_listing pro superadmin também, sem duplicar a RPC;
--   6) 3 RPCs novas de admin (list/get/reactivate) e 1 pra listar denúncias com contexto de
--      vitrine já resolvido em lote (nunca uma chamada por linha).

-- 1) support_requests: vínculo com a vitrine denunciada + categoria da denúncia.
alter table public.support_requests
  add column if not exists listing_id uuid references public.professional_listings(id) on delete set null,
  add column if not exists listing_owner_id uuid references public.users(id) on delete set null,
  add column if not exists listing_kind text check (listing_kind is null or listing_kind in ('professional', 'space')),
  add column if not exists category text;

alter table public.support_requests drop constraint if exists support_requests_category_chk;
alter table public.support_requests add constraint support_requests_category_chk check (
  category is null or category in (
    'false_information', 'image_or_identity_misuse', 'fraud_or_scam', 'inappropriate_behavior',
    'prohibited_content', 'professional_issue', 'establishment_issue', 'spam', 'other'
  )
);

create index if not exists support_requests_listing_id_idx
  on public.support_requests(listing_id) where listing_id is not null;

-- 2) submit_support_request: resolve listing_id -> owner/kind pelo próprio banco (nunca
-- aceita owner_id do cliente), recusa vitrine inexistente/própria/de admin, exige
-- categoria quando kind='report'. Mesma assinatura/retorno de 20260926000033 (sem drop).
create or replace function public.submit_support_request(payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_kind text := payload->>'kind';
  v_message text := trim(coalesce(payload->>'message', ''));
  v_status_id uuid := nullif(payload->>'statusId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_decision_id uuid := nullif(payload->>'decisionId', '')::uuid;
  v_listing_id uuid := nullif(payload->>'listingId', '')::uuid;
  v_category text := nullif(payload->>'category', '');
  v_last_request timestamptz;
  v_status record;
  v_listing public.professional_listings;
  v_author_role text;
  v_snapshot jsonb;
  v_request_id uuid;
  v_source_photo_path text;
  v_listing_owner_id uuid;
  v_listing_kind text;
begin
  if v_kind not in ('report', 'appeal', 'privacy') then
    raise exception 'INVALID_KIND';
  end if;
  if char_length(v_message) < 10 or char_length(payload->>'message') > 3000 then
    raise exception 'INVALID_MESSAGE';
  end if;
  if (select account_status from public.users where id = auth.uid()) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;
  if v_kind = 'report' and (v_category is null or v_category not in (
    'false_information', 'image_or_identity_misuse', 'fraud_or_scam', 'inappropriate_behavior',
    'prohibited_content', 'professional_issue', 'establishment_issue', 'spam', 'other'
  )) then
    raise exception 'INVALID_CATEGORY';
  end if;

  select last_request_at into v_last_request from public.support_limits where user_id = auth.uid();
  if v_last_request is not null and now() - v_last_request < interval '60 seconds' then
    raise exception 'RATE_LIMITED';
  end if;

  if v_status_id is not null and v_kind = 'report' then
    select * into v_status from public.statuses where id = v_status_id;
    if v_status is null then
      raise exception 'STATUS_NOT_FOUND';
    end if;
    v_community_id := v_status.community_id;
    if not exists (
      select 1 from public.community_members
      where community_id = v_community_id and user_id = auth.uid()
    ) then
      raise exception 'PERMISSION_DENIED';
    end if;
    if v_status.author_id = auth.uid() then
      raise exception 'CANNOT_REPORT_SELF';
    end if;
    select role into v_author_role from public.users where id = v_status.author_id;
    if v_author_role in ('admin', 'superadmin') then
      raise exception 'PROTECTED_AUTHOR';
    end if;
    v_snapshot := to_jsonb(v_status);
    if v_status.type = 'photo' then
      v_source_photo_path := v_status.photo_path;
    end if;
  end if;

  -- Denúncia de vitrine: o cliente só manda o id. Dono/kind vêm do próprio banco, nunca
  -- do payload -- evita um cliente forjar a quem a denúncia aponta.
  if v_listing_id is not null and v_kind = 'report' then
    select * into v_listing from public.professional_listings where id = v_listing_id;
    if v_listing is null then
      raise exception 'LISTING_NOT_FOUND';
    end if;
    if v_listing.owner_id = auth.uid() then
      raise exception 'CANNOT_REPORT_SELF';
    end if;
    select role into v_author_role from public.users where id = v_listing.owner_id;
    if v_author_role in ('admin', 'superadmin') then
      raise exception 'PROTECTED_AUTHOR';
    end if;
    v_listing_owner_id := v_listing.owner_id;
    v_listing_kind := v_listing.kind;
  end if;

  if v_kind = 'appeal' then
    if v_decision_id is null or not exists (
      select 1 from public.moderation_decisions where id = v_decision_id and target_user_id = auth.uid()
    ) then
      raise exception 'DECISION_NOT_FOUND';
    end if;
  end if;

  insert into public.support_requests (
    user_id, kind, message, status_id, community_id, decision_id,
    listing_id, listing_owner_id, listing_kind, category, content_snapshot, state
  )
  values (
    auth.uid(), v_kind, v_message,
    case when v_kind = 'report' then v_status_id else null end,
    v_community_id,
    case when v_kind = 'appeal' then v_decision_id else null end,
    case when v_kind = 'report' then v_listing_id else null end,
    case when v_kind = 'report' then v_listing_owner_id else null end,
    case when v_kind = 'report' then v_listing_kind else null end,
    case when v_kind = 'report' then v_category else null end,
    v_snapshot, 'open'
  )
  returning id into v_request_id;

  insert into public.support_limits (user_id, last_request_at) values (auth.uid(), now())
    on conflict (user_id) do update set last_request_at = now();

  return jsonb_build_object('id', v_request_id, 'sourcePhotoPath', v_source_photo_path);
end;
$$;

-- 3) decide_support_request ganha a ação suspend_listing (chama suspend_professional_listing
-- -- não duplica a lógica de suspensão) e passa a aceitar listing_id como alvo.
alter table public.moderation_decisions drop constraint if exists moderation_decisions_action_check;
alter table public.moderation_decisions add constraint moderation_decisions_action_check check (
  action in (
    'no_action', 'warning', 'remove_content', 'suspend_listing',
    'temporary_suspension', 'community_ban', 'system_ban', 'restore'
  )
);
alter table public.moderation_decisions
  add column if not exists listing_id uuid references public.professional_listings(id) on delete set null;

create or replace function public.decide_support_request(payload jsonb) returns uuid
  language plpgsql security definer set search_path = public as $$
declare
  v_request_id uuid := (payload->>'requestId')::uuid;
  v_action text := payload->>'action';
  v_reason text := trim(coalesce(payload->>'reason', ''));
  v_rule text := trim(coalesce(payload->>'rule', ''));
  v_evidence text := trim(coalesce(payload->>'evidence', ''));
  v_target_user_id uuid := nullif(payload->>'targetUserId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_days int := (payload->>'days')::int;
  v_request record;
  v_target_role text;
  v_until timestamptz;
  v_decision_id uuid;
begin
  if not public.is_superadmin() then
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

  select * into v_request from public.support_requests where id = v_request_id;
  if v_request is null or v_request.state <> 'open' then
    raise exception 'NOT_FOUND_OR_CLOSED';
  end if;
  if not (v_request.kind in ('report', 'appeal')) and v_action <> 'no_action' then
    raise exception 'PRIVACY_NO_ACTION';
  end if;

  if v_action = 'suspend_listing' then
    -- Alvo é a vitrine, não um usuário informado à mão -- sempre o dono real, resolvido
    -- no momento da denúncia (listing_owner_id), nunca o que vier (ou não) no payload.
    v_target_user_id := v_request.listing_owner_id;
  end if;

  if v_target_user_id is not null then
    select role into v_target_role from public.users where id = v_target_user_id;
    if v_target_role is null or v_target_role in ('admin', 'superadmin') or v_target_user_id = auth.uid() then
      raise exception 'INVALID_TARGET';
    end if;
  end if;
  if v_action = 'community_ban' and v_community_id is distinct from v_request.community_id then
    raise exception 'COMMUNITY_MISMATCH';
  end if;
  if v_action = 'remove_content' and v_request.status_id is null then
    raise exception 'NO_STATUS';
  end if;
  if v_action = 'suspend_listing' and v_request.listing_id is null then
    raise exception 'NO_LISTING';
  end if;
  if v_action = 'temporary_suspension' and (v_days is null or v_days < 1 or v_days > 30) then
    raise exception 'INVALID_DAYS';
  end if;

  v_until := case when v_action = 'temporary_suspension' then now() + (v_days || ' days')::interval else null end;

  insert into public.moderation_decisions (
    request_id, admin_id, target_user_id, action, community_id, listing_id, rule, reason, evidence, until
  )
  values (
    v_request_id, auth.uid(), v_target_user_id, v_action, v_community_id,
    case when v_action = 'suspend_listing' then v_request.listing_id else null end,
    v_rule, v_reason, v_evidence, v_until
  )
  returning id into v_decision_id;

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
    on conflict (user_id) do update set action = excluded.action, until = excluded.until, decision_id = excluded.decision_id;
  end if;

  if v_action = 'community_ban' then
    insert into public.community_restrictions (community_id, user_id, decision_id)
    values (v_community_id, v_target_user_id, v_decision_id)
    on conflict (community_id, user_id) do update set decision_id = excluded.decision_id;
  end if;

  if v_action = 'restore' then
    if v_community_id is not null then
      delete from public.community_restrictions where community_id = v_community_id and user_id = v_target_user_id;
    else
      delete from public.account_restrictions where user_id = v_target_user_id;
    end if;
  end if;

  if v_action = 'remove_content' then
    delete from public.statuses where id = v_request.status_id;
  end if;

  if v_action = 'suspend_listing' then
    perform public.suspend_professional_listing(v_request.listing_id, v_reason);
  end if;

  return v_decision_id;
end;
$$;

-- 4) unpublish_professional_listing liberada pro superadmin também -- "despublicar"
-- administrativo reaproveita a MESMA RPC (sem duplicar a lógica de arquivar + revogar o
-- avatar publicado), só a checagem de titularidade ganha a alternativa is_superadmin().
create or replace function public.unpublish_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_listing public.professional_listings;
  v_avatar_path text;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing is null or (v_listing.owner_id <> v_uid and not public.is_superadmin()) then
    raise exception 'LISTING_NOT_FOUND';
  end if;
  if v_listing.lifecycle_state in ('suspended', 'deleting') then raise exception 'LISTING_NOT_EDITABLE'; end if;

  select avatar_path into v_avatar_path from public.published_professional_listings where listing_id = p_listing_id;
  delete from public.published_professional_listings where listing_id = p_listing_id;
  update public.professional_listings set lifecycle_state = 'archived', updated_at = now() where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'archived', 'revokedAvatarPath', v_avatar_path);
end;
$$;

-- 5) Admin de Vitrines: listar (busca + paginação por cursor, mesmo padrão de
-- admin_list_accounts), ver detalhe, e reativar (suspensa -> rascunho, pra passar de novo
-- pelo fluxo normal de publicação -- nunca republica direto, ver nota de segurança abaixo).
create or replace function public.admin_list_professional_listings(
  p_search text default '', p_lifecycle_state text default '', p_cursor uuid default null, p_page_size int default 50
) returns table (
  id uuid, owner_id uuid, owner_username text, owner_email text, kind text,
  lifecycle_state text, display_name text, published_version integer,
  suspended_reason text, suspended_by uuid, created_at timestamptz, updated_at timestamptz
)
  language plpgsql stable security definer set search_path = public as $$
declare
  v_term text := trim(coalesce(p_search, ''));
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_page_size < 1 or p_page_size > 50 then
    raise exception 'INVALID_ARGUMENT';
  end if;
  if p_lifecycle_state <> '' and p_lifecycle_state not in ('draft', 'published', 'archived', 'suspended', 'deleting') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  return query
    select pl.id, pl.owner_id, u.username, au.email::text, pl.kind, pl.lifecycle_state,
           d.display_name, pl.published_version, pl.suspended_reason, pl.suspended_by,
           pl.created_at, pl.updated_at
    from public.professional_listings pl
    join public.professional_listing_drafts d on d.listing_id = pl.id
    join public.users u on u.id = pl.owner_id
    join auth.users au on au.id = pl.owner_id
    where (p_lifecycle_state = '' or pl.lifecycle_state = p_lifecycle_state)
      and (
        v_term = ''
        or d.display_name ilike '%' || v_term || '%'
        or u.username ilike '%' || v_term || '%'
        or au.email ilike '%' || v_term || '%'
      )
      and (p_cursor is null or pl.id > p_cursor)
    order by pl.id
    limit p_page_size;
end;
$$;

create or replace function public.admin_get_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_listing public.professional_listings;
  v_draft public.professional_listing_drafts;
  v_published public.published_professional_listings;
  v_owner_username text;
  v_owner_email text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id;
  if v_listing.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  select * into v_draft from public.professional_listing_drafts where listing_id = p_listing_id;
  select * into v_published from public.published_professional_listings where listing_id = p_listing_id;
  select u.username, au.email into v_owner_username, v_owner_email
    from public.users u join auth.users au on au.id = u.id where u.id = v_listing.owner_id;

  return jsonb_build_object(
    'listing', public._to_json_listing(v_listing),
    'ownerUsername', v_owner_username,
    'ownerEmail', v_owner_email,
    'draft', case when v_draft.listing_id is null then null else public._to_json_draft(v_draft) end,
    'published', case when v_published.listing_id is null then null else public._to_json_published(v_published) end
  );
end;
$$;

-- Reativar só desfaz a suspensão (volta pra 'draft'): o titular então edita/publica de
-- novo pelo fluxo normal (prepare/finalize), com toda a validação de sempre. Republicar
-- direto sem passar por ali reintroduziria o mesmo risco que o publish em 2 fases existe
-- pra evitar (avatar/dados desatualizados, sem revalidação).
create or replace function public.admin_reactivate_professional_listing(p_listing_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_listing public.professional_listings;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  select * into v_listing from public.professional_listings where id = p_listing_id for update;
  if v_listing.id is null then raise exception 'LISTING_NOT_FOUND'; end if;
  if v_listing.lifecycle_state <> 'suspended' then raise exception 'LISTING_NOT_SUSPENDED'; end if;

  update public.professional_listings set
    lifecycle_state = 'draft', suspended_reason = null, suspended_by = null, updated_at = now()
    where id = p_listing_id;

  return jsonb_build_object('listingId', p_listing_id, 'state', 'draft');
end;
$$;

-- 6) Lista de denúncias pro admin, com contexto de vitrine (nome atual, estado atual) já
-- resolvido num único join -- nunca uma chamada por linha. owner/kind da vitrine vêm do
-- snapshot em support_requests (listing_owner_id/listing_kind), não deste join, porque
-- sobrevivem mesmo se a vitrine for apagada depois (listing_id vira null nesse caso).
-- p_listing_id filtra pra "denúncias vinculadas a esta vitrine" (tela de detalhe do admin).
create or replace function public.admin_list_support_requests(
  p_state text default '', p_listing_id uuid default null, p_cursor timestamptz default null, p_page_size int default 25
) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  v_page_size integer := least(greatest(coalesce(p_page_size, 25), 1), 50);
  v_rows jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_state <> '' and p_state not in ('open', 'closed') then
    raise exception 'INVALID_ARGUMENT';
  end if;

  select coalesce(jsonb_agg(sub.obj order by sub.created_at desc), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', sr.id, 'userId', sr.user_id, 'kind', sr.kind, 'message', sr.message,
      'statusId', sr.status_id, 'communityId', sr.community_id, 'decisionId', sr.decision_id,
      'category', sr.category, 'listingId', sr.listing_id, 'listingOwnerId', sr.listing_owner_id,
      'listingKind', sr.listing_kind, 'listingDisplayName', d.display_name,
      'listingLifecycleState', pl.lifecycle_state,
      'contentSnapshot', sr.content_snapshot, 'state', sr.state, 'createdAt', sr.created_at,
      'response', sr.response, 'decidedAt', sr.decided_at, 'evidencePath', sr.evidence_path
    ) as obj, sr.created_at
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
    'nextCursor', case when jsonb_array_length(v_rows) = v_page_size
      then v_rows->(jsonb_array_length(v_rows) - 1)->>'createdAt' else null end
  );
end;
$$;
