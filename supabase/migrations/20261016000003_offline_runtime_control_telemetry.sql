-- Controle operacional remoto. Nenhuma flag concede acesso ao servidor; RLS e has_app_access prevalecem.
create table public.offline_feature_flags (
  feature text primary key check (feature in ('offline_write', 'offline_cold_start')),
  enabled boolean not null default false,
  rollout_percentage numeric(5,2) not null default 0 check (rollout_percentage between 0 and 100),
  updated_at timestamptz not null default now()
);
insert into public.offline_feature_flags (feature) values ('offline_write'), ('offline_cold_start');
create function private.touch_offline_feature_flags() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
revoke all on function private.touch_offline_feature_flags() from public, anon, authenticated;
create trigger offline_feature_flags_updated_at before update on public.offline_feature_flags
  for each row execute function private.touch_offline_feature_flags();
alter table public.offline_feature_flags enable row level security;
revoke all on public.offline_feature_flags from public, anon, authenticated;
grant select, update on public.offline_feature_flags to service_role;

create function public.get_offline_feature_flags() returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  return coalesce((
    select jsonb_object_agg(feature, jsonb_build_object(
      'enabled', enabled, 'rollout_percentage', rollout_percentage, 'updated_at', updated_at
    )) from public.offline_feature_flags
  ), '{}'::jsonb);
end;
$$;
revoke all on function public.get_offline_feature_flags() from public, anon;
grant execute on function public.get_offline_feature_flags() to authenticated;

-- Somente dados técnicos enumerados. O servidor define usuário e horário; payload livre nunca é gravado.
create table public.offline_telemetry (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in (
    'offline_write_created', 'sync_started', 'sync_completed', 'sync_retry',
    'sync_conflict', 'sync_failed', 'sync_recovered', 'offline_boot_used',
    'offline_boot_failed', 'indexeddb_unavailable', 'bootstrap_revalidated',
    'bootstrap_revalidation_failed'
  )),
  app_version text check (app_version is null or app_version ~ '^[0-9A-Za-z._-]{1,32}$'),
  schema_version smallint check (schema_version between 0 and 100),
  pending_count integer check (pending_count between 0 and 100000),
  batch_size smallint check (batch_size between 0 and 50),
  attempt_number smallint check (attempt_number between 0 and 100),
  duration_ms integer check (duration_ms between 0 and 3600000),
  error_code text check (error_code is null or error_code in (
    'CONFLICT', 'NETWORK', 'TIMEOUT', 'AUTH', 'ACCESS_DENIED', 'STORAGE', 'UNKNOWN'
  )),
  created_at timestamptz not null default now()
);
create index offline_telemetry_created_at_idx on public.offline_telemetry (created_at);
create index offline_telemetry_user_created_idx on public.offline_telemetry (user_id, created_at desc);
alter table public.offline_telemetry enable row level security;
revoke all on public.offline_telemetry from public, anon, authenticated;
grant select, delete on public.offline_telemetry to service_role;

create function public.record_offline_telemetry(p_events jsonb, p_expected_user uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_event jsonb;
  v_count integer := 0;
  v_allowed integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_expected_user is not null and p_expected_user <> v_uid then raise exception 'USER_MISMATCH'; end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' or jsonb_array_length(p_events) > 20 then
    raise exception 'INVALID_TELEMETRY';
  end if;
  if pg_column_size(p_events) > 8192 then raise exception 'INVALID_TELEMETRY'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  select greatest(0, 120 - count(*)::integer) into v_allowed
    from public.offline_telemetry where user_id = v_uid and created_at > now() - interval '1 hour';
  for v_event in select value from jsonb_array_elements(p_events) loop
    exit when v_count >= v_allowed;
    if jsonb_typeof(v_event) <> 'object'
       or (select bool_or(key not in ('event_type','app_version','schema_version','pending_count',
                   'batch_size','attempt_number','duration_ms','error_code'))
             from jsonb_object_keys(v_event) as key)
       or v_event->>'event_type' not in (
          'offline_write_created','sync_started','sync_completed','sync_retry','sync_conflict',
          'sync_failed','sync_recovered','offline_boot_used','offline_boot_failed',
          'indexeddb_unavailable','bootstrap_revalidated','bootstrap_revalidation_failed'
       ) then raise exception 'INVALID_TELEMETRY'; end if;
    insert into public.offline_telemetry (
      user_id, event_type, app_version, schema_version, pending_count, batch_size,
      attempt_number, duration_ms, error_code
    ) values (
      v_uid, v_event->>'event_type', v_event->>'app_version',
      (v_event->>'schema_version')::smallint, (v_event->>'pending_count')::integer,
      (v_event->>'batch_size')::smallint, (v_event->>'attempt_number')::smallint,
      (v_event->>'duration_ms')::integer, v_event->>'error_code'
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.record_offline_telemetry(jsonb, uuid) from public, anon;
grant execute on function public.record_offline_telemetry(jsonb, uuid) to authenticated;

create function private.cleanup_offline_telemetry() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_deleted integer;
begin
  delete from public.offline_telemetry where created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
revoke all on function private.cleanup_offline_telemetry() from public, anon, authenticated;
select cron.schedule('cleanup-offline-telemetry', '17 4 * * *',
  $$select private.cleanup_offline_telemetry()$$);
