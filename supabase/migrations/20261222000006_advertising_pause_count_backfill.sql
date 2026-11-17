-- Count reliable advertiser_pause operations already completed in the CURRENT continuous
-- contracted period before this limit was introduced. A new period excludes older operations;
-- early renewals preserve starts_at and therefore preserve the count. This is a one-time,
-- targeted backfill over ads with such audit events, never a trigger or repeated mass rewrite.
begin;
set local lock_timeout = '5s';

with audited as (
  select e.resource_id, e.starts_at,
    least(3, count(*)::int)::smallint as pause_count
  from public.visibility_entitlements e
  join public.advertising_operations o on o.resource_id = e.resource_id
    and o.action = 'advertiser_pause'
    and o.occurred_at >= e.starts_at and o.occurred_at < e.expires_at
  where e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp()
  group by e.resource_id, e.starts_at
)
update private.commercial_resources r
set advertiser_pause_count = case
      when r.advertiser_pause_period_start is distinct from a.starts_at then a.pause_count
      else greatest(r.advertiser_pause_count, a.pause_count)
    end,
    advertiser_pause_period_start = a.starts_at
from audited a
where r.id = a.resource_id and (
  r.advertiser_pause_period_start is distinct from a.starts_at
  or r.advertiser_pause_count < a.pause_count
);
commit;
