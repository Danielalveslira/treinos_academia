-- Preserve the existing account/session gate for both legacy and managed ads.
set local lock_timeout='5s';
drop policy sponsored_ads_select on public.sponsored_ads;
create policy sponsored_ads_select on public.sponsored_ads for select using(coalesce(public.has_app_access(),false) and (
 public.is_superadmin() or
 (commercial_resource_id is null and (expires_at is null or expires_at>statement_timestamp()) and
 ((is_global and auth.uid() is not null) or exists(select 1 from public.community_members cm where cm.user_id=auth.uid() and cm.community_id=any(community_ids))))
 or (commercial_resource_id is not null and coalesce(public.has_app_access(),false) and
 (private.advertising_eligible(id,'home_banner',null) or exists(select 1 from unnest(community_ids) c where public.is_community_member(c) and (private.advertising_eligible(id,'community_banner',c) or private.advertising_eligible(id,'community_feed',c)))))));
