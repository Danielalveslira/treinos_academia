-- Project the new contracted period's fresh allowance before the first pause.
-- Reject execution with targets from an incompatible official category; the saved
-- prescription remains untouched for the editor to resolve.
create or replace function public.get_advertising_campaigns(p_account uuid default null, p_after uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.ad_id desc) from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,
 (r.advertiser_paused_at is not null) as advertiser_paused,e.starts_at,e.expires_at,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 0 else r.advertiser_pause_count end as pauses_used,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 3 else 3 - r.advertiser_pause_count end as pauses_available,
 case when r.moderation_state = 'suspended'
   then private.advertising_suspension_origin(r.id, d.account_id) else null end as suspension_origin,
 case when r.moderation_state = 'suspended'
   then (select o.reason from public.advertising_operations o
     where o.resource_id = r.id and o.action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
     order by o.id desc limit 1) else null end as suspension_reason,
 case when private.commercial_resource_visible(r.id) then 'active' when e.expires_at<=statement_timestamp() then 'expired' else 'private' end delivery_state,
 greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::bigint remaining_seconds,
 (a.owner_user_id=auth.uid()) as can_pay,
 (select jsonb_agg(jsonb_build_object('code',i.placement_code,'context',i.context_id)) from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placements,
 (select bool_or(private.advertising_eligible(d.ad_id,i.placement_code,i.context_id))
  from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placement_delivery_active,
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 order by d.ad_id desc limit 20)x),'[]'::jsonb);
end $$;

create or replace function public.get_my_workout_sheet(p_sheet_id uuid, p_for_execution boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); s public.workout_sheets; items jsonb;
begin
 select * into s from public.workout_sheets where id = p_sheet_id and user_id = u and deleted_at is null;
 if s.id is null then raise exception 'SHEET_NOT_FOUND'; end if;
 select coalesce(jsonb_agg(to_jsonb(i) || jsonb_build_object(
   'available', e.active and e.source = 'catalog'
     and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null,
   'exercise', jsonb_build_object(
     'id', e.id,
     'name', coalesce(c.name, e.name),
     'muscleGroup', coalesce(c.primary_muscle, e.muscle_group),
     'type', case when c.id is not null then (case when c.category = 'cardio' then 'cardio' else 'strength' end) else e.type end,
     'source', e.source, 'active', e.active,
     'provider', e.provider, 'providerExerciseId', e.provider_exercise_id, 'catalogId', e.catalog_id,
     -- Explicit, read-only signal: the official category changed to/from cardio after this
     -- target was recorded under the previous shape. The stored target stays untouched;
     -- execution is blocked below until the editor resolves the incompatibility.
     'typeMismatch', c.id is not null and (
       (c.category = 'cardio' and (i.target_sets is not null or i.reps_min is not null or i.reps_max is not null))
       or (c.category <> 'cardio' and (i.target_duration_minutes is not null or i.target_distance_km is not null))
     )
   )) order by i.sort_order, i.id), '[]') into items
 from public.workout_sheet_exercises i
 join public.exercises e on e.id = i.exercise_id and e.user_id = u
 left join public.exercise_catalog c on c.provider = e.provider and c.provider_exercise_id = e.provider_exercise_id
   and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
 where i.sheet_id = s.id;
 if p_for_execution and (s.archived_at is not null or jsonb_array_length(items) = 0 or exists(select 1 from jsonb_array_elements(items) x where not (x->>'available')::boolean or coalesce((x->'exercise'->>'typeMismatch')::boolean, false))) then raise exception 'SHEET_NOT_READY'; end if;
 return to_jsonb(s) || jsonb_build_object('items', items);
end $$;

-- One aggregate per sheet supplies both the live muscle groups and the readiness flag.
-- The already joined catalog row also detects incompatible targets, without a function
-- lookup for each individual exercise in the list.
create or replace function public.list_my_workout_sheets(p_archived boolean default false, p_offset integer default 0) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid := private.sheet_actor(); result jsonb;
begin
 select coalesce(jsonb_agg(to_jsonb(q) order by sort_order, id), '[]') into result from (
 select s.id, s.name, s.goal, s.weekdays, s.archived_at, s.revision, s.sort_order,
   coalesce(i.exercise_count, 0) as exercise_count, i.muscle_groups,
   coalesce(i.available, false) as available
 from public.workout_sheets s
 left join lateral (
   select count(*) exercise_count,
     array_agg(distinct coalesce(c.primary_muscle, e.muscle_group)) muscle_groups,
     bool_and(e.active and e.source = 'catalog'
       and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null
       and not (c.category = 'cardio' and
         (x.target_sets is not null or x.reps_min is not null or x.reps_max is not null))
       and not (c.category <> 'cardio' and
         (x.target_duration_minutes is not null or x.target_distance_km is not null))) available
   from public.workout_sheet_exercises x
   join public.exercises e on e.id = x.exercise_id and e.user_id = u
   left join public.exercise_catalog c on c.provider = e.provider
     and c.provider_exercise_id = e.provider_exercise_id
     and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
   where x.sheet_id = s.id
 ) i on true
 where s.user_id = u and s.deleted_at is null and (s.archived_at is not null) = p_archived
 order by s.sort_order, s.id limit 40 offset greatest(0, least(coalesce(p_offset, 0), 100000))
 ) q; return result;
end $$;


-- Home and the exercise picker use the same readiness decision as the sheet list.
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
    ) m on true where s.user_id=u and s.deleted_at is null
  ), summaries as materialized (
    select s.id,s.name,s.goal,s.weekdays,s.sort_order,s.archived_at,
      coalesce(i.exercise_count,0) exercise_count,coalesce(i.available,false) available,
      a.last_date,a.last_registered_at,coalesce(a.month_days,0) month_days,
      exists(select 1 from public.workout_sheet_completions c
        where c.user_id=u and c.sheet_id=s.id and c.business_day=today) completed_today
    from public.workout_sheets s left join activity a on a.sheet_id=s.id
    left join lateral (
      select count(*) exercise_count,
        bool_and(e.active and e.source = 'catalog'
          and e.provider in ('evolutus_dataset', 'evolutus_original') and c.id is not null
          and not (c.category = 'cardio' and
            (x.target_sets is not null or x.reps_min is not null or x.reps_max is not null))
          and not (c.category <> 'cardio' and
            (x.target_duration_minutes is not null or x.target_distance_km is not null))) available
      from public.workout_sheet_exercises x
      join public.exercises e on e.id = x.exercise_id and e.user_id = u
      left join public.exercise_catalog c on c.provider = e.provider
        and c.provider_exercise_id = e.provider_exercise_id
        and (e.catalog_id is null or e.catalog_id = c.id) and c.status = 'published'
      where x.sheet_id = s.id
    ) i on true where s.user_id=u and s.deleted_at is null
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
