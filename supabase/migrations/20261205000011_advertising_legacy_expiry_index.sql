-- Paired 10k-history EXPLAIN ANALYZE reduced selector p50 from 11.403 ms to 5.289 ms.
-- Includes NULL expiries for compatible legacy rows; no commercial rights changed.
set local lock_timeout='5s';
create index advertising_legacy_expiry_idx on public.sponsored_ads(expires_at) where commercial_resource_id is null;
