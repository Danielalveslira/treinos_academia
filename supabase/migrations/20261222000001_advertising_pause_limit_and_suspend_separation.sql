-- Two root causes fixed here, both found by code review against a real report:
--
-- 1) interrupt_advertising_campaign branched on `is_superadmin()` alone to decide whether an
--    interruption was an administrative suspension or the advertiser's own voluntary pause.
--    A superadmin pausing their OWN ad through the normal "Pausar anúncio" button (not the
--    admin console) always took the admin branch, so their own voluntary pause was recorded as
--    `moderation_state='suspended'` ("Suspenso pelo Evolutus") instead of a resumable pause.
--    The admin console already called the exact same RPC for its "Suspender anúncio" button, so
--    there was never a way to tell "I'm an advertiser pausing my own ad" from "I'm an admin
--    suspending someone else's ad" other than the caller's role -- which a superadmin always has,
--    even when acting as an ordinary advertiser on their own account. Fixed by making
--    interrupt_advertising_campaign exclusively the advertiser path (require_advertising_editor,
--    unconditionally, regardless of is_superadmin) and giving the admin console its own explicit
--    RPC, admin_suspend_advertising_campaign, mirroring the existing admin_resume_advertising_campaign.
--
-- 2) No limit existed on voluntary pause/resume cycles: new product rule is up to 3 per
--    continuous contracted period. A 4th confirmed pause becomes an Evolutus-side suspension
--    (same final state as administrative suspension, so the UI message is consistent), requiring
--    admin release. The counter is counted on the ad (commercial_resources), not per user, so
--    owner and every active manager share it. It must survive early renewals of a still-active
--    period (the existing fulfil/renew logic never resets visibility_entitlements.starts_at in
--    that case) and reset only when a genuinely new period starts (starts_at moves forward because
--    the previous one had actually expired) -- comparing the stored period anchor against the
--    live entitlement's starts_at at pause time gives that for free, with no change anywhere else.
set local lock_timeout = '5s';

alter table private.commercial_resources
  add column advertiser_pause_count smallint not null default 0 check (advertiser_pause_count between 0 and 3),
  add column advertiser_pause_period_start timestamptz;

-- Advertiser-only from now on. Dropping the is_superadmin branch is intentional: a superadmin
-- managing their own ad through this path follows the exact same rules as any other advertiser.
create or replace function public.interrupt_advertising_campaign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare
  d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
  v_period timestamptz;
begin
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  select * into d from private.advertising_drafts where ad_id = p_id;
  if not found or r.id is null then raise exception 'AD_NOT_FOUND'; end if;
  perform private.require_advertising_editor(d.account_id);
  if r.moderation_state = 'suspended' then return; end if;
  if r.moderation_state <> 'approved' or r.approved_revision is null
    or not exists(select 1 from public.visibility_entitlements ve where ve.resource_id = p_id
      and ve.administrative_state = 'enabled' and ve.starts_at <= statement_timestamp() and ve.expires_at > statement_timestamp())
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if r.advertiser_paused_at is not null then return; end if;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  -- A period anchor different from what's stored means either the first pause ever on this
  -- resource, or a genuinely new contracted period (the old one had expired before renewal) --
  -- both start the count fresh. An early renewal of a still-active period keeps starts_at
  -- unchanged, so the count is not reset by it.
  v_period := e.starts_at;
  if r.advertiser_pause_period_start is distinct from v_period then
    r.advertiser_pause_count := 0;
  end if;
  if r.advertiser_pause_count >= 3 then
    update private.commercial_resources set moderation_state = 'suspended',
      advertiser_pause_count = 3, advertiser_pause_period_start = v_period where id = p_id;
    insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
      values (auth.uid(), p_id, 'suspend_pause_limit', btrim(p_reason));
    return;
  end if;
  update private.commercial_resources set advertiser_paused_at = clock_timestamp(), advertiser_paused_by = auth.uid(),
    advertiser_pause_count = r.advertiser_pause_count + 1, advertiser_pause_period_start = v_period where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (auth.uid(), p_id, 'advertiser_pause', btrim(p_reason));
end $$;

-- Admin-only moderation suspension: the console's own path, never reachable from the
-- advertiser's "Pausar anúncio" button. Mirrors admin_resume_advertising_campaign's shape
-- (explicit admin RPC, recent-auth required, its own audited action name).
create function public.admin_suspend_advertising_campaign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare r private.commercial_resources;
begin
  perform private.require_evocash_admin(true);
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  if r.id is null then raise exception 'AD_NOT_FOUND'; end if;
  if r.moderation_state = 'archived' then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state = 'suspended' then return; end if;
  update private.commercial_resources set moderation_state = 'suspended' where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (auth.uid(), p_id, 'admin_suspend', btrim(p_reason));
end $$;
revoke all on function public.admin_suspend_advertising_campaign(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_suspend_advertising_campaign(uuid, text) to authenticated;

-- Resolves, for a resource currently suspended, whether the most recent suspend-family
-- operation was raised by the account's own owner/manager (voluntary intent, mishandled by code
-- that had no voluntary path at all before this release) or genuinely by someone outside the
-- account (real moderation). Used by the admin projection below and by the read-only recovery
-- candidate query -- one definition, so both agree.
create function private.advertising_suspension_origin(p_id uuid, p_account_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case o.action
    when 'suspend_pause_limit' then 'pause_limit'
    when 'admin_suspend' then 'admin'
    when 'suspend' then case when exists(
      select 1 from public.advertiser_accounts a where a.id = p_account_id and
        (a.owner_user_id = o.actor_user_id or exists(
          select 1 from public.advertiser_members m where m.account_id = a.id and m.user_id = o.actor_user_id))
      ) then 'legacy_voluntary' else 'admin' end
    else 'unknown'
  end
  from (select action, actor_user_id from public.advertising_operations
    where resource_id = p_id and action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
    order by id desc limit 1) o
$$;
revoke all on function private.advertising_suspension_origin(uuid, uuid) from public, anon, authenticated, service_role;

-- Same projection as 20261219000002, plus the pause counter (owner and every active manager
-- read the same numbers -- it lives on the resource, not per user) and, only while suspended,
-- who/why for the admin screen. advertiser_pause_period_start is never exposed: it is an
-- internal anchor, not something either side should branch on in the client.
create or replace function public.get_advertising_campaigns(p_account uuid default null, p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,
 (r.advertiser_paused_at is not null) as advertiser_paused,e.starts_at,e.expires_at,
 r.advertiser_pause_count as pauses_used, (3 - r.advertiser_pause_count) as pauses_available,
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
