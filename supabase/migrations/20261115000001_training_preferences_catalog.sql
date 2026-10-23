-- Forward-only hardening: pg_temp precedes pg_catalog for unqualified relations,
-- including in a SECURITY DEFINER with search_path=''. Preserve the full existing
-- validation/business contract, owner, grants and signature; qualify only this view.
set local lock_timeout = '5s';
do $catalog$
declare v_before text; v_after text;
begin
 v_before:=pg_get_functiondef('public.set_training_preferences(jsonb)'::regprocedure);
 v_after:=replace(v_before,'from pg_timezone_names where','from pg_catalog.pg_timezone_names where');
 if v_after=v_before and position('from pg_catalog.pg_timezone_names where' in v_before)=0 then
  raise exception 'UNEXPECTED_TRAINING_PREFERENCES_DEFINITION';
 end if;
 execute v_after;
end $catalog$;
