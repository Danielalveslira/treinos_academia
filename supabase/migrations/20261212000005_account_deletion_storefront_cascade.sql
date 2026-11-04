-- Achado: product_storefronts.owner_user_id e private.commercial_resources.owner_user_id
-- usam ON DELETE SET NULL (precisa sobreviver -- commercial_orders não tem cascade pro
-- resource, pra nunca perder o registro financeiro de uma visibilidade já paga). Na
-- prática, excluir a conta do dono NÃO deixa a vitrine publicamente visível de novo
-- (private.live_storefronts já exige join em public.users com account_status='active',
-- que falha assim que a linha do usuário é apagada) -- mas o conteúdo pessoal (nome,
-- descrição, contato, produtos, mídia) nunca era removido: ficava retido indefinidamente,
-- órfão, no banco e no Storage. run_deletion_job passa a eliminar esse conteúdo
-- explicitamente; o anchor em commercial_resources só é arquivado (nunca apagado), porque
-- commercial_orders/visibility_entitlements/commercial_order_events continuam
-- referenciando-o sem cascade -- apagar o anchor quebraria o histórico financeiro.
--
-- Mesma lacuna em communities.cover_path: nenhum gatilho enfileirava a limpeza do arquivo
-- no Storage quando a comunidade era excluída (statuses.photo_path já era capturado,
-- cover_path não). E o outbox genérico (storage_cleanup_tasks) só aceitava os buckets
-- 'status-photos'/'profile-avatars' -- storefront-media e community-covers nunca
-- couberam nele.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- 1. Amplia o outbox genérico para os dois buckets que faltavam. object_key aceita o
-- formato de duas partes (storefront-media: "{storefrontId}/{mediaId}.webp") e o de uma
-- parte só (community-covers: "{communityId}.webp", sem dono -- um arquivo por comunidade).
alter table public.storage_cleanup_tasks drop constraint storage_cleanup_tasks_bucket_check;
alter table public.storage_cleanup_tasks add constraint storage_cleanup_tasks_bucket_check
  check (bucket in ('status-photos', 'profile-avatars', 'storefront-media', 'community-covers'));

alter table public.storage_cleanup_tasks drop constraint storage_cleanup_tasks_object_key_check;
alter table public.storage_cleanup_tasks add constraint storage_cleanup_tasks_object_key_check
  check (object_key is null or object_key ~
    '^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.webp$');

-- 2. capture_deleted_photo_cleanup ganha dois ramos novos, dispatch por tg_table_name
-- (mesmo padrão dos dois existentes). storefront_media.storage_path já tem o formato
-- exato garantido pelo próprio CHECK da tabela -- nunca a forma "statusPhotos/..." dos
-- status antigos, então reference sempre bate com o v_expected calculado aqui.
create or replace function public.capture_deleted_photo_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_bucket text;
  v_reference text;
  v_expected text;
  v_key text;
begin
  if tg_table_name = 'statuses' then
    v_bucket := 'status-photos';
    v_reference := old.photo_path;
    v_expected := old.community_id::text || '/' || old.id::text || '.webp';
    if v_reference in (v_expected, 'statusPhotos/' || v_expected) then v_key := v_expected; end if;
  elsif tg_table_name = 'profile_avatar_media' then
    v_bucket := 'profile-avatars';
    v_reference := old.storage_path;
    v_expected := old.owner_id::text || '/' || old.id::text || '.webp';
    if v_reference = v_expected then v_key := v_expected; end if;
  elsif tg_table_name = 'storefront_media' then
    v_bucket := 'storefront-media';
    v_reference := old.storage_path;
    v_expected := old.storefront_id::text || '/' || old.id::text || '.webp';
    if v_reference = v_expected then v_key := v_expected; end if;
  else -- communities (cover_path)
    v_bucket := 'community-covers';
    v_reference := old.cover_path;
    v_expected := old.id::text || '.webp';
    if v_reference = v_expected then v_key := v_expected; end if;
  end if;
  if v_reference is not null then
    insert into public.storage_cleanup_tasks (bucket, reference, object_key, source_id, state, last_error)
    values (v_bucket, v_reference, v_key, old.id,
      case when v_key is null then 'failed' else 'pending' end,
      case when v_key is null then 'INVALID_REFERENCE' end)
    on conflict (bucket, reference) do nothing;
  end if;
  return old;
end;
$$;

create trigger storefront_media_storage_cleanup after delete on public.storefront_media
for each row execute function public.capture_deleted_photo_cleanup();

-- cover_path costuma ser null (capa é opcional) -- a função já ignora v_reference null.
create trigger community_cover_storage_cleanup after delete on public.communities
for each row execute function public.capture_deleted_photo_cleanup();

-- 3. run_deletion_job (conta): remove o conteúdo pessoal de cada vitrine do titular antes
-- do delete final em public.users. Ordem obrigatória por causa das FKs sem cascade:
-- storefront_published_products/storefront_publications (referenciam storefront_media e
-- partner_products) -> zera logo_media_id -> partner_products -> storefront_media (dispara
-- o novo trigger acima) -> product_storefronts. O anchor em private.commercial_resources
-- nunca é apagado (commercial_orders não tem cascade pra ele); só vira 'archived', o que
-- também já tira a vitrine de private.live_storefronts (exige moderation_state='approved').
create or replace function public.run_deletion_job(p_job_id uuid) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare
  v_job public.deletion_jobs;
  v_reason text;
  v_photo_paths text[] := '{}';
  v_case public.account_financial_cases;
  v_error text;
  v_storefront_id uuid;
begin
  select * into v_job from public.deletion_jobs where id = p_job_id for update;
  if v_job is null then
    return jsonb_build_object('skipped', true);
  end if;

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

      -- Conteúdo pessoal das vitrines do titular (ver auditoria desta migration): removido
      -- explicitamente, nunca por cascade -- o anchor em commercial_resources só arquiva.
      for v_storefront_id in
        select id from public.product_storefronts where owner_user_id = v_job.target_id
      loop
        delete from public.storefront_published_products where storefront_id = v_storefront_id;
        delete from public.storefront_publications where storefront_id = v_storefront_id;
        update public.product_storefronts set logo_media_id = null where id = v_storefront_id;
        delete from public.partner_products where storefront_id = v_storefront_id;
        delete from public.storefront_media where storefront_id = v_storefront_id;
        delete from public.product_storefronts where id = v_storefront_id;
        update private.commercial_resources set moderation_state = 'archived'
          where id = v_storefront_id and moderation_state <> 'archived';
      end loop;

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
      select photo_path into v_photo_paths from public.statuses where id = v_job.target_id;
      v_photo_paths := case when v_photo_paths[1] is not null then v_photo_paths else '{}' end;
      delete from public.statuses where id = v_job.target_id;
    end if;

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
    v_error := left(sqlstate || ': ' || sqlerrm, 500);
    update public.deletion_jobs set last_error = v_error, updated_at = now() where id = p_job_id;
    return jsonb_build_object('error', true, 'message', v_error);
  end;
end;
$$;
revoke execute on function public.run_deletion_job(uuid) from public, anon, authenticated;
