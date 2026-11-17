-- resume_my_advertising_campaign required the resuming user to be the exact same auth.uid()
-- that paused the ad, even though private.require_advertising_editor(d.account_id) already
-- restricts the caller to the account's owner or an active (non-revoked) manager. In practice
-- this locked a voluntary pause to whichever single person on the team happened to click
-- "Pausar": any other authorized editor of the same advertiser account -- owner or manager --
-- was rejected with AD_RESUME_BLOCKED even though they are fully authorized to manage the ad.
-- The pause is an account-level action, not a personal one; who is still authorized to act on
-- the account is exactly what require_advertising_editor already checks, so the extra identity
-- match is dropped. Every other guard (approval/revision/entitlement/account/restriction state)
-- is unchanged.
create or replace function public.resume_my_advertising_campaign(p_id uuid) returns void
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
revoke all on function public.resume_my_advertising_campaign(uuid) from public,anon,service_role;
grant execute on function public.resume_my_advertising_campaign(uuid) to authenticated;
