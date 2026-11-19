-- The status-filter overload accepts omitted arguments, including legacy one- and
-- two-argument calls. Keeping the old overload makes those calls ambiguous in SQL
-- and PostgREST. The three-argument version preserves their behavior via defaults.
set local lock_timeout = '5s';
drop function public.get_advertising_campaigns(uuid, uuid);
