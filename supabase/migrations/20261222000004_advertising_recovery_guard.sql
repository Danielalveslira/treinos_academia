-- A self-owned legacy `suspend` is ambiguous: the same RPC also served the admin console.
-- The common advertiser button used this exact reason. Require both pieces of evidence;
-- all other legacy suspensions stay under administrative review.
begin;
set local lock_timeout = '5s';
create index if not exists advertising_suspension_latest_idx
  on public.advertising_operations(resource_id, id desc)
  where action in ('suspend', 'admin_suspend', 'suspend_pause_limit');

create or replace function private.advertising_suspension_origin(p_id uuid, p_account_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case o.action
    when 'suspend_pause_limit' then 'pause_limit'
    when 'admin_suspend' then 'admin'
    when 'suspend' then case
      when o.reason = 'Interrupção solicitada pelo anunciante' and exists (
        select 1 from public.advertiser_accounts a where a.id = p_account_id and
          (a.owner_user_id = o.actor_user_id or exists (
            select 1 from public.advertiser_members m
            where m.account_id = a.id and m.user_id = o.actor_user_id
          ))
      ) then 'legacy_voluntary'
      else 'unknown'
    end
    else 'unknown'
  end
  from (select action, actor_user_id, reason from public.advertising_operations
    where resource_id = p_id and action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
    order by id desc limit 1) o
$$;

-- Recovery reconstructs the voluntary PAUSE. It must not silently make a previously hidden
-- ad visible. The advertiser can explicitly resume for the remaining contracted period.
create or replace function public.admin_recover_advertising_voluntary_suspension(p_id uuid, p_expected_revision bigint) returns private.commercial_resources
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_uid uuid := auth.uid(); r private.commercial_resources; d private.advertising_drafts;
  e public.visibility_entitlements; o public.advertising_operations;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  perform private.require_evocash_admin(true);
  select * into r from private.commercial_resources where id = p_id for update;
  select * into d from private.advertising_drafts where ad_id = p_id;
  if not found or r.id is null then raise exception 'AD_NOT_FOUND'; end if;
  if r.content_revision is distinct from p_expected_revision then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state <> 'suspended' then raise exception 'AD_NOT_SUSPENDED'; end if;
  if private.advertising_suspension_origin(p_id, d.account_id) is distinct from 'legacy_voluntary'
    or r.advertiser_paused_at is not null then raise exception 'AD_RECOVERY_NOT_ELIGIBLE'; end if;
  select * into o from public.advertising_operations
    where resource_id = p_id and action = 'suspend' order by id desc limit 1;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled' or e.starts_at > statement_timestamp()
    or e.expires_at <= statement_timestamp() or r.approved_revision is distinct from r.content_revision
    or d.approved_version is distinct from r.content_revision then
    raise exception 'AD_RECOVERY_NOT_ELIGIBLE';
  end if;
  update private.commercial_resources set moderation_state = 'approved',
    advertiser_paused_at = o.occurred_at, advertiser_paused_by = o.actor_user_id,
    advertiser_pause_count = case when advertiser_pause_period_start is distinct from e.starts_at
      then 1 else least(3, advertiser_pause_count + 1) end,
    advertiser_pause_period_start = e.starts_at
    where id = p_id returning * into r;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (v_uid, p_id, 'advertising_suspension_recovered',
      'Pausa voluntária reconstruída da operação ' || o.id::text || '; revisão ' || p_expected_revision::text);
  return r;
end $$;
commit;
