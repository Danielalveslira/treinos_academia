-- A normal pause never authorizes a limit suspension. Old clients retain their RPC and
-- receive an actionable business error. Confirmation is a separate, state-bound RPC.
set local lock_timeout = '5s';
create index if not exists advertising_operations_resource_latest_idx
  on public.advertising_operations(resource_id, id desc);

create function private.valid_advertising_resource(p_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from private.commercial_resources r
    join private.advertising_drafts d on d.ad_id = r.id
    join public.sponsored_ads a on a.id = d.ad_id and a.commercial_resource_id = r.id
    join public.advertiser_accounts ac on ac.id = d.account_id and ac.owner_user_id = r.owner_user_id
    where r.id = p_id and r.offering_code in
      ('ad_home', 'ad_community', 'ad_community_banner', 'ad_progress', 'ad_network')
  )
$$;
revoke all on function private.valid_advertising_resource(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.interrupt_advertising_campaign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
  v_count smallint;
begin
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  if r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
  select * into d from private.advertising_drafts where ad_id = p_id;
  perform private.require_advertising_editor(d.account_id);
  if r.moderation_state = 'suspended' then return; end if;
  if r.moderation_state <> 'approved' or r.approved_revision is null
    or r.approved_revision <> r.content_revision or d.approved_version <> r.approved_revision
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if r.advertiser_paused_at is not null then return; end if;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled'
    or e.starts_at > statement_timestamp() or e.expires_at <= statement_timestamp()
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  v_count := case when r.advertiser_pause_period_start is distinct from e.starts_at
    then 0 else r.advertiser_pause_count end;
  if v_count >= 3 then raise exception 'AD_PAUSE_LIMIT_CONFIRM_REQUIRED'; end if;
  update private.commercial_resources set advertiser_paused_at = clock_timestamp(),
    advertiser_paused_by = auth.uid(), advertiser_pause_count = v_count + 1,
    advertiser_pause_period_start = e.starts_at where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (auth.uid(), p_id, 'advertiser_pause', btrim(p_reason));
end $$;

create function public.confirm_advertising_pause_limit(
  p_id uuid, p_period_start timestamptz, p_expected_revision bigint,
  p_expected_operation_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare d private.advertising_drafts; r private.commercial_resources;
  e public.visibility_entitlements; latest bigint;
begin
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  if r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
  select * into d from private.advertising_drafts where ad_id = p_id;
  perform private.require_advertising_editor(d.account_id);
  -- An exact retry after a lost response succeeds without creating another operation.
  -- Any later moderation/release changes the latest operation and invalidates the token.
  if r.moderation_state = 'suspended' then
    select id into latest from public.advertising_operations
      where resource_id = p_id order by id desc limit 1;
    if exists (
      select 1 from public.advertising_operations o
      where o.id = latest and o.resource_id = p_id
        and o.action = 'suspend_pause_limit' and o.actor_user_id = auth.uid()
        and (o.payload ->> 'period_start')::timestamptz is not distinct from p_period_start
        and o.payload ->> 'expected_operation_id' = p_expected_operation_id::text
        and o.payload ->> 'expected_revision' = p_expected_revision::text
    ) then return; end if;
  end if;
  if r.moderation_state <> 'approved' or r.advertiser_paused_at is not null
    or r.approved_revision is distinct from p_expected_revision
    or r.content_revision is distinct from p_expected_revision
    or d.approved_version is distinct from p_expected_revision
    or r.advertiser_pause_count <> 3 or r.advertiser_pause_period_start is distinct from p_period_start
  then raise exception 'AD_PAUSE_CONFIRM_STALE'; end if;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled'
    or e.starts_at is distinct from p_period_start
    or e.starts_at > statement_timestamp() or e.expires_at <= statement_timestamp()
  then raise exception 'AD_PAUSE_CONFIRM_STALE'; end if;
  select id into latest from public.advertising_operations
    where resource_id = p_id order by id desc limit 1;
  if latest is distinct from p_expected_operation_id then raise exception 'AD_PAUSE_CONFIRM_STALE'; end if;
  update private.commercial_resources set moderation_state = 'suspended' where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason,
    payload) values (auth.uid(), p_id, 'suspend_pause_limit', btrim(p_reason),
      jsonb_build_object('period_start', e.starts_at, 'expected_operation_id', latest,
        'expected_revision', p_expected_revision));
end $$;
revoke all on function public.confirm_advertising_pause_limit(uuid, timestamptz, bigint, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_advertising_pause_limit(uuid, timestamptz, bigint, bigint, text)
  to authenticated;

create or replace function public.admin_suspend_advertising_campaign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare r private.commercial_resources;
begin
  perform private.require_evocash_admin(true);
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  if r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
  if r.moderation_state = 'archived' then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state = 'suspended' then return; end if;
  update private.commercial_resources set moderation_state = 'suspended' where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (auth.uid(), p_id, 'admin_suspend', btrim(p_reason));
end $$;


create or replace function public.get_advertising_campaigns(p_account uuid default null, p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,
 (select o.id from public.advertising_operations o where o.resource_id=r.id order by o.id desc limit 1) as pause_operation_id,
 (r.advertiser_paused_at is not null) as advertiser_paused,e.starts_at,e.expires_at,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 0 else r.advertiser_pause_count end as pauses_used,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 3 else 3 - r.advertiser_pause_count end as pauses_available,
 case when r.moderation_state = 'suspended'
   then private.advertising_suspension_origin(r.id, d.account_id) else null end as suspension_origin,
 case when r.moderation_state = 'suspended'
   then (select o.reason from public.advertising_operations o
     where o.resource_id = r.id and o.action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
     order by o.id desc limit 1) else null end as suspension_reason,
 case when private.commercial_resource_visible(r.id) then 'active' when e.expires_at<=statement_timestamp() then 'expired' else 'private' end delivery_state,
 greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::bigint remaining_seconds,
 (a.owner_user_id=auth.uid()) as can_pay,
 (select jsonb_agg(jsonb_build_object('code',i.placement_code,'context',i.context_id)) from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placements,
 (select bool_or(private.advertising_eligible(d.ad_id,i.placement_code,i.context_id))
  from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placement_delivery_active,
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 order by d.ad_id desc limit 20)x),'[]'::jsonb);
end $$;


create or replace function public.resume_my_advertising_campaign(p_id uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
begin
 perform private.require_commercial_user();
 select * into r from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id;
 if not found or r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_advertising_editor(d.account_id);
 if r.advertiser_paused_at is null then
  if r.moderation_state='approved' then return; end if;
  raise exception 'AD_RESUME_BLOCKED';
 end if;
 if r.moderation_state<>'approved' or r.approved_revision is null
  or r.approved_revision<>r.content_revision or d.approved_version<>r.approved_revision
  or not exists(select 1 from public.advertiser_accounts a where a.id=d.account_id and a.active and a.owner_user_id=r.owner_user_id)
  or not exists(select 1 from public.users u where u.id=r.owner_user_id and u.account_status='active')
  or exists(select 1 from public.account_restrictions a where a.user_id=r.owner_user_id
   and not (a.action='temporary_suspension' and a.until<=statement_timestamp()))
 then raise exception 'AD_RESUME_BLOCKED'; end if;
 select * into e from public.visibility_entitlements where resource_id=p_id for update;
 if not found or e.administrative_state<>'enabled' or e.starts_at>statement_timestamp()
  or e.expires_at<=statement_timestamp() then raise exception 'AD_RESUME_BLOCKED'; end if;
 if not exists(select 1 from private.advertising_resource_inventory i
  join public.advertising_placements p on p.code=i.placement_code
  where i.resource_id=p_id and p.delivery_enabled
  and (p.surface='home' or exists(select 1 from public.communities c
   where c.id=i.context_id and c.is_active and c.owner_id=r.owner_user_id)))
 then raise exception 'AD_RESUME_PLACEMENT_BLOCKED'; end if;
 update private.commercial_resources set advertiser_paused_at=null,advertiser_paused_by=null where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
  values(auth.uid(),p_id,'advertiser_resume','Retomada solicitada pelo anunciante');
end $$;


create or replace function public.admin_resume_advertising_campaign(p_id uuid,p_revision bigint,p_reason text) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare r private.commercial_resources;
begin
 perform private.require_evocash_admin(true);
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 select * into r from private.commercial_resources where id=p_id for update;
 if r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
 if not found or r.content_revision is distinct from p_revision or r.approved_revision is distinct from p_revision or r.moderation_state<>'suspended' then raise exception 'AD_REVISION_CONFLICT'; end if;
 if not exists(select 1 from private.advertising_drafts where ad_id=p_id and approved_version=p_revision) then raise exception 'AD_NOT_FOUND'; end if;
 update private.commercial_resources set moderation_state='approved' where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),p_id,'resume',btrim(p_reason));
end $$;


create or replace function public.admin_recover_advertising_voluntary_suspension(p_id uuid, p_expected_revision bigint) returns private.commercial_resources
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_uid uuid := auth.uid(); r private.commercial_resources; d private.advertising_drafts;
  e public.visibility_entitlements; o public.advertising_operations;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  perform private.require_evocash_admin(true);
  select * into r from private.commercial_resources where id = p_id for update;
  select * into d from private.advertising_drafts where ad_id = p_id;
  if not found or r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
  if r.content_revision is distinct from p_expected_revision then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state <> 'suspended' then raise exception 'AD_NOT_SUSPENDED'; end if;
  if private.advertising_suspension_origin(p_id, d.account_id) is distinct from 'legacy_voluntary'
    or r.advertiser_paused_at is not null then raise exception 'AD_RECOVERY_NOT_ELIGIBLE'; end if;
  select * into o from public.advertising_operations
    where resource_id = p_id and action = 'suspend' order by id desc limit 1;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled' or e.starts_at > statement_timestamp()
    or e.expires_at <= statement_timestamp() or o.occurred_at < e.starts_at
    or o.occurred_at >= e.expires_at or r.approved_revision is distinct from r.content_revision
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
