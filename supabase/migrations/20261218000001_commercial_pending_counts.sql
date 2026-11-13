-- PR2: Início's operational cards derived pending counts by filtering only the first
-- page (20 ads / 10 storefronts / 20 refunds) each listing RPC returns, so an item
-- outside that recent window never appeared as pending anywhere, with no indication
-- the number was incomplete. This RPC returns real totals, no rows, so the client
-- never has to choose between a cheap sample and a slow full-history fetch.
set local lock_timeout='5s';

create function public.admin_commercial_pending_counts() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return jsonb_build_object(
  'pendingAds',(select count(*) from private.advertising_drafts where state='submitted'),
  'pendingStorefronts',(select count(*) from private.commercial_resources where offering_code='product_storefront' and moderation_state='submitted'),
  'pendingBoosts',(select count(*) from private.commercial_resources where offering_code in('post_boost','community_boost') and moderation_state='submitted'),
  -- Mesmo conjunto de status fechados já usado no cliente (CLOSED_REFUND_STATES).
  'openRefunds',(select count(*) from public.refund_requests where status not in('completed','rejected','canceled_by_requester'))
 );
end $$;
revoke all on function public.admin_commercial_pending_counts() from public,anon,service_role;
grant execute on function public.admin_commercial_pending_counts() to authenticated;
