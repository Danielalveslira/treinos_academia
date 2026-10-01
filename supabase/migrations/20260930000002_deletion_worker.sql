-- Worker de exclusão (equivalente a functions/deletion-service.js `step()` +
-- processDeletionJobs). Firestore precisava de paginação/lease/deadline porque cada
-- página é uma chamada de função separada com orçamento de tempo próprio -- Postgres
-- resolve uma conta inteira numa única transação (delete em massa, sem limite de 100
-- linhas por escrita), então a máquina de estágios vira uma função só, sem resume
-- parcial. auth.deleteUser/Storage não existem em SQL puro -- ficam na Edge Function
-- que chama esta RPC (ver supabase/functions/process-deletion-jobs).

-- Achado testando esta migration localmente (container supabase/postgres, 51 migrations
-- replayadas do zero): 4 colunas que precisam sobreviver à exclusão do usuário (a regra
-- "nunca apagar auditoria financeira/histórico" de deletion-service.js) eram NOT NULL --
-- economy_transactions.user_id tinha até ON DELETE CASCADE, ou seja, o ledger financeiro
-- seria apagado junto com a conta antes desta correção, exatamente o que o original
-- proibia. As outras (support_requests, cash_purchases, promotions) só precisavam virar
-- nullable -- FK já era NO ACTION.
alter table public.economy_transactions alter column user_id drop not null;
alter table public.economy_transactions drop constraint economy_transactions_user_id_fkey;
alter table public.economy_transactions add constraint economy_transactions_user_id_fkey
  foreign key (user_id) references public.users(id) on delete set null;

alter table public.support_requests alter column user_id drop not null;
alter table public.cash_purchases alter column user_id drop not null;
alter table public.promotions alter column owner_id drop not null;

-- Diferença deliberada do original: o Firestore não tinha FK, então excluir uma conta
-- dona de uma comunidade deixava ownerId "pendurado" silenciosamente (comunidade
-- continuava existindo, só a referência ficava órfã). Postgres tem
-- enforce_community_immutable_fields (só superadmin muda owner_id, e o worker não roda
-- numa sessão autenticada) -- em vez de contornar essa trava, o pedido é recusado aqui:
-- o admin precisa resolver a comunidade (transferir dono ou excluí-la) antes.
create or replace function public.queue_deletion(p_kind text, p_target_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
declare
  v_admin_id uuid := auth.uid();
  v_target_role text;
begin
  if not public.is_superadmin() then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_kind not in ('account', 'community', 'status') then
    raise exception 'INVALID_KIND';
  end if;
  if p_kind = 'account' and p_target_id = v_admin_id then
    raise exception 'CANNOT_DELETE_SELF';
  end if;

  if exists (select 1 from public.deletion_jobs where kind = p_kind and target_id = p_target_id) then
    return;
  end if;

  if p_kind = 'account' then
    select role into v_target_role from public.users where id = p_target_id;
    if v_target_role is null then
      raise exception 'NOT_FOUND';
    end if;
    if v_target_role = 'superadmin' then
      raise exception 'CANNOT_DELETE_ADMIN';
    end if;
    if exists (select 1 from public.communities where owner_id = p_target_id and is_active) then
      raise exception 'OWNS_ACTIVE_COMMUNITY';
    end if;
    update public.users set account_status = 'deleting' where id = p_target_id;
  elsif p_kind = 'community' then
    if not exists (select 1 from public.communities where id = p_target_id) then
      raise exception 'NOT_FOUND';
    end if;
    update public.communities set is_active = false, deletion_status = 'pending' where id = p_target_id;
  end if;

  insert into public.deletion_jobs (kind, target_id, requested_by, state, stage)
  values (p_kind, p_target_id, v_admin_id, 'pending', 0);
end;
$$;

-- Extraído de _reactivate_deletion_if_clear (20260928000001) para ser a única fonte
-- desse cálculo -- o worker usa o mesmo antes da primeira etapa destrutiva de uma conta.
create or replace function public._compute_financial_block_reason(p_user_id uuid) returns text
  language plpgsql stable as $$
declare
  v_pending_purchase boolean;
  v_cash_balance numeric;
begin
  select exists(select 1 from public.cash_purchases where user_id = p_user_id and status = 'pending')
    into v_pending_purchase;
  select cash_balance into v_cash_balance from public.wallets where user_id = p_user_id;
  return case
    when v_pending_purchase then 'pending_cash_purchase'
    when coalesce(v_cash_balance, 0) > 0 then 'positive_cash_balance'
    else null
  end;
end;
$$;

create or replace function public._reactivate_deletion_if_clear(p_user_id uuid) returns void
  language plpgsql as $$
declare
  v_reason text := public._compute_financial_block_reason(p_user_id);
begin
  if v_reason is null then
    update public.deletion_jobs set state = 'pending', block_reason = null, updated_at = now()
      where kind = 'account' and target_id = p_user_id and state = 'blocked_financial_review';
  else
    update public.deletion_jobs set block_reason = v_reason, updated_at = now()
      where kind = 'account' and target_id = p_user_id and state = 'blocked_financial_review';
  end if;
end;
$$;

-- Processa UM job inteiro (não uma página). Devolve o que a Edge Function precisa fazer
-- depois em serviços que SQL não alcança: caminhos de Storage a apagar e se o usuário do
-- Supabase Auth deve ser excluído. Nunca chamada com anon/authenticated -- só a Edge
-- Function, com a service role key.
create or replace function public.run_deletion_job(p_job_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_reason text;
  v_photo_paths text[] := '{}';
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null or v_job.state <> 'pending' then
    return jsonb_build_object('skipped', true);
  end if;

  if v_job.kind = 'account' then
    -- Portão financeiro: só antes da primeira etapa destrutiva (aqui sempre é a
    -- primeira, já que não há mais estágios parciais). Nunca reavaliado depois.
    v_reason := public._compute_financial_block_reason(v_job.target_id);
    if v_reason is not null then
      update public.deletion_jobs set state = 'blocked_financial_review', block_reason = v_reason,
        updated_at = now() where id = p_job_id;
      return jsonb_build_object('blocked', true, 'reason', v_reason);
    end if;

    -- statuses.author_id não tem cascade de users (ver auditoria de FKs) -- apagar
    -- explicitamente aqui também limpa status_votes/status_participants/
    -- status_economy_votes via cascade de statuses.id, e devolve os caminhos de foto
    -- pra Edge Function remover do Storage.
    select coalesce(array_agg(photo_path), '{}') into v_photo_paths
      from public.statuses where author_id = v_job.target_id and photo_path is not null;
    delete from public.statuses where author_id = v_job.target_id;

    -- Preserva auditoria/histórico -- nunca cascade, só remove a referência ao usuário
    -- (mesma regra de deletion-service.js: "economyTransactions NÃO entra nesta lista").
    update public.economy_transactions set user_id = null where user_id = v_job.target_id;
    update public.support_requests set user_id = null where user_id = v_job.target_id;
    update public.moderation_decisions set target_user_id = null where target_user_id = v_job.target_id;
    update public.cash_purchases set user_id = null where user_id = v_job.target_id;
    update public.cash_purchases set credited_by = null where credited_by = v_job.target_id;
    update public.cash_purchases set cancelled_by = null where cancelled_by = v_job.target_id;
    update public.promotions set owner_id = null where owner_id = v_job.target_id;
    update public.promotions set cancelled_by = null where cancelled_by = v_job.target_id;
    -- communities.owner_id/created_by NUNCA são tocados aqui -- queue_deletion já
    -- recusa o pedido (OWNS_ACTIVE_COMMUNITY) se a conta ainda for dona de uma
    -- comunidade ativa, então nenhuma linha deveria restar apontando pra este uid.
    update public.users set disabled_by = null where disabled_by = v_job.target_id;
    update public.deletion_jobs set requested_by = null where requested_by = v_job.target_id;
    update public.community_restrictions set banned_by = null where banned_by = v_job.target_id;
    update public.professional_listings set suspended_by = null where suspended_by = v_job.target_id;
    update public.deletion_financial_reviews set admin_id = null where admin_id = v_job.target_id;

    -- Sem valor de auditoria (contador de limite, pedido idempotente) -- apaga direto.
    delete from public.promotion_event_limits where user_id = v_job.target_id;
    delete from public.community_creation_requests where user_id = v_job.target_id;

    -- Todo o resto (community_members, exercises, workouts, wallets, body_measurements,
    -- professional_listings->drafts, profile_avatar_media, etc.) já é ON DELETE CASCADE
    -- de users -- ver auditoria de FKs feita antes desta migration.
    delete from public.users where id = v_job.target_id;

  elsif v_job.kind = 'community' then
    select coalesce(array_agg(photo_path), '{}') into v_photo_paths
      from public.statuses where community_id = v_job.target_id and photo_path is not null;
    -- community_members/community_restrictions/statuses já cascade de communities.id,
    -- mas apagar statuses explicitamente primeiro é o que devolve os photo_paths acima.
    delete from public.statuses where community_id = v_job.target_id;
    delete from public.communities where id = v_job.target_id;

  else -- status
    select photo_path into v_photo_paths from public.statuses where id = v_job.target_id;
    v_photo_paths := case when v_photo_paths[1] is not null then v_photo_paths else '{}' end;
    delete from public.statuses where id = v_job.target_id;
  end if;

  update public.deletion_jobs set state = 'complete', updated_at = now(),
    expire_at = case when v_job.kind <> 'account' then now() + interval '7 days' else null end
    where id = p_job_id;

  return jsonb_build_object(
    'complete', true, 'kind', v_job.kind, 'targetId', v_job.target_id,
    'photoPaths', to_jsonb(v_photo_paths), 'deleteAuthUser', v_job.kind = 'account'
  );
exception when others then
  update public.deletion_jobs set last_error = sqlerrm, updated_at = now() where id = p_job_id;
  raise;
end;
$$;
revoke execute on function public.run_deletion_job(uuid) from public, anon, authenticated;

-- Lista até 10 jobs pendentes de uma vez -- mesmo teto de processDeletionJobs original.
create or replace function public.list_pending_deletion_jobs() returns setof public.deletion_jobs
  language sql stable security definer set search_path = public as $$
  select * from public.deletion_jobs where state = 'pending' order by updated_at asc limit 10
$$;
revoke execute on function public.list_pending_deletion_jobs() from public, anon, authenticated;

-- Agendamento: a cada 1 minuto, mesma cadência do onSchedule original. A Edge Function
-- lista os jobs pendentes e chama run_deletion_job pra cada -- pg_net só entrega o
-- payload; a key usada aqui é a anon (pública por design, já embutida no bundle do
-- frontend -- nunca um secret). A Edge Function usa sua PRÓPRIA service role key (secret
-- de function, nunca exposta em SQL/migration) pra qualquer ação privilegiada
-- (auth.admin, Storage). URL/anon key do projeto são públicos, não secrets -- seguros de
-- versionar (mesmo dado que já está em VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY).
create extension if not exists pg_net;
select cron.schedule(
  'process-deletion-jobs', '* * * * *',
  $$select net.http_post(
    url := 'https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/process-deletion-jobs',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3cmpvanJqZ296ZGZwZGRra3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzA3MjYsImV4cCI6MjEwNjAwNjcyNn0.CKODsrNrIpijKaiJGk9tQbTvuw24EuctjFouaLWMPRg',
      'Content-Type', 'application/json'
    )
  )$$
);
