-- submit_support_request agora devolve também o photo_path original (quando a
-- denúncia é de uma publicação do tipo foto), pra camada JS decidir se precisa copiar
-- a evidência (ver record_support_evidence / getModerationEvidenceBlob no client).
-- Muda o tipo de retorno (uuid -> jsonb), então precisa dropar antes de recriar.
drop function if exists public.submit_support_request(jsonb);
create or replace function public.submit_support_request(payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_kind text := payload->>'kind';
  v_message text := trim(coalesce(payload->>'message', ''));
  v_status_id uuid := nullif(payload->>'statusId', '')::uuid;
  v_community_id uuid := nullif(payload->>'communityId', '')::uuid;
  v_decision_id uuid := nullif(payload->>'decisionId', '')::uuid;
  v_last_request timestamptz;
  v_status record;
  v_author_role text;
  v_snapshot jsonb;
  v_request_id uuid;
  v_source_photo_path text;
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

  if v_kind = 'appeal' then
    if v_decision_id is null or not exists (
      select 1 from public.moderation_decisions where id = v_decision_id and target_user_id = auth.uid()
    ) then
      raise exception 'DECISION_NOT_FOUND';
    end if;
  end if;

  insert into public.support_requests (user_id, kind, message, status_id, community_id, decision_id, content_snapshot, state)
  values (
    auth.uid(), v_kind, v_message,
    case when v_kind = 'report' then v_status_id else null end,
    v_community_id,
    case when v_kind = 'appeal' then v_decision_id else null end,
    v_snapshot, 'open'
  )
  returning id into v_request_id;

  insert into public.support_limits (user_id, last_request_at) values (auth.uid(), now())
    on conflict (user_id) do update set last_request_at = now();

  return jsonb_build_object('id', v_request_id, 'sourcePhotoPath', v_source_photo_path);
end;
$$;
