-- Install paused. Activation and the first batch belong to a separate release migration.
set local lock_timeout = '5s';

-- Promotions are immutable financial history; flags on statuses are only cached hints.
create function private.status_promotion_until(p_status public.statuses) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select max(p.expires_at) from public.promotions p
  where p.target_type = 'post' and p.target_id = p_status.id
    and p.owner_id = p_status.author_id and p.community_id = p_status.community_id
    and p.status = 'active' and p.cancelled_at is null
    and p.started_at <= now() and p.expires_at > now() and p.expires_at > p.started_at
$$;
revoke all on function private.status_promotion_until(public.statuses) from public, anon;
grant execute on function private.status_promotion_until(public.statuses) to authenticated, service_role;

create function private.status_interaction_expiry(p_status public.statuses) returns timestamptz
language sql stable security definer set search_path = '' as $$
  select case when p_status.expires_at is null or p_status.retention_mode = 'no_auto_expiration'
    then null else greatest(p_status.expires_at,
      case when p_status.type = 'workout' then p_status.workout_date end,
      private.status_promotion_until(p_status)) end
$$;
revoke all on function private.status_interaction_expiry(public.statuses) from public, anon;
grant execute on function private.status_interaction_expiry(public.statuses) to authenticated, service_role;

-- Invoker keeps statuses RLS and FK-derived PostgREST relationships intact.
create view public.status_publications with (security_invoker = true) as
select s.*, private.status_promotion_until(s) as verified_promoted_until,
  case when s.expires_at is null or s.retention_mode = 'no_auto_expiration' then null
    else greatest(s.expires_at, private.status_promotion_until(s)) end as publication_expires_at,
  private.status_interaction_expiry(s) as interaction_expires_at
from public.statuses s;
revoke all on public.status_publications from public, anon, authenticated, service_role;
grant select on public.status_publications to authenticated, service_role;

create or replace function private.comments_open(p_status public.statuses) returns boolean
language sql stable set search_path = '' as $$
  select p_status.expires_at is null or p_status.retention_mode = 'no_auto_expiration'
    or private.status_interaction_expiry(p_status) > now()
$$;

drop policy if exists status_photos_read on storage.objects;
create policy status_photos_read on storage.objects for select using (
  bucket_id = 'status-photos' and exists (
    select 1 from public.statuses s
    where s.photo_path in (storage.objects.name, 'statusPhotos/' || storage.objects.name)
      and (s.expires_at is null or s.retention_mode = 'no_auto_expiration'
        or greatest(s.expires_at, private.status_promotion_until(s)) > now())
      and public.is_community_member(s.community_id)
  )
);

create table public.status_expiration_control (
  id boolean primary key default true check (id), enabled boolean not null default false
);
insert into public.status_expiration_control(id) values(true);
create table public.status_expiration_queue (
  status_id uuid primary key references public.statuses(id) on delete cascade,
  next_attempt_at timestamptz not null,
  attempts integer not null default 0,
  last_error text
);
create index status_expiration_due on public.status_expiration_queue(next_attempt_at,status_id);
create index support_requests_status_open on public.support_requests(status_id) where state='open';
create table public.status_expiration_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  examined integer not null default 0,
  deleted integer not null default 0,
  preserved integer not null default 0,
  errors integer not null default 0,
  reasons jsonb not null default '{}'
);
create index status_expiration_runs_started on public.status_expiration_runs(started_at);
create table public.status_expiration_events (
  run_id bigint not null references public.status_expiration_runs(id) on delete cascade,
  status_id uuid not null, outcome text not null,
  primary key(run_id,status_id)
);
-- No user data, financial rows or photo paths in operational logs.
alter table public.status_expiration_control enable row level security;
alter table public.status_expiration_queue enable row level security;
alter table public.status_expiration_runs enable row level security;
alter table public.status_expiration_events enable row level security;
revoke all on public.status_expiration_control, public.status_expiration_queue,
  public.status_expiration_runs, public.status_expiration_events from public, anon, authenticated, service_role;
grant select on public.status_expiration_control, public.status_expiration_queue,
  public.status_expiration_runs, public.status_expiration_events to service_role;

create function private.enqueue_status_expiration(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.statuses;
begin
  select * into s from public.statuses where id=p_id;
  if not found then return; end if;
  if s.expires_at is null or s.retention_mode='no_auto_expiration' then
    delete from public.status_expiration_queue where status_id=p_id;
  else
    insert into public.status_expiration_queue(status_id,next_attempt_at)
    values(p_id,private.status_interaction_expiry(s))
    on conflict(status_id) do update set next_attempt_at=excluded.next_attempt_at,attempts=0,last_error=null;
  end if;
end;
$$;
revoke all on function private.enqueue_status_expiration(uuid) from public,anon,authenticated,service_role;
create function private.track_status_expiration() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name='statuses' then
    perform private.enqueue_status_expiration(new.id);
  else
    if old.target_type='post' then perform private.enqueue_status_expiration(old.target_id); end if;
    if new.target_type='post' then perform private.enqueue_status_expiration(new.target_id); end if;
  end if;
  return new;
end;
$$;
revoke all on function private.track_status_expiration() from public,anon,authenticated,service_role;
create trigger statuses_track_expiration after insert or update of expires_at,retention_mode,workout_date,promoted,promoted_until,active_promotion_id
on public.statuses for each row execute function private.track_status_expiration();
create trigger promotions_track_expiration after update of status,expires_at,cancelled_at,started_at,target_id,owner_id,community_id
on public.promotions for each row execute function private.track_status_expiration();
-- One bounded indexed queue entry per expiring status, including the historical backlog.
insert into public.status_expiration_queue(status_id,next_attempt_at)
select s.id,private.status_interaction_expiry(s) from public.statuses s
where s.expires_at is not null and s.retention_mode<>'no_auto_expiration';

create function public.process_expired_statuses(p_batch_size integer default 50) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  s public.statuses; v_run bigint; v_reason text; v_due timestamptz;
  v_examined integer:=0; v_deleted integer:=0; v_preserved integer:=0; v_errors integer:=0;
  v_reasons jsonb:='{}';
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'INVALID_BATCH_SIZE'; end if;
  if not (select enabled from public.status_expiration_control where id) then
    return jsonb_build_object('paused',true,'deleted',0);
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('evolutus:status-expiration',0)) then
    return jsonb_build_object('busy',true,'deleted',0);
  end if;
  insert into public.status_expiration_runs default values returning id into v_run;
  -- Lock statuses before the queue: same order as create_promotion and status updates.
  for s in select st.* from public.status_expiration_queue q join public.statuses st on st.id=q.status_id
    where q.next_attempt_at<=now() order by q.next_attempt_at,q.status_id
    limit p_batch_size for update of st skip locked
  loop
    v_examined:=v_examined+1; v_reason:=null;
    begin
      -- Revalidate after locking; never trust queued dates or promoted=true.
      v_due:=private.status_interaction_expiry(s);
      if s.expires_at is null or s.retention_mode='no_auto_expiration' then
        v_reason:='permanent'; delete from public.status_expiration_queue where status_id=s.id;
      elsif v_due>now() then
        v_reason:=case when private.status_promotion_until(s)>now() then 'active_promotion'
          when s.expires_at>now() then 'not_expired' else 'upcoming_workout' end;
        update public.status_expiration_queue set next_attempt_at=v_due where status_id=s.id;
      elsif exists(select 1 from public.support_requests where status_id=s.id and state='open') then
        v_reason:='open_support';
        update public.status_expiration_queue set next_attempt_at=now()+interval '1 hour' where status_id=s.id;
      else
        delete from public.statuses where id=s.id;
        -- Cascades remove comments/votes; AUD-04 captures OLD.photo_path atomically.
        v_deleted:=v_deleted+1; v_reason:='deleted';
      end if;
      if v_reason<>'deleted' then v_preserved:=v_preserved+1; end if;
    exception when others then
      v_errors:=v_errors+1; v_reason:='error:'||sqlstate;
      update public.status_expiration_queue set attempts=attempts+1,last_error=sqlstate,
        next_attempt_at=now()+make_interval(secs=>least(3600,30*power(2,least(attempts,6))::integer))
      where status_id=s.id;
    end;
    insert into public.status_expiration_events values(v_run,s.id,v_reason);
    v_reasons:=jsonb_set(v_reasons,array[v_reason],to_jsonb(coalesce((v_reasons->>v_reason)::integer,0)+1));
  end loop;
  update public.status_expiration_runs set finished_at=clock_timestamp(),examined=v_examined,
    deleted=v_deleted,preserved=v_preserved,errors=v_errors,reasons=v_reasons where id=v_run;
  -- Bounded telemetry retention; never touches finance.
  delete from public.status_expiration_runs where id in (
    select id from public.status_expiration_runs where started_at<now()-interval '30 days'
    order by started_at limit 100);
  return jsonb_build_object('runId',v_run,'examined',v_examined,'deleted',v_deleted,
    'preserved',v_preserved,'errors',v_errors,'reasons',v_reasons);
end;
$$;
revoke all on function public.process_expired_statuses(integer) from public,anon,authenticated,service_role;
-- Native cron runs as postgres, never exposed as a client/service RPC.
select cron.schedule('expire-statuses','* * * * *',
  $$set statement_timeout='20s'; set lock_timeout='2s'; select public.process_expired_statuses(50);$$);
notify pgrst,'reload schema';

-- Serialize paid purchases with expiry deletion; commercial pricing and debits unchanged.
create or replace function public.create_promotion(
  p_target_type text, p_target_id uuid, p_package_id text, p_request_id text
) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.promotions;
  v_status public.statuses;
  v_community public.communities;
  v_is_owner boolean;
  v_community_id uuid;
  v_promoted boolean;
  v_promoted_until timestamptz;
  v_config jsonb;
  v_pkg jsonb;
  v_cash_amount numeric;
  v_duration_days integer;
  v_wallet public.wallets;
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_target_type not in ('post', 'community') then raise exception 'INVALID_TARGET_TYPE'; end if;
  if p_target_id is null or p_package_id is null or p_request_id is null or length(p_request_id) = 0 then
    raise exception 'INVALID_REQUEST';
  end if;
  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_existing from public.promotions where owner_id = v_uid and request_id = p_request_id;
  if v_existing.id is not null then
    if v_existing.target_type <> p_target_type or v_existing.target_id <> p_target_id or v_existing.package_id <> p_package_id then
      raise exception 'REQUEST_ID_CONFLICT';
    end if;
    return jsonb_build_object('id', v_existing.id, 'replay', true, 'expiresAt', v_existing.expires_at);
  end if;

  if p_target_type = 'post' then
    select * into v_status from public.statuses where id = p_target_id for update;
    if v_status is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_status.author_id = v_uid);
    v_community_id := v_status.community_id;
    v_promoted := v_status.promoted;
    v_promoted_until := v_status.promoted_until;
  else
    select * into v_community from public.communities where id = p_target_id;
    if v_community is null then raise exception 'TARGET_NOT_FOUND'; end if;
    v_is_owner := (v_community.owner_id = v_uid);
    v_community_id := v_community.id;
    v_promoted := v_community.promoted;
    v_promoted_until := v_community.promoted_until;
  end if;

  if not coalesce(v_is_owner, false) then raise exception 'NOT_OWNER'; end if;

  if (select account_status from public.users where id = v_uid) = 'disabled' then
    raise exception 'ACCOUNT_DISABLED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  if not exists (select 1 from public.community_members where community_id = v_community_id and user_id = v_uid) then
    raise exception 'NOT_A_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;

  if p_target_type = 'post' then
    select * into v_community from public.communities where id = v_community_id;
  end if;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind = 'community' and target_id = v_community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;

  if (p_target_type = 'post' and private.status_promotion_until(v_status) > v_now)
     or (p_target_type = 'community' and v_promoted and v_promoted_until is not null and v_promoted_until > v_now) then
    raise exception 'ALREADY_PROMOTED';
  end if;

  select config into v_config from public.economy_config where id;
  v_pkg := v_config->'promotionPackages'->p_package_id;
  v_cash_amount := (v_pkg->>'cashAmount')::numeric;
  v_duration_days := (v_pkg->>'durationDays')::integer;
  if v_pkg is null or (v_pkg->>'targetType') <> p_target_type
     or v_cash_amount is null or v_cash_amount <= 0 or v_cash_amount > 1000000
     or v_duration_days is null or v_duration_days <= 0 or v_duration_days > 90
     or coalesce((v_pkg->>'active')::boolean, false) <> true
  then
    raise exception 'INVALID_PACKAGE';
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if coalesce(v_wallet.cash_balance, 0) < v_cash_amount then
    raise exception 'INSUFFICIENT_CASH';
  end if;

  v_expires_at := v_now + (v_duration_days || ' days')::interval;
  v_new_id := gen_random_uuid();

  perform public._wallet_debit_cash(v_uid, v_cash_amount);
  perform public._ledger_record(v_uid, 'promote:' || v_new_id::text, 'cash', 'debit', v_cash_amount, 'promotion_purchase', 'promotion', v_new_id::text);

  insert into public.promotions (
    id, owner_id, request_id, target_type, target_id, community_id, package_id,
    cash_amount, duration_days, status, started_at, expires_at
  ) values (
    v_new_id, v_uid, p_request_id, p_target_type, p_target_id, v_community_id, p_package_id,
    v_cash_amount, v_duration_days, 'active', v_now, v_expires_at
  );

  if p_target_type = 'post' then
    update public.statuses set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  else
    update public.communities set promoted = true, promoted_until = v_expires_at, active_promotion_id = v_new_id where id = p_target_id;
  end if;

  return jsonb_build_object('id', v_new_id, 'replay', false, 'expiresAt', v_expires_at);
end;
$$;

-- Keep vote prices, ledger and all access checks; validate real promotion on server.
create or replace function public.cast_vote(p_status_id uuid, p_value smallint) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_status public.statuses;
  v_community public.communities;
  v_existing public.status_economy_votes;
  v_action text;
  v_config jsonb;
  v_cost_coins numeric;
  v_max_votes_per_day integer;
  v_daily public.economy_daily;
  v_day date;
  v_new_reward_state text;
  v_natural_key text;
  v_delta_pos integer := 0;
  v_delta_neg integer := 0;
  v_expires_at timestamptz;
  v_balance numeric;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_value is not null and p_value not in (1, -1) then raise exception 'INVALID_VALUE'; end if;

  if (select account_status from public.users where id = v_uid) = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;

  select * into v_status from public.statuses where id = p_status_id for update;
  if v_status is null then raise exception 'STATUS_NOT_FOUND'; end if;
  if v_status.type = 'poll' then raise exception 'INELIGIBLE_TYPE_POLL'; end if;
  if v_status.type = 'workout' then raise exception 'INELIGIBLE_TYPE_WORKOUT'; end if;
  if v_status.author_id = v_uid then raise exception 'SELF_VOTE'; end if;

  v_expires_at := private.status_interaction_expiry(v_status);
  if v_expires_at <= now() then raise exception 'EXPIRED'; end if;

  select * into v_community from public.communities where id = v_status.community_id;
  if v_community is null or not v_community.is_active
     or exists (select 1 from public.deletion_jobs where kind='community' and target_id=v_status.community_id and state <> 'complete')
  then
    raise exception 'COMMUNITY_UNAVAILABLE';
  end if;
  if not exists (select 1 from public.community_members where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'NOT_MEMBER';
  end if;
  if exists (select 1 from public.community_restrictions where community_id = v_status.community_id and user_id = v_uid) then
    raise exception 'COMMUNITY_RESTRICTED';
  end if;
  if exists (
    select 1 from public.account_restrictions r where r.user_id = v_uid
      and not (r.action = 'temporary_suspension' and r.until <= now())
  ) then
    raise exception 'ACCOUNT_RESTRICTED';
  end if;

  -- Serializa retries/cliques concorrentes do MESMO usuário na MESMA publicação: sem isto, duas
  -- chamadas simultâneas sem linha prévia passariam ambas por 'create' (cobrando 2x e somando 2
  -- no contador) e só a inserção cairia no ON CONFLICT. O lock é liberado no fim da transação.
  perform pg_advisory_xact_lock(hashtextextended('cast_vote:' || v_uid::text || ':' || p_status_id::text, 0));

  select * into v_existing from public.status_economy_votes
    where status_id = p_status_id and user_id = v_uid for update;

  if v_existing is null then
    if p_value is null then return jsonb_build_object('action', 'noop'); end if;
    v_action := 'create';
  elsif v_existing.value is not distinct from p_value then
    return jsonb_build_object('action', 'noop');
  elsif p_value is null then
    v_action := 'remove';
  else
    v_action := 'switch';
  end if;

  v_day := (now() at time zone 'America/Sao_Paulo')::date;

  if v_action = 'create' then
    select config into v_config from public.economy_config where id;
    v_cost_coins := (v_config->'voting'->>'costCoins')::numeric;
    v_max_votes_per_day := (v_config->'voting'->>'maxVotesPerUserDay')::integer;
    if v_cost_coins is null or v_cost_coins <= 0 or v_cost_coins > 1000
       or v_max_votes_per_day is null or v_max_votes_per_day <= 0 or v_max_votes_per_day > 1000 then
      v_cost_coins := 3;
      v_max_votes_per_day := 10;
    end if;

    insert into public.economy_daily (user_id, day) values (v_uid, v_day) on conflict (user_id, day) do nothing;
    select * into v_daily from public.economy_daily where user_id = v_uid and day = v_day for update;
    if v_daily.votes_charged >= v_max_votes_per_day then
      raise exception 'RATE_LIMITED';
    end if;

    select coin_balance into v_balance from public.wallets where user_id = v_uid;
    if coalesce(v_balance, 0) < v_cost_coins then
      raise exception 'INSUFFICIENT_COINS';
    end if;

    perform public._wallet_debit_coins(v_uid, v_cost_coins);
    v_natural_key := 'vote:' || p_status_id::text || ':charge';
    perform public._ledger_record(v_uid, v_natural_key, 'coin', 'debit', v_cost_coins, 'vote_charge', 'status_economy_vote', p_status_id::text);
    update public.economy_daily set votes_charged = votes_charged + 1, vote_coins_spent = vote_coins_spent + v_cost_coins, updated_at = now()
      where user_id = v_uid and day = v_day;
  end if;

  if coalesce(v_existing.reward_state, '') in ('processed', 'capped') then
    v_new_reward_state := v_existing.reward_state;
  else
    v_new_reward_state := case when p_value = 1 then 'pending' else 'ineligible' end;
  end if;

  insert into public.status_economy_votes (
    status_id, user_id, author_id, value, charged, first_charged_at, updated_at,
    reward_state, reward_pending_at, reward_day_key
  ) values (
    p_status_id, v_uid, v_status.author_id, p_value, true,
    now(), now(), v_new_reward_state,
    case when v_new_reward_state = 'pending' then now() else null end,
    case when v_new_reward_state = 'pending' then v_day else null end
  )
  on conflict (status_id, user_id) do update set
    value = excluded.value, charged = true, updated_at = now(), reward_state = excluded.reward_state,
    reward_pending_at = excluded.reward_pending_at, reward_day_key = excluded.reward_day_key;

  if v_existing.value = 1 then v_delta_pos := v_delta_pos - 1; end if;
  if v_existing.value = -1 then v_delta_neg := v_delta_neg - 1; end if;
  if p_value = 1 then v_delta_pos := v_delta_pos + 1; end if;
  if p_value = -1 then v_delta_neg := v_delta_neg + 1; end if;
  update public.statuses set
    positive_vote_count = positive_vote_count + v_delta_pos,
    negative_vote_count = negative_vote_count + v_delta_neg
    where id = p_status_id;

  return jsonb_build_object('action', v_action, 'value', p_value);
end;
$$;

-- Never claim a path which is still referenced by a live row.
create or replace function public.claim_storage_cleanup_tasks() returns setof public.storage_cleanup_tasks
language plpgsql security definer set search_path = '' as $$
begin
  -- A crash on the final attempt must not leave a permanently invisible lease.
  update public.storage_cleanup_tasks set state = 'failed', last_error = 'ATTEMPTS_EXHAUSTED',
    lease_token = null, lease_until = null
  where state = 'leased' and lease_until <= now() and attempts >= 8;
  return query
  with due as (
    select t.id from public.storage_cleanup_tasks t
    where attempts < 8 and ((state = 'pending' and next_attempt_at <= now())
      or (state = 'leased' and lease_until <= now()))
      and not exists (select 1 from public.statuses s where t.bucket='status-photos'
        and s.photo_path in (t.object_key,'statusPhotos/'||t.object_key))
      and not exists (select 1 from public.profile_avatar_media a where t.bucket='profile-avatars'
        and a.storage_path=t.object_key)
    order by next_attempt_at, created_at limit 20 for update of t skip locked
  )
  update public.storage_cleanup_tasks t set state = 'leased', attempts = t.attempts + 1,
    lease_token = gen_random_uuid(), lease_until = now() + interval '5 minutes'
  from due where t.id = due.id returning t.*;
end;
$$;

-- Prevent reusing an identity while a durable photo deletion is pending/in flight.
-- With canonical photo paths this also closes the claim -> Storage remove race.
create function private.guard_status_photo_reuse() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.photo_path is not null and exists (
    select 1 from public.storage_cleanup_tasks t where t.bucket='status-photos'
      and t.reference in (new.photo_path,'statusPhotos/'||new.community_id::text||'/'||new.id::text||'.webp',
        new.community_id::text||'/'||new.id::text||'.webp')
  ) then raise exception 'PHOTO_ID_ALREADY_DELETED'; end if;
  return new;
end;
$$;
revoke all on function private.guard_status_photo_reuse() from public,anon,authenticated,service_role;
create trigger statuses_guard_photo_reuse before insert on public.statuses
for each row execute function private.guard_status_photo_reuse();
