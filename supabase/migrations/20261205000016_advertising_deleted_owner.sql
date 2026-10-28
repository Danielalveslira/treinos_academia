set local lock_timeout='5s';
-- Retain attribution, creatives and contracts without obstructing the existing
-- authorized deletion worker. A NULL commercial owner never satisfies visibility.
alter table public.advertiser_accounts drop constraint advertiser_accounts_owner_user_id_fkey;
alter table public.advertiser_accounts add foreign key(owner_user_id) references public.users(id) on delete set null;
alter table public.sponsored_ads alter column created_by drop not null;
alter table public.sponsored_ads drop constraint sponsored_ads_created_by_fkey;
alter table public.sponsored_ads add foreign key(created_by) references public.users(id) on delete set null;
