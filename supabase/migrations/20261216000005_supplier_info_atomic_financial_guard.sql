-- Opening the supplier gate must not turn an already prepared payment path on.
-- SHARE table locks serialize the check with INSERT/UPDATE/DELETE on these
-- financial tables. Acquire them before economy_config, matching the order in
-- paid flows that read the supplier gate after their financial state.
create or replace function public.admin_set_supplier_info_configured(
  p_configured boolean, p_reason text, p_confirm boolean
) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare v_configured boolean;
begin
  perform private.require_evocash_admin(true);
  if p_confirm is distinct from true or p_configured is null or p_reason is null
     or length(btrim(p_reason)) not between 5 and 500 then
    raise exception 'INVALID_SUPPLIER_INFO_REQUEST';
  end if;

  if p_configured then
    lock table public.evocash_pricing_state in share mode;
    lock table public.commercial_offerings in share mode;
    lock table public.cash_purchases in share mode;
    if not exists (select 1 from public.evocash_pricing_state where id)
       or exists (select 1 from public.evocash_pricing_state where id and (quoting_enabled or checkout_enabled))
       or exists (select 1 from public.commercial_offerings where sales_enabled)
       or exists (select 1 from public.cash_purchases where status = 'pending') then
      raise exception 'SUPPLIER_INFO_FINANCIAL_GATES_OPEN';
    end if;
  end if;

  update public.economy_config
    set config = config || jsonb_build_object('supplierInfo',
      coalesce(config -> 'supplierInfo', '{}'::jsonb) || jsonb_build_object('configured', p_configured)),
        updated_at = clock_timestamp()
  where id
  returning (config -> 'supplierInfo' ->> 'configured')::boolean into v_configured;
  if v_configured is null then raise exception 'SUPPLIER_INFO_CONFIG_MISSING'; end if;
  insert into public.admin_audit_log(admin_user_id, action, reason, metadata)
  values(auth.uid(), 'supplier_info_gate_changed', btrim(p_reason),
    jsonb_build_object('configured', v_configured));
  return jsonb_build_object('configured', v_configured);
end $$;
