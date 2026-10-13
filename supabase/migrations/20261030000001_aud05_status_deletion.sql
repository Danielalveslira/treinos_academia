-- AUD-05: fix only the individual-status photo array. Preserve deployed ACL/search_path,
-- account financial retention, transaction/error handling, cascades and AUD-04 outbox.
set local lock_timeout='5s';
CREATE OR REPLACE FUNCTION public.run_deletion_job(p_job_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_job public.deletion_jobs;
  v_reason text;
  v_photo_paths text[] := '{}';
  v_case public.account_financial_cases;
  v_error text;
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null then
    return jsonb_build_object('skipped', true);
  end if;

  -- Banco já limpo, só falta confirmar a remoção no Auth: nenhuma tabela é tocada (nem a
  -- exclusão financeira nem nada é repetido) -- só reentrega à Edge Function o que falta.
  if v_job.kind = 'account' and v_job.state = 'auth_cleanup' then
    return jsonb_build_object(
      'authPending', true, 'retry', true, 'kind', 'account', 'targetId', v_job.target_id,
      'photoPaths', '[]'::jsonb, 'deleteAuthUser', true
    );
  end if;
  if v_job.state <> 'pending' then
    return jsonb_build_object('skipped', true);
  end if;

  begin
    if v_job.kind = 'account' then
      if v_job.financial_case_id is null then
        v_reason := public._compute_financial_block_reason(v_job.target_id);
        if v_reason is not null then
          update public.deletion_jobs set state = 'blocked_financial_review', block_reason = v_reason,
            updated_at = now() where id = p_job_id;
          return jsonb_build_object('blocked', true, 'reason', v_reason);
        end if;
      else
        select * into v_case from public.account_financial_cases where id = v_job.financial_case_id for update;
        if v_case.status <> 'open' then
          raise exception 'FINANCIAL_CASE_NOT_OPEN';
        end if;
        update public.economy_transactions set financial_case_id = v_case.id
          where user_id = v_job.target_id and financial_case_id is null;
        update public.cash_purchases set financial_case_id = v_case.id
          where user_id = v_job.target_id and financial_case_id is null;
        insert into public.account_financial_case_items (case_id, ledger_id)
          select v_case.id, id from public.economy_transactions where user_id = v_job.target_id
          on conflict do nothing;
        insert into public.account_financial_case_items (case_id, purchase_id)
          select v_case.id, id from public.cash_purchases where user_id = v_job.target_id
          on conflict do nothing;
        update public.account_financial_cases set
          cash_balance_final = coalesce((select cash_balance from public.wallets where user_id = v_job.target_id), 0),
          finalized_at = now()
          where id = v_case.id;
      end if;

      select coalesce(array_agg(photo_path), '{}') into v_photo_paths
        from public.statuses where author_id = v_job.target_id and photo_path is not null;
      delete from public.statuses where author_id = v_job.target_id;

      update public.economy_transactions set user_id = null where user_id = v_job.target_id;
      update public.support_requests set user_id = null where user_id = v_job.target_id;
      update public.moderation_decisions set target_user_id = null where target_user_id = v_job.target_id;
      update public.cash_purchases set user_id = null where user_id = v_job.target_id;
      update public.cash_purchases set credited_by = null where credited_by = v_job.target_id;
      update public.cash_purchases set cancelled_by = null where cancelled_by = v_job.target_id;
      update public.promotions set owner_id = null where owner_id = v_job.target_id;
      update public.promotions set cancelled_by = null where cancelled_by = v_job.target_id;
      update public.users set disabled_by = null where disabled_by = v_job.target_id;
      update public.deletion_jobs set requested_by = null where requested_by = v_job.target_id;
      update public.community_restrictions set banned_by = null where banned_by = v_job.target_id;
      update public.professional_listings set suspended_by = null where suspended_by = v_job.target_id;
      update public.deletion_financial_reviews set admin_id = null where admin_id = v_job.target_id;

      delete from public.promotion_event_limits where user_id = v_job.target_id;
      delete from public.community_creation_requests where user_id = v_job.target_id;

      delete from public.users where id = v_job.target_id;

    elsif v_job.kind = 'community' then
      select coalesce(array_agg(photo_path), '{}') into v_photo_paths
        from public.statuses where community_id = v_job.target_id and photo_path is not null;
      delete from public.statuses where community_id = v_job.target_id;
      delete from public.communities where id = v_job.target_id;

    else -- status
      -- Build an array without casting a scalar path; NULL/missing rows produce [].
      select coalesce(array_agg(photo_path), '{}'::text[]) into v_photo_paths
        from public.statuses where id = v_job.target_id and photo_path is not null;
      delete from public.statuses where id = v_job.target_id;
    end if;

    -- Conta: o banco está limpo, mas o job só vira 'complete' quando o Auth for confirmado.
    update public.deletion_jobs set
      state = case when v_job.kind = 'account' then 'auth_cleanup' else 'complete' end,
      last_error = null, updated_at = now(),
      expire_at = case when v_job.kind <> 'account' then now() + interval '7 days' else null end
      where id = p_job_id;

    return jsonb_build_object(
      'complete', v_job.kind <> 'account', 'authPending', v_job.kind = 'account',
      'kind', v_job.kind, 'targetId', v_job.target_id,
      'photoPaths', to_jsonb(v_photo_paths), 'deleteAuthUser', v_job.kind = 'account'
    );
  exception when others then
    -- A sub-transação acima (todas as escritas do corpo) já foi desfeita; só o diagnóstico
    -- é gravado, e a função retorna normalmente para a transação externa commitá-lo.
    v_error := left(sqlstate || ': ' || sqlerrm, 500);
    update public.deletion_jobs set last_error = v_error, updated_at = now() where id = p_job_id;
    return jsonb_build_object('error', true, 'message', v_error);
  end;
end;
$function$;
notify pgrst, 'reload schema';
