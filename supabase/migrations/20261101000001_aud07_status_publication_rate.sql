-- AUD-07: keep legacy direct INSERT; account only committed new publications.
set local lock_timeout='5s';
create table private.status_publication_limits (
  user_id uuid primary key references public.users(id) on delete cascade,
  minute_start timestamptz, minute_count integer not null default 0 check(minute_count>=0),
  hour_start timestamptz, hour_count integer not null default 0 check(hour_count>=0),
  day_start timestamptz, day_count integer not null default 0 check(day_count>=0)
);
alter table private.status_publication_limits enable row level security;
revoke all on private.status_publication_limits from public,anon,authenticated,service_role;

create function private.enforce_status_publication_rate() returns trigger
language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid := auth.uid(); v_now timestamptz;
  v_minute timestamptz; v_hour timestamptz; v_day timestamptz;
  v_row private.status_publication_limits;
  v_minute_count integer; v_hour_count integer; v_day_count integer;
  v_retry integer:=0;
begin
  -- Session SQL role survives SECURITY DEFINER RPCs. Clients cannot select a
  -- service role. Trusted backend maintenance/imports have no user quota; normal
  -- admins using authenticated sessions are limited exactly like other users.
  if current_setting('role',true) not in ('authenticated','anon') then return new; end if;
  if v_uid is null or new.author_id is distinct from v_uid then
    raise exception 'PERMISSION_DENIED' using errcode='42501';
  end if;
  insert into private.status_publication_limits(user_id) values(v_uid) on conflict do nothing;
  select * into v_row from private.status_publication_limits where user_id=v_uid for update;
  -- Measure time AFTER the narrow per-user lock, avoiding a boundary race where
  -- an older queued timestamp could reset a newer window's counter.
  v_now:=clock_timestamp();
  v_minute:=date_bin(interval '1 minute',v_now,timestamptz '2000-01-01 00:00:00+00');
  v_hour:=date_bin(interval '1 hour',v_now,timestamptz '2000-01-01 00:00:00+00');
  v_day:=date_bin(interval '1 day',v_now,timestamptz '2000-01-01 00:00:00+00');
  v_minute_count:=case when v_row.minute_start=v_minute then v_row.minute_count else 0 end;
  v_hour_count:=case when v_row.hour_start=v_hour then v_row.hour_count else 0 end;
  v_day_count:=case when v_row.day_start=v_day then v_row.day_count else 0 end;
  if v_minute_count>=5 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_minute+interval '1 minute'-v_now))::integer); end if;
  if v_hour_count>=30 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_hour+interval '1 hour'-v_now))::integer); end if;
  if v_day_count>=100 then v_retry:=greatest(v_retry,ceil(extract(epoch from v_day+interval '1 day'-v_now))::integer); end if;
  if v_retry>0 then
    raise exception using errcode='PT429',message='PUBLICATION_RATE_LIMITED',
      detail='retry_after_seconds='||v_retry::text;
  end if;
  update private.status_publication_limits set minute_start=v_minute,minute_count=v_minute_count+1,
    hour_start=v_hour,hour_count=v_hour_count+1,day_start=v_day,day_count=v_day_count+1
    where user_id=v_uid;
  return new;
end $$;
revoke all on function private.enforce_status_publication_rate() from public,anon,authenticated,service_role;
-- AFTER INSERT does not run for ON CONFLICT DO NOTHING retries. Any later error
-- or transaction abort rolls back both post and quota, including bulk statements.
create trigger statuses_check_publication_rate after insert on public.statuses
for each row execute function private.enforce_status_publication_rate();
notify pgrst,'reload schema';
