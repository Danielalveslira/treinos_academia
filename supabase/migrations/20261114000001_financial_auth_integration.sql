-- Financial/auth integration, forward-only. No balances/history are rewritten.
set local lock_timeout = '5s';
-- CASE guarantees that malformed claims cannot be cast before the format check.
create or replace function private.current_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from auth.sessions s
  where s.id = case when (auth.jwt()->>'session_id') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   then (auth.jwt()->>'session_id')::uuid else null end
  and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
$$;
revoke all on function private.current_session_active() from public,anon,authenticated;
-- Jobs keep using private.user_app_access(user_id) without an online session:
-- a valid delayed business event may be settled after its author logs out.
create or replace function public.has_app_access() returns boolean
language sql stable security definer set search_path = '' as $$
 select case when not private.current_session_active() then false else (
select
      u.account_status <> 'deleting'
      and (u.role = 'superadmin' or u.account_status <> 'disabled')
      and (u.role = 'superadmin' or public.email_verified_ok(u.id))
      and (
        not exists (select 1 from public.legal_policy where id and published)
        or (u.legal_acceptance_version = (select version from public.legal_policy where id)
            and u.legal_acceptance_digest = (select digest from public.legal_policy where id))
      )
      and not exists (
        select 1 from public.account_restrictions r
        where r.user_id = auth.uid()
          and not (r.action = 'temporary_suspension' and r.until <= now())
      )
    from public.users u where u.id = auth.uid()
 ) end
$$;
-- Guard RPCs whose original contract only checked auth.uid(), not app access.
do $guard$
declare f record; v_definition text;
begin
 for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prosecdef and p.prokind='f'
  and has_function_privilege('authenticated',p.oid,'execute') and not has_function_privilege('anon',p.oid,'execute')
  and p.proname<>'admin_set_accounts_status'
  and (p.proname in ('get_my_wallet','get_my_evocoin_day','cancel_my_cash_purchase','queue_deletion','sync_workout_mutations','set_community_member_ban')
       or p.prosrc ~ '(public[.]is_superadmin|public[.]_wallet_|public[.]_ledger_record|private[.]award_evocoins)')
 loop
  v_definition := pg_get_functiondef(f.oid);
  if position('begin' in lower(v_definition))=0 then raise exception 'UNEXPECTED_RPC_LANGUAGE'; end if;
  v_definition := replace(v_definition,'  if not coalesce(private.current_session_active(), false) then raise exception ''SESSION_REVOKED''; end if;','');
  if position('if auth.uid() is not null and not private.current_session_active()' in v_definition)=0 then
  v_definition := regexp_replace(v_definition,'\mbegin\M',E'begin\n  if auth.uid() is not null and not private.current_session_active() then raise exception ''SESSION_REVOKED''; end if;','i');
  end if;
  execute v_definition;
 end loop;
end $guard$;
-- Keep original ownership/visibility rules; only revoked sessions lose access.
alter policy wallets_select on public.wallets using (user_id=auth.uid() and public.is_session_active());
alter policy economy_transactions_select on public.economy_transactions using ((user_id=auth.uid() or public.is_superadmin()) and public.is_session_active());
alter policy economy_daily_select on public.economy_daily using ((user_id=auth.uid() or public.is_superadmin()) and public.is_session_active());
alter policy cash_purchases_select on public.cash_purchases using ((user_id=auth.uid() or public.is_superadmin()) and public.is_session_active());
alter policy promotions_select on public.promotions using ((owner_id=auth.uid() or public.is_superadmin()) and public.is_session_active());
create or replace function public.set_training_preferences(payload jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_days jsonb;
  v_enabled boolean;
  v_legacy text;
  v_timezone text;
  v_effective_from date;
  v_times jsonb;
  v_current jsonb;
  v_result jsonb;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_key text;
  v_value jsonb;
begin
  if auth.uid() is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not coalesce(public.has_app_access(),false) then raise exception 'FORBIDDEN'; end if;
  if payload is null or jsonb_typeof(payload) is distinct from 'object' then
    raise exception 'INVALID_TRAINING_PREFERENCES';
  end if;
  v_days := payload->'plannedTrainingDays';
  if jsonb_typeof(v_days) is distinct from 'array'
     or jsonb_array_length(v_days) > 7
     or exists (select 1 from jsonb_array_elements(v_days) item
       where jsonb_typeof(item) <> 'string' or item #>> '{}' <> all(v_names))
     or (select count(*) from jsonb_array_elements_text(v_days)) <>
        (select count(distinct value) from jsonb_array_elements_text(v_days)) then
    raise exception 'INVALID_TRAINING_DAYS';
  end if;
  if jsonb_typeof(payload->'reminderEnabled') is distinct from 'boolean' then
    raise exception 'INVALID_REMINDER';
  end if;
  v_enabled := (payload->>'reminderEnabled')::boolean;
  v_legacy := nullif(payload->>'reminderTime', '');
  if v_legacy is not null and v_legacy !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
    raise exception 'INVALID_REMINDER_TIME';
  end if;
  v_timezone := nullif(trim(payload->>'timezone'), '');
  if v_timezone is null or not exists (select 1 from pg_timezone_names where name = v_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  begin
    v_effective_from := (payload->>'effectiveFrom')::date;
  exception when others then
    raise exception 'INVALID_EFFECTIVE_DATE';
  end;
  if v_effective_from is null then raise exception 'INVALID_EFFECTIVE_DATE'; end if;

  select training_preferences into v_current from public.users where id = auth.uid() for update;
  if payload ? 'weeklyTimes' then
    v_times := payload->'weeklyTimes';
    if jsonb_typeof(v_times) is distinct from 'object' then
      raise exception 'INVALID_WEEKLY_TIMES';
    end if;
  else
    -- Older clients may still submit a global time. Preserve customized weekly values;
    -- use the legacy time only to initialize newly selected days.
    v_times := case when jsonb_typeof(v_current->'weeklyTimes') = 'object'
      then v_current->'weeklyTimes' else '{}'::jsonb end;
    if v_enabled and v_legacy is null and v_times = '{}'::jsonb then
      raise exception 'INVALID_REMINDER_TIME';
    end if;
    for i in 1..7 loop
      if v_days ? v_names[i] and not v_times ? i::text and v_legacy is not null then
        v_times := v_times || jsonb_build_object(i::text, v_legacy);
      end if;
    end loop;
  end if;
  -- Removing a training day also removes its clock preference.
  for v_key, v_value in select key, value from jsonb_each(v_times) loop
    if v_key !~ '^[1-7]$' or not v_days ? v_names[case when v_key ~ '^[1-7]$' then v_key::int else 1 end]
       or jsonb_typeof(v_value) <> 'string'
       or v_value #>> '{}' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      if payload ? 'weeklyTimes' then raise exception 'INVALID_WEEKLY_TIME'; end if;
      v_times := v_times - v_key;
    end if;
  end loop;
  v_result := jsonb_build_object(
    'plannedTrainingDays', v_days, 'reminderEnabled', v_enabled,
    'reminderTime', coalesce(v_current->'reminderTime', to_jsonb(v_legacy)),
    'weeklyTimes', v_times, 'timezone', v_timezone,
    'effectiveFrom', to_char(v_effective_from, 'YYYY-MM-DD'), 'updatedAt', to_jsonb(now())
  );
  update public.users set training_preferences = v_result where id = auth.uid();
  return v_result;
end;
$$;
revoke all on function public.set_training_preferences(jsonb) from public,anon;
grant execute on function public.set_training_preferences(jsonb) to authenticated;

-- Explicit closure also converges harmless trigger-only ACL drift from the managed environment.
revoke all on function public._touch_exercise_catalog_updated_at() from public,anon,authenticated;
revoke all on function public.enforce_partner_product_image() from public,anon,authenticated;
revoke all on public.cash_purchase_reminder_emails from public,anon;
revoke insert,update,delete,truncate on public.cash_purchase_reminder_emails from authenticated,service_role;
