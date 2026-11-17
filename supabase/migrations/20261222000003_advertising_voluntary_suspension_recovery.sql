-- Before 20261219000002_advertising_voluntary_pause.sql, interrupt_advertising_campaign had no
-- voluntary concept at all: every interruption set moderation_state='suspended', whether the
-- caller was a genuine moderator or the account's own owner/manager pausing their own ad. The
-- actor was always recorded in advertising_operations (action='suspend'), so real intent can be
-- recovered from that evidence alone: if the most recent 'suspend' operation on a currently
-- suspended resource was performed by someone who is (or was) an owner/manager of the very
-- account that owns the ad, it was never a third-party moderation decision.
-- private.advertising_suspension_origin (20261222000001) already encodes exactly this check and
-- is reused here unchanged, so the admin projection and this recovery path can never disagree
-- about what counts as "legacy voluntary" evidence.
--
-- Recovery restores delivery (moderation_state='approved') and, per product requirement,
-- CREDITS the recovered pause toward the 3-cycle limit (the advertiser did pause once, even if
-- the old code mishandled it) rather than granting a free reset. It never touches content,
-- orders, reservations or financial history, and only ever one explicitly identified, revision-
-- locked resource -- there is no bulk variant.
set local lock_timeout = '5s';

create function public.admin_recover_advertising_voluntary_suspension(p_id uuid, p_expected_revision bigint) returns private.commercial_resources
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); r private.commercial_resources; d private.advertising_drafts; e public.visibility_entitlements;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED' using errcode = '28000'; end if;
  perform private.require_evocash_admin(true);
  select * into r from private.commercial_resources where id = p_id for update;
  select * into d from private.advertising_drafts where ad_id = p_id;
  if not found or r.id is null then raise exception 'AD_NOT_FOUND'; end if;
  if r.content_revision is distinct from p_expected_revision then raise exception 'AD_REVISION_CONFLICT'; end if;
  if r.moderation_state <> 'suspended' then raise exception 'AD_NOT_SUSPENDED'; end if;
  if private.advertising_suspension_origin(p_id, d.account_id) <> 'legacy_voluntary' then
    raise exception 'AD_RECOVERY_NOT_ELIGIBLE';
  end if;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled' or e.expires_at <= statement_timestamp() then
    raise exception 'AD_RECOVERY_NOT_ELIGIBLE';
  end if;
  update private.commercial_resources set moderation_state = 'approved',
    advertiser_pause_count = least(3, advertiser_pause_count + 1), advertiser_pause_period_start = e.starts_at
    where id = p_id returning * into r;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason)
    values (v_uid, p_id, 'advertising_suspension_recovered',
      'Recuperação individual de pausa voluntária mal interpretada como suspensão administrativa pelo fluxo anterior ao PR #151');
  return r;
end $$;
revoke all on function public.admin_recover_advertising_voluntary_suspension(uuid, bigint) from public, anon, authenticated, service_role;
grant execute on function public.admin_recover_advertising_voluntary_suspension(uuid, bigint) to authenticated;
