-- Additive, event-driven public count. No existing RPC, RLS or catalogue semantics change.
-- Queue changes commit with catalogue changes. Cron only sees committed events.
set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table private.public_catalog_refresh (
  singleton boolean primary key default true check (singleton),
  generation bigint not null default 1 check (generation > 0),
  published_generation bigint not null default 0,
  requested_at timestamptz not null default now(),
  constraint public_catalog_generation_order check (published_generation <= generation)
);
revoke all on private.public_catalog_refresh from public, anon, authenticated, service_role;
insert into private.public_catalog_refresh(singleton) values (true);

create table public.public_catalog_snapshot (
  singleton boolean primary key default true check (singleton),
  total_active bigint not null check (total_active >= 0 and total_active <= 9007199254740991),
  revision text not null check (revision ~ '^[0-9]+$'),
  updated_at timestamptz not null
);
alter table public.public_catalog_snapshot enable row level security;
revoke all on public.public_catalog_snapshot from public, anon, authenticated, service_role;
grant select on public.public_catalog_snapshot to anon, authenticated, service_role;
create policy public_catalog_snapshot_read on public.public_catalog_snapshot
  for select to anon, authenticated using (true);

create function private.queue_public_catalog_refresh() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare before_visible boolean := false; after_visible boolean := false;
begin
  if tg_op <> 'INSERT' then before_visible := old.is_active and old.status = 'published'; end if;
  if tg_op <> 'DELETE' then after_visible := new.is_active and new.status = 'published'; end if;
  if before_visible is distinct from after_visible then
    update private.public_catalog_refresh
      set generation = generation + 1, requested_at = clock_timestamp() where singleton;
  end if;
  return null;
end;
$$;
revoke all on function private.queue_public_catalog_refresh() from public, anon, authenticated, service_role;
create trigger exercise_catalog_public_snapshot_event
  after insert or update or delete on public.exercise_catalog
  for each row execute function private.queue_public_catalog_refresh();

create function private.refresh_public_catalog_snapshot() returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare current_generation bigint; published bigint; total bigint;
begin
  -- Serializes processors and visibility events. Read committed sees the state
  -- after the lock is obtained; concurrent events commit after us and remain dirty.
  select generation, published_generation into current_generation, published
    from private.public_catalog_refresh where singleton for update;
  if current_generation = published then return; end if;
  select total_active into strict total from public.get_exercise_catalog_revision();
  insert into public.public_catalog_snapshot(singleton,total_active,revision,updated_at)
    values(true,total,current_generation::text,clock_timestamp())
    on conflict(singleton) do update set total_active=excluded.total_active,
      revision=excluded.revision,updated_at=excluded.updated_at;
  -- This ACK commits atomically with the snapshot. On any failure both roll back;
  -- next cron run retries the same durable generation. No HTTP delivery to lose.
  update private.public_catalog_refresh set published_generation=current_generation where singleton;
end;
$$;
revoke all on function private.refresh_public_catalog_snapshot() from public, anon, authenticated, service_role;

-- Bootstrap from the real catalogue, independent of future publications.
select private.refresh_public_catalog_snapshot();
-- pg_cron is already required by existing migrations. Same-name scheduling is idempotent.
select cron.schedule('refresh-public-catalog-snapshot','* * * * *',
  $$select private.refresh_public_catalog_snapshot()$$);
