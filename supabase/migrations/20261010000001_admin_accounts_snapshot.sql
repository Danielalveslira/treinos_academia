-- Tela admin "Contas": um snapshot consolidado por clique em "Atualizar" + leituras sob demanda.
--
-- Reaproveita o que já existe: autorização = public.is_superadmin() (mesma fonte de verdade
-- de admin_list_accounts/set_account_status), exclusão = public.queue_deletion + deletion_jobs
-- (nenhum fluxo paralelo), status = public.users.account_status + account_restrictions.
--
--   admin_accounts_snapshot()       1 RPC = métricas + lista (teto de 1000 contas) + meta
--   admin_account_communities(uid)  sob demanda (aba Comunidades do painel)
--   admin_account_financial(uid)    sob demanda (aba Financeiro do painel)
--   admin_list_audit_log(uid, n)    sob demanda (aba Auditoria / Logs administrativos)
--   admin_set_accounts_status(...)  desativar/reativar 1..100 contas (1 escrita), com auditoria
--   admin_request_account_deletion  queue_deletion + auditoria (motivo obrigatório)
--
-- Auditoria: ainda não existia trilha das ações de conta (set_account_status só gravava o
-- último estado na própria linha de users). admin_audit_log é append-only. RETENÇÃO PENDENTE
-- DE DEFINIÇÃO (jurídico) -- como em account_financial_cases, nada apaga linhas daqui e a
-- tabela guarda só uuids + motivo (nunca e-mail/nome), então sobrevive à exclusão da conta.

-- ============================================================================
-- Auditoria administrativa
-- ============================================================================

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null,
  target_user_id uuid,
  action text not null check (char_length(action) between 1 and 60),
  reason text check (reason is null or char_length(reason) <= 500),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index admin_audit_log_target_created_idx on public.admin_audit_log(target_user_id, created_at desc);
create index admin_audit_log_created_idx on public.admin_audit_log(created_at desc);
alter table public.admin_audit_log enable row level security;
-- Sem policy nenhuma (padrão server_only): só as RPCs security definer abaixo leem/escrevem.

create or replace function public._forbid_admin_audit_log_change() returns trigger
  language plpgsql as $$
begin
  raise exception 'ADMIN_AUDIT_LOG_IMMUTABLE';
end;
$$;
create trigger admin_audit_log_immutable before update or delete on public.admin_audit_log
  for each row execute function public._forbid_admin_audit_log_change();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
  for each statement execute function public._forbid_admin_audit_log_change();

-- ============================================================================
-- set_account_status: mesma assinatura/retorno, agora com auditoria e sem reativar conta
-- em exclusão (reativar sobrescreveria 'deleting' e abortaria a exclusão por fora do fluxo
-- de cancelamento, que é quem restaura previous_account_status).
-- ============================================================================

create or replace function public.set_account_status(p_user_id uuid, p_disabled boolean, p_reason text default '')
  returns table (id uuid, email text, username text, role text, account_status text, disabled_reason text, created_at timestamptz)
  language plpgsql security definer set search_path = public as $$
declare
  v_target_role text;
  v_previous_status text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  select u.role, u.account_status into v_target_role, v_previous_status from public.users u where u.id = p_user_id;
  if v_target_role is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_target_role = 'superadmin' then
    raise exception 'CANNOT_DISABLE_ADMIN';
  end if;
  if v_previous_status = 'deleting' then
    raise exception 'ACCOUNT_DELETING';
  end if;
  if p_disabled and (char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500) then
    raise exception 'INVALID_REASON';
  end if;

  update public.users set
    account_status = case when p_disabled then 'disabled' else 'active' end,
    disabled_at = case when p_disabled then now() else null end,
    disabled_by = case when p_disabled then auth.uid() else null end,
    disabled_reason = case when p_disabled then trim(p_reason) else null end
  where public.users.id = p_user_id;

  if (v_previous_status = 'disabled') is distinct from p_disabled then
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
  language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_row record;
  v_results jsonb := '[]'::jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_user_ids is null or coalesce(array_length(p_user_ids, 1), 0) = 0 or array_length(p_user_ids, 1) > 100 then
    raise exception 'INVALID_ARGUMENT';
  end if;

  for v_id in select distinct x from unnest(p_user_ids) as x loop
    begin
      select * into v_row from public.set_account_status(v_id, p_disabled, p_reason);
      v_results := v_results || jsonb_build_object(
        'id', v_id, 'ok', true,
        'account_status', v_row.account_status, 'disabled_reason', v_row.disabled_reason
      );
    exception when others then
      v_results := v_results || jsonb_build_object('id', v_id, 'ok', false, 'error', sqlerrm);
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
  language plpgsql security definer set search_path = public as $$
declare
  v_existed boolean;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) < 5 or char_length(p_reason) > 500 then
    raise exception 'INVALID_REASON';
  end if;

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

-- ============================================================================
-- Snapshot
-- ============================================================================
-- status derivado (precedência): deleting > disabled > suspended > active
--   deleting  = account_status 'deleting' OU job de exclusão aberto
--   suspended = restrição de moderação vigente (mesmo critério de has_app_access)
-- Métricas cobrem TODAS as contas; só a lista é truncada em p_max (meta.truncated).
-- Contagens por conta são agregadas uma única vez, restritas aos ids da página (sem N+1).
-- flags_count = decisões de moderação contra a conta (advertência, remoção de conteúdo,
-- suspensão, banimento); no_action/restore não contam.

create or replace function public.admin_accounts_snapshot() returns jsonb
  language plpgsql stable security definer set search_path = public as $$
declare
  c_max constant integer := 1000;
  v_result jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;

  with base as (
    select
      u.id, u.username, u.role, u.created_at, u.legal_acceptance_version, u.disabled_reason,
      r.action as restriction_action, r.until as restriction_until,
      j.state as job_state,
      case
        when u.account_status = 'deleting' or j.state is not null then 'deleting'
        when u.account_status = 'disabled' then 'disabled'
        when r.user_id is not null then 'suspended'
        else 'active'
      end as status
    from public.users u
    left join public.account_restrictions r
      on r.user_id = u.id and not (r.action = 'temporary_suspension' and r.until <= now())
    left join public.deletion_jobs j
      on j.kind = 'account' and j.target_id = u.id
     and j.state in ('pending', 'blocked_financial_review', 'auth_cleanup')
  ),
  metrics as (
    select
      count(*) as total_accounts,
      count(*) filter (where status = 'active') as active_accounts,
      count(*) filter (where status = 'suspended') as suspended_accounts,
      count(*) filter (where created_at >= now() - interval '7 days') as new_accounts_7d,
      count(*) filter (where job_state is not null) as pending_deletions
    from base
  ),
  page as (
    select * from base order by created_at desc, id limit c_max
  ),
  community_counts as (
    select m.user_id, count(*) as total
    from public.community_members m
    where m.user_id in (select id from page)
    group by m.user_id
  ),
  flag_counts as (
    select d.target_user_id as user_id, count(*) as total
    from public.moderation_decisions d
    where d.target_user_id in (select id from page) and d.action not in ('no_action', 'restore')
    group by d.target_user_id
  ),
  pending_purchases as (
    select distinct p.user_id
    from public.cash_purchases p
    where p.status = 'pending' and p.user_id in (select id from page)
  ),
  listings as (
    select l.owner_id, l.lifecycle_state
    from public.professional_listings l
    where l.owner_id in (select id from page)
  ),
  rows_json as (
    select jsonb_agg(
      jsonb_build_object(
        'id', p.id,
        'username', p.username,
        'email', au.email,
        'role', p.role,
        'status', p.status,
        'created_at', p.created_at,
        'last_sign_in_at', au.last_sign_in_at,
        'community_count', coalesce(cc.total, 0),
        'financial_status', case
          when pp.user_id is not null or p.job_state = 'blocked_financial_review' then 'pending'
          when coalesce(w.cash_balance, 0) > 0 then 'balance'
          else 'none'
        end,
        'flags_count', coalesce(fc.total, 0),
        'showcase_status', coalesce(l.lifecycle_state, 'none'),
        'deletion_status', coalesce(p.job_state, 'none'),
        'accepted_legal_version', p.legal_acceptance_version,
        'disabled_reason', case when p.status = 'disabled' then p.disabled_reason end,
        -- Restrição vigente mesmo com a conta desativada/em exclusão: o cliente precisa dela para
        -- derivar o status certo ao reativar localmente (desativada + restrição => suspensa).
        'restriction_action', p.restriction_action,
        'restriction_until', p.restriction_until
      )
      order by p.created_at desc, p.id
    ) as accounts
    from page p
    join auth.users au on au.id = p.id
    left join community_counts cc on cc.user_id = p.id
    left join flag_counts fc on fc.user_id = p.id
    left join pending_purchases pp on pp.user_id = p.id
    left join public.wallets w on w.user_id = p.id
    left join listings l on l.owner_id = p.id
  )
  select jsonb_build_object(
    'generated_at', now(),
    'metrics', (select to_jsonb(metrics) from metrics),
    'accounts', coalesce((select accounts from rows_json), '[]'::jsonb),
    'meta', jsonb_build_object(
      'total', (select total_accounts from metrics),
      'returned', coalesce(jsonb_array_length((select accounts from rows_json)), 0),
      'truncated', (select total_accounts from metrics) > c_max,
      'max_snapshot_rows', c_max
    )
  )
  into v_result;

  return v_result;
end;
$$;
revoke execute on function public.admin_accounts_snapshot() from public, anon;
grant execute on function public.admin_accounts_snapshot() to authenticated;

-- ============================================================================
-- Leituras sob demanda (painel da conta) -- nunca entram no snapshot
-- ============================================================================

create or replace function public.admin_account_communities(p_user_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'is_owner', c.owner_id = p_user_id,
      'is_active', c.is_active,
      'member_count', c.member_count,
      'joined_at', m.joined_at
    ) order by m.joined_at desc)
    from (
      select * from public.community_members where user_id = p_user_id order by joined_at desc limit 100
    ) m
    join public.communities c on c.id = m.community_id
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_account_communities(uuid) from public, anon;
grant execute on function public.admin_account_communities(uuid) to authenticated;

-- Resumo financeiro (saldos + últimas 5 compras). O histórico completo e os casos
-- financeiros continuam no painel "Exclusão de contas".
create or replace function public.admin_account_financial(p_user_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  return jsonb_build_object(
    'coin_balance', coalesce((select w.coin_balance from public.wallets w where w.user_id = p_user_id), 0),
    'cash_balance', coalesce((select w.cash_balance from public.wallets w where w.user_id = p_user_id), 0),
    'recent_purchases', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'status', p.status, 'cash_amount', p.cash_amount,
        'amount_centavos', p.amount_centavos, 'created_at', p.created_at
      ) order by p.created_at desc)
      from (
        select * from public.cash_purchases where user_id = p_user_id order by created_at desc limit 5
      ) p
    ), '[]'::jsonb),
    'deletion', (
      select jsonb_build_object(
        'protocol', j.protocol, 'state', j.state, 'block_reason', j.block_reason,
        'financial_case_protocol', c.protocol
      )
      from public.deletion_jobs j
      left join public.account_financial_cases c on c.id = j.financial_case_id
      where j.kind = 'account' and j.target_id = p_user_id and j.state not in ('complete', 'cancelled')
    )
  );
end;
$$;
revoke execute on function public.admin_account_financial(uuid) from public, anon;
grant execute on function public.admin_account_financial(uuid) to authenticated;

create or replace function public.admin_list_audit_log(p_target_user_id uuid default null, p_limit integer default 50)
  returns jsonb
  language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_limit < 1 or p_limit > 100 then
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
