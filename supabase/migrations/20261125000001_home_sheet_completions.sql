-- Completion is explicit, server dated, and independent of coin amount.
set local lock_timeout = '5s';
create table public.workout_sheet_completions (
  user_id uuid not null references auth.users(id) on delete cascade,
  sheet_id uuid not null,
  business_day date not null,
  completed_at timestamptz not null default now(),
  primary key (user_id, sheet_id, business_day),
  foreign key (sheet_id,user_id) references public.workout_sheets(id,user_id) on delete cascade
);
alter table public.workout_sheet_completions enable row level security;
revoke all on public.workout_sheet_completions from public,anon,authenticated;
grant select on public.workout_sheet_completions to authenticated;
create policy own_completions on public.workout_sheet_completions for select to authenticated
  using (user_id=(select auth.uid()) and coalesce(public.has_app_access(),false));

create function public.complete_workout_sheet(p_sheet_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); d date:=private.sp_today(); s public.workout_sheets;
  reward jsonb;
begin
  -- Serialize only this user's sheet/day; existing economy engine serializes daily awards.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(u::text||':'||p_sheet_id::text||':'||d::text,0));
  select * into s from public.workout_sheets where id=p_sheet_id and user_id=u for share;
  if s.id is null then return jsonb_build_object('status','not_allowed'); end if;
  if exists(select 1 from public.workout_sheet_completions where user_id=u and sheet_id=p_sheet_id and business_day=d) then
    return jsonb_build_object('status','already_completed','awardedCoins',0,'business_day',d);
  end if;
  -- Same sheet -> library -> catalog lock order as sheet inserts.
  perform 1 from public.exercises e join public.workout_sheet_exercises x on x.exercise_id=e.id
    where x.sheet_id=s.id and e.user_id=u order by e.id for share of e;
  perform 1 from public.exercise_catalog c join public.exercises e
    on c.provider=e.provider and c.provider_exercise_id=e.provider_exercise_id
    join public.workout_sheet_exercises x on x.exercise_id=e.id
    where x.sheet_id=s.id and e.user_id=u order by c.id for share of c;
  if s.archived_at is not null or not exists(select 1 from public.workout_sheet_exercises where sheet_id=s.id)
    or exists(select 1 from public.workout_sheet_exercises x where x.sheet_id=s.id
      and not private.sheet_exercise_available(x.exercise_id,u)) then
    return jsonb_build_object('status','not_allowed');
  end if;
  -- Activity must belong to this sheet and be both dated and server-created today.
  -- Effort remains the existing daily rule (not every planned exercise is mandatory).
  if not exists(select 1 from public.workouts where user_id=u and sheet_id=p_sheet_id and date=d
    and created_at >= (d::timestamp at time zone 'America/Sao_Paulo')
    and created_at < ((d+1)::timestamp at time zone 'America/Sao_Paulo')) then
    return jsonb_build_object('status','insufficient_activity','awardedCoins',0);
  end if;
  reward:=public.complete_workout_session();
  if reward->>'reason'='not_enough_activity' then
    return reward || jsonb_build_object('status','insufficient_activity');
  end if;
  insert into public.workout_sheet_completions(user_id,sheet_id,business_day) values(u,p_sheet_id,d);
  return reward || jsonb_build_object('status','completed','business_day',d);
end $$;
revoke all on function public.complete_workout_sheet(uuid) from public,anon,authenticated;
grant execute on function public.complete_workout_sheet(uuid) to authenticated;

create or replace function public.get_my_sheet_insights() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); today date:=private.sp_today(); result jsonb;
begin
  with activity as materialized (
    select s.id sheet_id,a.date last_date,a.created_at last_registered_at,m.month_days
    from public.workout_sheets s
    left join lateral (
      select w.date,w.created_at from public.workouts w
      where w.user_id=u and w.sheet_id=s.id and w.date<=today
      order by w.date desc,w.created_at desc limit 1
    ) a on true
    left join lateral (
      select count(distinct w.date)::int month_days from public.workouts w
      where w.user_id=u and w.sheet_id=s.id
      and w.date>=date_trunc('month',today)::date and w.date<=today
    ) m on true where s.user_id=u
  ), summaries as materialized (
    select s.id,s.name,s.goal,s.weekdays,s.sort_order,s.archived_at,
      coalesce(i.exercise_count,0) exercise_count,coalesce(i.available,false) available,
      a.last_date,a.last_registered_at,coalesce(a.month_days,0) month_days,
      exists(select 1 from public.workout_sheet_completions c
        where c.user_id=u and c.sheet_id=s.id and c.business_day=today) completed_today
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
