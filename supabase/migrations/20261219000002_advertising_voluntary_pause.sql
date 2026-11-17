-- A voluntary pause is orthogonal to editorial moderation. Existing suspended rows
-- remain administrative/unknown and can never be resumed by the advertiser.
set local lock_timeout='5s';
alter table private.commercial_resources
  add column advertiser_paused_at timestamptz,
  add column advertiser_paused_by uuid;
alter table private.commercial_resources
  add constraint advertiser_pause_pair check ((advertiser_paused_at is null) = (advertiser_paused_by is null));

create or replace view private.live_commercial_resources as
 select r.id,r.offering_code,r.owner_user_id,r.approved_revision,e.expires_at
 from private.commercial_resources r
 join public.commercial_offerings f on f.code=r.offering_code
 join public.users u on u.id=r.owner_user_id
 join public.visibility_entitlements e on e.resource_id=r.id
 where f.integration_ready and u.account_status='active'
 and r.moderation_state='approved' and r.content_revision=r.approved_revision
 and r.advertiser_paused_at is null
 and e.administrative_state='enabled' and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp()
 and not exists(select 1 from public.account_restrictions a where a.user_id=u.id
  and not(a.action='temporary_suspension' and a.until<=statement_timestamp()));

create or replace function public.interrupt_advertising_campaign(p_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; admin_action boolean;
begin
 if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
 -- The resource is the common lock for quote, fulfil, review and interruption.
 select * into r from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id;
 if not found or r.id is null then raise exception 'AD_NOT_FOUND'; end if;
 admin_action:=coalesce(public.is_superadmin(),false);
 if admin_action then
  perform private.require_evocash_admin(true);
  if r.moderation_state='archived' then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state='suspended' then return; end if;
  update private.commercial_resources set moderation_state='suspended' where id=p_id;
  insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
   values(auth.uid(),p_id,'suspend',btrim(p_reason));
 else
  perform private.require_advertising_editor(d.account_id);
  if r.moderation_state<>'approved' or r.approved_revision is null
   or not exists(select 1 from public.visibility_entitlements e where e.resource_id=p_id
    and e.administrative_state='enabled' and e.starts_at<=statement_timestamp() and e.expires_at>statement_timestamp())
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if r.advertiser_paused_at is not null then return; end if;
  update private.commercial_resources set advertiser_paused_at=clock_timestamp(),advertiser_paused_by=auth.uid() where id=p_id;
  insert into public.advertising_operations(actor_user_id,resource_id,action,reason)
   values(auth.uid(),p_id,'advertiser_pause',btrim(p_reason));
 end if;
end $$;

create function public.resume_my_advertising_campaign(p_id uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
begin
 perform private.require_commercial_user();
 select * into r from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id;
 if not found or r.id is null then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_advertising_editor(d.account_id);
 if r.advertiser_paused_at is null then
  if r.moderation_state='approved' then return; end if;
  raise exception 'AD_RESUME_BLOCKED';
 end if;
 if r.advertiser_paused_by is distinct from auth.uid()
  or r.moderation_state<>'approved' or r.approved_revision is null
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
revoke all on function public.resume_my_advertising_campaign(uuid) from public,anon,service_role;
grant execute on function public.resume_my_advertising_campaign(uuid) to authenticated;

-- The list projects only an authorized pause flag. No extra request per card.
create or replace function public.get_advertising_campaigns(p_account uuid default null,p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,
 (r.advertiser_paused_at is not null) as advertiser_paused,e.starts_at,e.expires_at,
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
