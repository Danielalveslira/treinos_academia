-- Additive planning only: no changes to workouts, economy, outbox or existing guards.
set local lock_timeout = '5s';

create function private.workout_sheet_limits() returns jsonb
language sql immutable set search_path = '' as $$
 select '{"active":40,"items":40,"sets":10,"duration":1440,"distance":1000}'::jsonb
$$;
revoke all on function private.workout_sheet_limits() from public, anon, authenticated;

create function private.sheet_trim(p_text text) returns text language sql immutable set search_path = '' as $$
 select regexp_replace(p_text, '^\s+|\s+$', '', 'g')
$$;
revoke all on function private.sheet_trim(text) from public,anon,authenticated;

create function private.valid_sheet_weekdays(p_days smallint[]) returns boolean
language sql immutable set search_path = '' as $$
 select p_days is not null and cardinality(p_days)<=7
 and not exists(select 1 from unnest(p_days) d where d is null or d<0 or d>6)
 and cardinality(p_days)=(select count(distinct d) from unnest(p_days) d)
$$;
revoke all on function private.valid_sheet_weekdays(smallint[]) from public, anon, authenticated;
-- Required by CHECK during privileged RPC writes only.
alter table public.exercises add constraint exercises_id_user_sheet_key unique(id,user_id);
create table public.workout_sheets (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.users(id) on delete cascade,
 name text not null check(name=private.sheet_trim(name) and char_length(name) between 1 and 80),
 goal text check(goal in ('hipertrofia','forca','resistencia','condicionamento','mobilidade','other')),
 goal_description text not null default '' check(char_length(goal_description)<=500),
 weekdays smallint[] not null default '{}' check(private.valid_sheet_weekdays(weekdays)),
 sort_order integer not null default 0 check(sort_order>=0),
 archived_at timestamptz,
 revision bigint not null default 1 check(revision>=1),
 create_request_id uuid not null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(id,user_id), unique(user_id,create_request_id)
);
create table public.workout_sheet_exercises (
 id uuid primary key default gen_random_uuid(),
 sheet_id uuid not null, user_id uuid not null, exercise_id uuid not null,
 sort_order integer not null check(sort_order>=0),
 target_sets smallint check(target_sets between 1 and 10),
 reps_min integer check(reps_min between 1 and 1000), reps_max integer check(reps_max between 1 and 1000),
 rest_seconds integer check(rest_seconds between 0 and 900),
 target_duration_minutes integer check(target_duration_minutes between 1 and 1440),
 target_distance_km numeric check(target_distance_km>0 and target_distance_km<=1000),
 note text not null default '' check(char_length(note)<=300),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(reps_min is null or reps_max is null or reps_min<=reps_max),
 foreign key(sheet_id,user_id) references public.workout_sheets(id,user_id) on delete cascade,
 foreign key(exercise_id,user_id) references public.exercises(id,user_id) on delete restrict,
 unique(sheet_id,exercise_id)
);
create index workout_sheets_list_idx on public.workout_sheets(user_id,archived_at,sort_order,id);
create index workout_sheet_items_order_idx on public.workout_sheet_exercises(sheet_id,sort_order,id);
alter table public.workout_sheets enable row level security;
alter table public.workout_sheet_exercises enable row level security;
-- has_app_access() is SECURITY DEFINER and checks current_session_active internally.
-- Do not grant direct execution of the private session helper to authenticated.
create policy sheets_read on public.workout_sheets for select to authenticated
 using(user_id=(select auth.uid()) and (select public.has_app_access()));
create policy sheet_items_read on public.workout_sheet_exercises for select to authenticated
 using(user_id=(select auth.uid()) and (select public.has_app_access()));
revoke all on public.workout_sheets,public.workout_sheet_exercises from public,anon,authenticated;
grant select on public.workout_sheets,public.workout_sheet_exercises to authenticated;

create function private.sheet_actor() returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
 if not coalesce(private.current_session_active(),false) then raise exception 'SESSION_REVOKED'; end if;
 if not coalesce(public.has_app_access(),false) then raise exception 'APP_ACCESS_DENIED'; end if;
 return auth.uid();
end $$;
revoke all on function private.sheet_actor() from public,anon,authenticated;

create function private.sheet_exercise_available(p_exercise_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.exercises e join public.exercise_catalog c
 on c.provider=e.provider and c.provider_exercise_id=e.provider_exercise_id
 and (e.catalog_id is null or e.catalog_id=c.id)
 where e.id=p_exercise_id and e.user_id=p_user_id and e.active and e.source='catalog'
 and e.provider in ('evolutus_dataset','evolutus_original') and c.status='published')
$$;
revoke all on function private.sheet_exercise_available(uuid,uuid) from public,anon,authenticated;

-- One save normalizes order, preserves stable item IDs and checks the complete payload before writes.
create function public.save_workout_sheet(p_sheet_id uuid,p_expected_revision bigint,p_metadata jsonb,p_items jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid:=private.sheet_actor(); s public.workout_sheets; r record; e public.exercises;
 c public.exercise_catalog; item public.workout_sheet_exercises; normalized jsonb:='[]';
 days smallint[]; nm text; gd text; gl text; lim jsonb:=private.workout_sheet_limits();
begin
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
 if jsonb_typeof(p_metadata) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array'
 or jsonb_array_length(p_items)>(lim->>'items')::int then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 nm:=private.sheet_trim(p_metadata->>'name'); gl:=nullif(p_metadata->>'goal',''); gd:=private.sheet_trim(coalesce(p_metadata->>'goal_description',''));
 if nm is null or char_length(nm) not between 1 and 80 or char_length(gd)>500
 or (gl is not null and gl not in ('hipertrofia','forca','resistencia','condicionamento','mobilidade','other'))
 or jsonb_typeof(p_metadata->'weekdays') is distinct from 'array' then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 select coalesce(array_agg(value::smallint order by value::smallint),'{}') into days from jsonb_array_elements_text(p_metadata->'weekdays');
 if not private.valid_sheet_weekdays(days) then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if (select count(distinct value->>'exercise_id') from jsonb_array_elements(p_items))<>jsonb_array_length(p_items) then raise exception 'SHEET_DUPLICATE_EXERCISE'; end if;
 for r in select value,ordinality from jsonb_array_elements(p_items) with ordinality loop
  if jsonb_typeof(r.value) is distinct from 'object' then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
  select * into e from public.exercises where id=(r.value->>'exercise_id')::uuid and user_id=u for share;
  if e.id is null then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  -- Existing withdrawn items stay intelligible and editable, but cannot be newly attached.
  if not private.sheet_exercise_available(e.id,u) and not exists(
   select 1 from public.workout_sheet_exercises where sheet_id=s.id and exercise_id=e.id
  ) then raise exception 'SHEET_EXERCISE_UNAVAILABLE'; end if;
  select * into c from public.exercise_catalog where provider=e.provider and provider_exercise_id=e.provider_exercise_id for share;
  item:=null;
  item.exercise_id:=e.id; item.target_sets:=(r.value->>'target_sets')::smallint;
  item.reps_min:=(r.value->>'reps_min')::int; item.reps_max:=(r.value->>'reps_max')::int;
  item.rest_seconds:=(r.value->>'rest_seconds')::int;
  item.target_duration_minutes:=(r.value->>'target_duration_minutes')::int;
  item.target_distance_km:=(r.value->>'target_distance_km')::numeric;
  item.note:=private.sheet_trim(coalesce(r.value->>'note',''));
  if (item.target_sets is not null and item.target_sets not between 1 and (lim->>'sets')::int)
  or (item.reps_min is not null and item.reps_min not between 1 and 1000)
  or (item.reps_max is not null and item.reps_max not between 1 and 1000)
  or item.reps_min>item.reps_max or char_length(item.note)>300
  or (item.rest_seconds is not null and item.rest_seconds not between 0 and 900)
  or (item.target_duration_minutes is not null and item.target_duration_minutes not between 1 and (lim->>'duration')::int)
  or (item.target_distance_km is not null and not(item.target_distance_km>0 and item.target_distance_km<=(lim->>'distance')::numeric))
  or (c.category is distinct from 'cardio' and (item.target_duration_minutes is not null or item.target_distance_km is not null))
  or (c.category='cardio' and (item.target_sets is not null or item.reps_min is not null or item.reps_max is not null))
  then raise exception 'SHEET_INVALID_TARGET'; end if;
  normalized:=normalized||jsonb_build_array(jsonb_build_object('exercise_id',e.id,'sort_order',r.ordinality-1,
   'target_sets',item.target_sets,'reps_min',item.reps_min,'reps_max',item.reps_max,'rest_seconds',item.rest_seconds,
   'target_duration_minutes',item.target_duration_minutes,'target_distance_km',item.target_distance_km,'note',item.note));
 end loop;
 if jsonb_build_object('name',s.name,'goal',s.goal,'goal_description',s.goal_description,'weekdays',to_jsonb(s.weekdays))=jsonb_build_object('name',nm,'goal',gl,'goal_description',gd,'weekdays',to_jsonb(days))
 and normalized=coalesce((select jsonb_agg(to_jsonb(x)-array['id','sheet_id','user_id','created_at','updated_at'] order by sort_order,id) from public.workout_sheet_exercises x where sheet_id=s.id),'[]')
 then return jsonb_build_object('id',s.id,'revision',s.revision); end if;
 delete from public.workout_sheet_exercises where sheet_id=s.id and exercise_id not in(select (value->>'exercise_id')::uuid from jsonb_array_elements(normalized));
 insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note)
 select s.id,u,x.exercise_id,x.sort_order,x.target_sets,x.reps_min,x.reps_max,x.rest_seconds,x.target_duration_minutes,x.target_distance_km,x.note
 from jsonb_populate_recordset(null::public.workout_sheet_exercises,normalized) x
 on conflict(sheet_id,exercise_id) do update set sort_order=excluded.sort_order,target_sets=excluded.target_sets,
 reps_min=excluded.reps_min,reps_max=excluded.reps_max,rest_seconds=excluded.rest_seconds,
 target_duration_minutes=excluded.target_duration_minutes,target_distance_km=excluded.target_distance_km,note=excluded.note,updated_at=now()
 where (public.workout_sheet_exercises.sort_order,public.workout_sheet_exercises.target_sets,public.workout_sheet_exercises.reps_min,public.workout_sheet_exercises.reps_max,public.workout_sheet_exercises.rest_seconds,public.workout_sheet_exercises.target_duration_minutes,public.workout_sheet_exercises.target_distance_km,public.workout_sheet_exercises.note) is distinct from (excluded.sort_order,excluded.target_sets,excluded.reps_min,excluded.reps_max,excluded.rest_seconds,excluded.target_duration_minutes,excluded.target_distance_km,excluded.note);
 update public.workout_sheets set name=nm,goal=gl,goal_description=gd,weekdays=days,revision=revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'revision',s.revision+1);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_parameter_value then raise exception 'SHEET_INVALID_PAYLOAD';
end $$;

create function public.create_workout_sheet(p_request_id uuid,p_name text,p_goal text default null,p_description text default '',p_weekdays smallint[] default '{}',p_items jsonb default '[]')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; result jsonb;
begin
 if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 -- Serialize per account: both retries and the active-sheet limit are race safe.
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where user_id=u and create_request_id=p_request_id;
 if s.id is not null then return jsonb_build_object('id',s.id,'revision',s.revision); end if;
 if (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 insert into public.workout_sheets(user_id,name,create_request_id,sort_order) values(u,'Rascunho',p_request_id,coalesce((select max(sort_order)+1 from public.workout_sheets where user_id=u),0)) returning * into s;
 result:=public.save_workout_sheet(s.id,s.revision,jsonb_build_object('name',p_name,'goal',p_goal,'goal_description',p_description,'weekdays',p_weekdays),p_items);
 return result;
end $$;

create function public.duplicate_workout_sheet(p_source_id uuid,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; dest public.workout_sheets;
begin
 if p_request_id is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where id=p_source_id and user_id=u for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select * into dest from public.workout_sheets where user_id=u and create_request_id=p_request_id;
 if dest.id is not null then return jsonb_build_object('id',dest.id,'revision',dest.revision); end if;
 if (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 insert into public.workout_sheets(user_id,name,goal,goal_description,weekdays,sort_order,create_request_id)
 values(u,left(s.name,72)||' (cópia)',s.goal,s.goal_description,s.weekdays,coalesce((select max(sort_order)+1 from public.workout_sheets where user_id=u),0),p_request_id) returning * into dest;
 insert into public.workout_sheet_exercises(sheet_id,user_id,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note)
 select dest.id,u,exercise_id,sort_order,target_sets,reps_min,reps_max,rest_seconds,target_duration_minutes,target_distance_km,note from public.workout_sheet_exercises where sheet_id=s.id;
 return jsonb_build_object('id',dest.id,'revision',dest.revision);
end $$;

create function public.set_workout_sheet_archived(p_sheet_id uuid,p_archived boolean,p_expected_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets;
begin
 perform 1 from public.users where id=u for update;
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u for update;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 if p_archived is null then raise exception 'SHEET_INVALID_PAYLOAD'; end if;
 if (s.archived_at is not null)=p_archived then return jsonb_build_object('id',s.id,'revision',s.revision); end if;
 if p_expected_revision is distinct from s.revision then raise exception 'SHEET_VERSION_CONFLICT'; end if;
 if not p_archived and (select count(*) from public.workout_sheets where user_id=u and archived_at is null)>=(private.workout_sheet_limits()->>'active')::int then raise exception 'SHEET_LIMIT_REACHED'; end if;
 update public.workout_sheets set archived_at=case when p_archived then now() end,revision=revision+1,updated_at=now() where id=s.id;
 return jsonb_build_object('id',s.id,'revision',s.revision+1);
end $$;

create function public.reorder_workout_sheets(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); expected uuid[];
begin
 perform 1 from public.users where id=u for update;
 select coalesce(array_agg(id order by id),'{}') into expected from public.workout_sheets where user_id=u and archived_at is null;
 if p_ids is null or cardinality(p_ids)<>(select count(distinct x) from unnest(p_ids) x)
 or expected is distinct from (select coalesce(array_agg(x order by x),'{}') from unnest(p_ids) x)
 then raise exception 'SHEET_INVALID_ORDER'; end if;
 perform 1 from public.workout_sheets where user_id=u and archived_at is null order by id for update;
 update public.workout_sheets s set sort_order=x.n-1,revision=revision+1,updated_at=now()
 from unnest(p_ids) with ordinality x(id,n) where s.id=x.id and s.user_id=u and s.sort_order<>x.n-1;
end $$;

-- Summary is one bounded query: no instructions/images or client-side N+1.
create function public.list_my_workout_sheets(p_archived boolean default false,p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order,id),'[]') into result from (
 select s.id,s.name,s.goal,s.weekdays,s.archived_at,s.revision,s.sort_order,
 (select count(*) from public.workout_sheet_exercises i where i.sheet_id=s.id) as exercise_count,
 (select array_agg(distinct e.muscle_group) from public.workout_sheet_exercises i join public.exercises e on e.id=i.exercise_id where i.sheet_id=s.id) as muscle_groups
 from public.workout_sheets s where s.user_id=u and (s.archived_at is not null)=p_archived
 order by s.sort_order,s.id limit 40 offset greatest(0,least(coalesce(p_offset,0),100000))
 ) q; return result;
end $$;

create function public.get_my_workout_sheet(p_sheet_id uuid,p_for_execution boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid:=private.sheet_actor(); s public.workout_sheets; items jsonb;
begin
 select * into s from public.workout_sheets where id=p_sheet_id and user_id=u;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i)||jsonb_build_object('available',private.sheet_exercise_available(e.id,u),
 'exercise',jsonb_build_object('id',e.id,'name',e.name,'muscleGroup',e.muscle_group,'type',e.type,'source',e.source,'active',e.active,
 'provider',e.provider,'providerExerciseId',e.provider_exercise_id,'catalogId',e.catalog_id)) order by i.sort_order,i.id),'[]') into items
 from public.workout_sheet_exercises i join public.exercises e on e.id=i.exercise_id and e.user_id=u where i.sheet_id=s.id;
 if p_for_execution and (s.archived_at is not null or jsonb_array_length(items)=0 or exists(select 1 from jsonb_array_elements(items) x where not (x->>'available')::boolean)) then raise exception 'SHEET_NOT_READY'; end if;
 return to_jsonb(s)||jsonb_build_object('items',items);
end $$;

revoke all on function public.save_workout_sheet(uuid,bigint,jsonb,jsonb),public.create_workout_sheet(uuid,text,text,text,smallint[],jsonb),public.duplicate_workout_sheet(uuid,uuid),public.set_workout_sheet_archived(uuid,boolean,bigint),public.reorder_workout_sheets(uuid[]),public.list_my_workout_sheets(boolean,integer),public.get_my_workout_sheet(uuid,boolean) from public,anon,authenticated;
grant execute on function public.save_workout_sheet(uuid,bigint,jsonb,jsonb),public.create_workout_sheet(uuid,text,text,text,smallint[],jsonb),public.duplicate_workout_sheet(uuid,uuid),public.set_workout_sheet_archived(uuid,boolean,bigint),public.reorder_workout_sheets(uuid[]),public.list_my_workout_sheets(boolean,integer),public.get_my_workout_sheet(uuid,boolean) to authenticated;

-- Existing account deletion cascades exercises before newer FK cascades may run.
-- Remove only this account's planning first; keep RESTRICT for ordinary library deletion.
create function private.delete_account_workout_sheets() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 delete from public.workout_sheets where user_id=old.id;
 return old;
end $$;
revoke all on function private.delete_account_workout_sheets() from public,anon,authenticated;
create trigger users_delete_workout_sheets before delete on public.users
for each row execute function private.delete_account_workout_sheets();
