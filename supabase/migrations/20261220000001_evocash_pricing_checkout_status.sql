-- PR4: admin_get_evocash_pricing() only ever returned quotingEnabled, never
-- checkout_enabled (added later, 20261129000001_evocash_quantity_checkout.sql). The
-- EvoCashPricing.jsx panel has no real data to show the actual checkout status, so it
-- shows a static "Novas cobranças desativadas nesta fase" text instead -- disconnected
-- from the real quotingEnabled Label right next to it on the same screen, and never
-- updated even after checkout_enabled or quoting_enabled changes. This adds the one
-- missing field; no business rule, gate or write path changes.
set local lock_timeout='5s';

create or replace function public.admin_get_evocash_pricing() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s public.evocash_pricing_state; v public.evocash_price_versions; latest public.evocash_price_versions;
begin
  perform private.require_evocash_admin();
  select * into s from public.evocash_pricing_state where id;
  select * into v from public.evocash_price_versions where active_from<=statement_timestamp() order by active_from desc limit 1;
  select * into latest from public.evocash_price_versions where id=s.latest_version_id;
  return jsonb_build_object('revision',s.revision::text,'quotingEnabled',s.quoting_enabled,'checkoutEnabled',s.checkout_enabled,
    'serverTime',statement_timestamp(),'current',private.evocash_price_json(v),'latest',private.evocash_price_json(latest));
end $$;
