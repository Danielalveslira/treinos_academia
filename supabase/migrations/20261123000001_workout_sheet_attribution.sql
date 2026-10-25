-- Additive only: links a workout row to the sheet it was registered under, for the Home's
-- "próxima ficha recomendada" / "última ficha treinada" / "mais treinada no mês" panel.
-- Does NOT touch public.workouts' existing columns, RLS policy, EvoCoins/complete_workout_session,
-- or the offline outbox sync path (apply_workout_mutation/sync_workout_mutations): sheet_id is only
-- ever set by the direct online write path in the client; outbox-synced rows simply have it null.
set local lock_timeout = '5s';

alter table public.workouts add column sheet_id uuid;
-- "on delete set null (sheet_id)" (PG15+) nulls ONLY sheet_id when the sheet is deleted. Without
-- the column list, a composite-FK "on delete set null" nulls EVERY column in the FK -- including
-- user_id, which must never be touched. (Caught by CI: the generated action was literally
-- "UPDATE workouts SET sheet_id = NULL, user_id = NULL ...", which also tripped the immutability
-- trigger below since user_id is NOT NULL on this table.)
alter table public.workouts add constraint workouts_sheet_id_fkey
  foreign key (sheet_id, user_id) references public.workout_sheets(id, user_id)
  on delete set null (sheet_id);
-- "Mais treinada no mês" / "última execução por ficha" read only recent, sheet-scoped rows.
create index workouts_sheet_activity_idx on public.workouts(user_id, sheet_id, date desc) include(created_at)
  where sheet_id is not null;

-- Archiving is the public lifecycle operation (no DELETE grant). Only the FK action after
-- physical removal may clear attribution. The SECURITY DEFINER check sees the parent regardless
-- of RLS: hiding a sheet or revoking a session cannot authorize a client to clear its link.
create or replace function public.enforce_workout_immutable_fields() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is distinct from old.user_id then raise exception 'USER_ID_IMMUTABLE'; end if;
  if new.created_at is distinct from old.created_at then raise exception 'CREATED_AT_IMMUTABLE'; end if;
  if new.type is distinct from old.type then raise exception 'TYPE_IMMUTABLE'; end if;
  if new.sheet_id is distinct from old.sheet_id and not (
    old.sheet_id is not null and new.sheet_id is null
    and not exists(select 1 from public.workout_sheets where id=old.sheet_id)
  ) then raise exception 'SHEET_ID_IMMUTABLE'; end if;
  if old.sheet_id is not null and new.exercise_id is distinct from old.exercise_id then
    raise exception 'SHEET_EXERCISE_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function public.enforce_workout_immutable_fields() from public,anon,authenticated;

-- Same lock order as save_workout_sheet: sheet -> library exercise -> official catalog.
-- SHARE conflicts with metadata/archive updates and item removal through the sheet RPCs,
-- and with withdrawal/deactivation. Locks live until commit (including direct PostgREST INSERT).
create function private.validate_workout_sheet_membership() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.workout_sheets; e public.exercises; u uuid;
begin
  if new.sheet_id is null then return new; end if;
  u:=private.sheet_actor();
  if new.user_id is distinct from u then raise exception 'SHEET_NOT_FOUND'; end if;
  select * into s from public.workout_sheets where id=new.sheet_id and user_id=u for share;
  if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
  if s.archived_at is not null then raise exception 'SHEET_NOT_READY'; end if;
  select * into e from public.exercises where id=new.exercise_id and user_id=u for share;
  if e.id is null then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  perform 1 from public.exercise_catalog c where c.provider=e.provider
    and c.provider_exercise_id=e.provider_exercise_id for share;
  if not private.sheet_exercise_available(e.id,u) then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  if not exists(select 1 from public.workout_sheet_exercises
    where sheet_id=s.id and user_id=u and exercise_id=e.id) then
    raise exception 'SHEET_EXERCISE_MISMATCH';
  end if;
  return new;
end $$;
revoke all on function private.validate_workout_sheet_membership() from public,anon,authenticated;
create trigger workouts_00_validate_sheet_membership before insert on public.workouts
for each row execute function private.validate_workout_sheet_membership();

-- One bounded Home request: active planning + all-time recency + distinct activity days this
-- business month. No session completion is inferred. Archived sheets may still win the metrics.
create function public.get_my_sheet_insights() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); today date:=private.sp_today(); result jsonb;
begin
  with activity as materialized (
    select w.sheet_id, max(w.date) last_date, max(w.created_at) last_registered_at,
      count(distinct w.date) filter(where w.date>=date_trunc('month',today)::date)::int month_days
    from public.workouts w where w.user_id=u and w.sheet_id is not null and w.date<=today
    group by w.sheet_id
  ), summaries as materialized (
    select s.id,s.name,s.goal,s.weekdays,s.sort_order,s.archived_at,
      coalesce(i.exercise_count,0) exercise_count,coalesce(i.available,false) available,
      a.last_date,a.last_registered_at,coalesce(a.month_days,0) month_days
    from public.workout_sheets s left join activity a on a.sheet_id=s.id
    left join lateral (
      select count(*) exercise_count,bool_and(private.sheet_exercise_available(x.exercise_id,u)) available
      from public.workout_sheet_exercises x where x.sheet_id=s.id
    ) i on true where s.user_id=u
  ), selected as (
    (select * from summaries where archived_at is null order by sort_order,id limit 40)
    union
    (select * from summaries where last_date is not null order by last_date desc,last_registered_at desc,sort_order,id limit 1)
    union
    (select * from summaries where month_days>0 order by month_days desc,last_date desc,last_registered_at desc,sort_order,id limit 1)
  ) select jsonb_build_object('today',today,'sheets',coalesce(jsonb_agg(to_jsonb(selected) order by sort_order,id),'[]'))
    into result from selected;
  return result;
end $$;
revoke all on function public.get_my_sheet_insights() from public,anon,authenticated;
grant execute on function public.get_my_sheet_insights() to authenticated;
