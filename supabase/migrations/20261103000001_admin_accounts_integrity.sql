-- Defensive account operations. No changes to roles, retention or deletion workers.
-- Status locks the target before validating; bulk locks UUIDs in stable order.
-- Repeated deletion wrappers serialize their existence check and audit.

create or replace function public.set_account_status(p_user_id uuid, p_disabled boolean, p_reason text default '')
  returns table (id uuid, email text, username text, role text, account_status text, disabled_reason text, created_at timestamptz)
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_target_role text;
  v_previous_status text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  select u.role, u.account_status into v_target_role, v_previous_status from public.users u where u.id = p_user_id for update;
  if v_target_role is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target_role = 'superadmin' then
    raise exception 'CANNOT_DISABLE_ADMIN';
  end if;
  if v_previous_status = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;
  if p_disabled is null then raise exception 'INVALID_ARGUMENT'; end if;
  if char_length(coalesce(p_reason, '')) > 500 then raise exception 'INVALID_REASON'; end if;
  if p_disabled and (char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500) then
    raise exception 'INVALID_REASON';
  end if;

  if (v_previous_status = 'disabled') is distinct from p_disabled then
  update public.users set
    account_status = case when p_disabled then 'disabled' else 'active' end,
    disabled_at = case when p_disabled then now() else null end,
    disabled_by = case when p_disabled then auth.uid() else null end,
    disabled_reason = case when p_disabled then trim(p_reason) else null end
  where public.users.id = p_user_id;

    insert into public.admin_audit_log (admin_user_id, target_user_id, action, reason, metadata)
    values (
      auth.uid(), p_user_id,
      case when p_disabled then 'account_disabled' else 'account_reactivated' end,
      nullif(trim(coalesce(p_reason, '')), ''),
      jsonb_build_object('previous_status', v_previous_status)
    );
  end if;

  return query
    select u.id, au.email::text, u.username, u.role, u.account_status, u.disabled_reason, u.created_at
    from public.users u join auth.users au on au.id = u.id
    where u.id = p_user_id;
end;
$$;

-- ============================================================================
-- Ação em lote: reutiliza set_account_status por conta (mesmas regras e mesma auditoria);
-- uma falha individual não aborta as demais. 1 chamada de rede para N contas.
-- ============================================================================

create or replace function public.admin_set_accounts_status(p_user_ids uuid[], p_disabled boolean, p_reason text default '')
  returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_row record;
  v_results jsonb := '[]'::jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_user_ids is null or cardinality(p_user_ids) = 0 or cardinality(p_user_ids) > 100 or array_ndims(p_user_ids) <> 1 or array_position(p_user_ids, null) is not null or p_disabled is null then
    raise exception 'INVALID_ARGUMENT';
  end if;

  for v_id in select distinct x from unnest(p_user_ids) as x order by x loop
    begin
      select * into v_row from public.set_account_status(v_id, p_disabled, p_reason);
      v_results := v_results || jsonb_build_object(
        'id', v_id, 'ok', true,
        'account_status', v_row.account_status, 'disabled_reason', v_row.disabled_reason
      );
    exception when others then
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'error', case when sqlerrm in ('PERMISSION_DENIED','NOT_FOUND','CANNOT_DISABLE_ADMIN','ACCOUNT_DELETING','INVALID_REASON','INVALID_ARGUMENT') then sqlerrm else 'ACTION_FAILED' end);
    end;
  end loop;

  return v_results;
end;
$$;
revoke execute on function public.admin_set_accounts_status(uuid[], boolean, text) from public, anon;
grant execute on function public.admin_set_accounts_status(uuid[], boolean, text) to authenticated;

-- ============================================================================
-- Exclusão: o fluxo continua sendo queue_deletion (worker, revisão financeira, cancelamento);
-- este wrapper só acrescenta o motivo e a auditoria. Chamar de novo para uma conta que já
-- tem exclusão em andamento é no-op (como queue_deletion) e não duplica o registro.
-- ============================================================================

create or replace function public.admin_request_account_deletion(p_user_id uuid, p_reason text)
  returns void
  language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_existed boolean;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500 then
    raise exception 'INVALID_REASON';
  end if;

  -- Serialize repeated requests through this audited wrapper, including absent jobs.
  perform pg_advisory_xact_lock(hashtextextended('admin-account-deletion:' || p_user_id::text, 0));
  v_existed := exists (
    select 1 from public.deletion_jobs where kind = 'account' and target_id = p_user_id and state <> 'cancelled'
  );
  perform public.queue_deletion('account', p_user_id);

  if not v_existed then
    insert into public.admin_audit_log (admin_user_id, target_user_id, action, reason, metadata)
    values (
      auth.uid(), p_user_id, 'account_deletion_requested', trim(p_reason),
      (select jsonb_build_object('protocol', j.protocol, 'previous_status', j.previous_account_status)
         from public.deletion_jobs j where j.kind = 'account' and j.target_id = p_user_id)
    );
  end if;
end;
$$;
revoke execute on function public.admin_request_account_deletion(uuid, text) from public, anon;
grant execute on function public.admin_request_account_deletion(uuid, text) to authenticated;


revoke execute on function public.set_account_status(uuid, boolean, text) from public, anon;
grant execute on function public.set_account_status(uuid, boolean, text) to authenticated;

-- Explicit NULL must not bypass the audit log limit.
create or replace function public.admin_list_audit_log(p_target_user_id uuid default null, p_limit integer default 50)
  returns jsonb
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'INVALID_ARGUMENT';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id,
      'action', l.action,
      'reason', l.reason,
      'metadata', l.metadata,
      'created_at', l.created_at,
      'admin_user_id', l.admin_user_id,
      'admin_username', a.username,
      'target_user_id', l.target_user_id,
      'target_username', t.username
    ) order by l.created_at desc, l.id)
    from (
      select * from public.admin_audit_log
      where p_target_user_id is null or target_user_id = p_target_user_id
      order by created_at desc, id
      limit p_limit
    ) l
    left join public.users a on a.id = l.admin_user_id
    left join public.users t on t.id = l.target_user_id
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_list_audit_log(uuid, integer) from public, anon;
grant execute on function public.admin_list_audit_log(uuid, integer) to authenticated;
