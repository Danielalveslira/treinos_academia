-- Pipeline ÚNICO de notificações: qualquer feature cria uma linha em `notifications` (fonte de
-- verdade); este arquivo centraliza (1) o catálogo que decide categoria/urgência/TTL do Push,
-- (2) os produtores de eventos que ainda não geravam notificação e (3) o rastreio ponta a ponta.
--
--   evento -> notifications -> Realtime (sino)
--                           -> trigger único (enqueue_notification_push) -> outbox -> worker -> Web Push
--
-- Nenhum produtor chama Push diretamente, e uma falha ao gerar a notificação NUNCA derruba a ação
-- principal (curtir, pagar, moderar): cada produtor isola o erro com `exception when others`.

-- 1) Tipos sem status_id (economia, moderação, resolução de denúncia) além dos admin_*.
alter table public.notifications drop constraint if exists notifications_status_required_chk;
alter table public.notifications add constraint notifications_status_required_chk
  check (status_id is not null or type::text like 'admin\_%'
    or type::text in ('economy_credit', 'economy_debit', 'moderation_notice', 'report_resolved'));

-- 2) Categoria "economy" (preferências por categoria continuam possíveis: chave ausente = ligada).
alter table public.notification_push_outbox drop constraint if exists notification_push_outbox_category_check;
alter table public.notification_push_outbox add constraint notification_push_outbox_category_check
  check (category in ('social', 'communities', 'economy', 'workouts', 'account', 'administrative'));
alter table public.push_notification_preferences alter column categories set default
  '{"social":true,"communities":true,"economy":true,"workouts":true,"account":true,"administrative":true}'::jsonb;

-- 3) Catálogo: UMA tabela decide se o tipo gera Push, a categoria, a urgência e o TTL. Adicionar um
-- evento novo = inserir uma linha aqui (e o produtor que cria a notification), sem tocar no worker.
create table if not exists private.notification_catalog (
  type text primary key,
  category text not null check (category in ('social', 'communities', 'economy', 'workouts', 'account', 'administrative')),
  push boolean not null default true,
  urgency text not null default 'normal' check (urgency in ('very-low', 'low', 'normal', 'high')),
  ttl_seconds integer not null default 86400 check (ttl_seconds between 60 and 2419200)
);
-- Urgência `high` acorda aparelhos Android em Doze (o Push "normal" pode esperar horas por uma janela de
-- manutenção); curtidas são o único evento social que aceita `normal`. TTL de 24h: aparelho offline
-- recebe ao voltar (antes eram 1h, e depois disso o provedor descartava a mensagem em silêncio).
insert into private.notification_catalog (type, category, push, urgency, ttl_seconds) values
  ('post_reply', 'social', true, 'high', 86400),
  ('comment_reply', 'social', true, 'high', 86400),
  ('comment_mention', 'social', true, 'high', 86400),
  ('comment_like', 'social', true, 'normal', 86400),
  ('post_like', 'social', true, 'normal', 86400),
  ('economy_credit', 'economy', true, 'normal', 86400),
  ('economy_debit', 'economy', true, 'normal', 86400),
  ('moderation_notice', 'account', true, 'high', 604800),
  ('report_resolved', 'account', true, 'normal', 604800),
  ('admin_report', 'administrative', true, 'high', 86400),
  ('admin_appeal', 'administrative', true, 'high', 86400),
  ('admin_privacy_request', 'administrative', true, 'high', 86400),
  ('admin_moderation_decision', 'administrative', true, 'normal', 86400),
  ('admin_restriction', 'administrative', true, 'high', 86400),
  ('admin_deletion_review', 'administrative', true, 'high', 86400),
  ('admin_broadcast', 'administrative', true, 'high', 86400)
on conflict (type) do update set category = excluded.category, push = excluded.push,
  urgency = excluded.urgency, ttl_seconds = excluded.ttl_seconds;

-- O trigger único já chama esta função: agora ela lê o catálogo (tipo fora do catálogo: admin_*
-- continua administrativo, o resto não gera Push).
create or replace function private.notification_push_category(p_type public.notification_type) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when exists (select 1 from private.notification_catalog c where c.type = p_type::text)
      then (select c.category from private.notification_catalog c where c.type = p_type::text and c.push)
    when p_type::text like 'admin\_%' then 'administrative'
    else null
  end
$$;
revoke execute on function private.notification_push_category(public.notification_type) from public, anon, authenticated;

-- 4) Claim: devolve urgência e TTL do catálogo para o worker (mesma lógica de elegibilidade/idempotência).
drop function if exists public.claim_push_jobs(text, integer);
create or replace function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text,
  urgency text, ttl_seconds integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if p_worker_id is null or char_length(p_worker_id) > 100 then raise exception 'INVALID_WORKER'; end if;
  update public.notification_push_outbox set status = 'pending', locked_at = null, locked_by = null
    where status = 'processing' and locked_at < now() - interval '10 minutes';
  with picked as (
    select o.id from public.notification_push_outbox o
    where o.status = 'pending' and o.next_attempt_at <= now()
    order by o.next_attempt_at, o.created_at
    for update skip locked limit least(greatest(p_limit, 1), 100)
  )
  update public.notification_push_outbox o set status = 'processing', locked_at = now(), locked_by = p_worker_id,
      attempt_count = o.attempt_count + 1
  from picked where o.id = picked.id;

  -- Destinatário desativado/em exclusão ou com Push/categoria desligados desde o enfileiramento.
  with ineligible as (
    update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
      last_error = 'RECIPIENT_NOT_ELIGIBLE'
    where o.status = 'processing' and o.locked_by = p_worker_id and not exists (
      select 1 from public.users u
      join public.push_notification_preferences p on p.user_id = u.id and p.enabled
      where u.id = o.user_id and u.account_status not in ('disabled','deleting')
        and private.push_category_enabled(p.categories, o.category))
    returning o.id
  )
  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'RECIPIENT_NOT_ELIGIBLE'
  from ineligible i where d.outbox_id = i.id and d.status = 'pending';

  -- Entrega pendente cuja subscription foi revogada ou passou para outra conta.
  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'SUBSCRIPTION_UNAVAILABLE'
  from public.notification_push_outbox o
  where d.outbox_id = o.id and o.status = 'processing' and o.locked_by = p_worker_id and d.status = 'pending'
    and not exists (
      select 1 from public.push_subscriptions s
      where s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null);

  insert into public.notification_push_deliveries (outbox_id, notification_id, subscription_id)
    select o.id, o.notification_id, s.id from public.notification_push_outbox o
    join public.push_subscriptions s on s.user_id = o.user_id and s.revoked_at is null
    where o.status = 'processing' and o.locked_by = p_worker_id
    on conflict on constraint notification_push_delivery_subscription_key do nothing;

  -- Sem nenhuma entrega pendente o job termina aqui (nunca volta para a fila).
  update public.notification_push_outbox o set
    status = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then 'sent'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed','expired')) then 'failed'
      else 'cancelled' end,
    sent_at = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent')
      then coalesce(o.sent_at, now()) else o.sent_at end,
    last_error = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed','expired')) then 'DELIVERY_FAILURE'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then null
      else 'NO_ACTIVE_SUBSCRIPTIONS' end,
    locked_at = null, locked_by = null
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending');

  -- Só há retries futuros: devolve à fila para o horário do próximo (sem esperar o lock expirar).
  update public.notification_push_outbox o set status = 'pending', locked_at = null, locked_by = null,
    next_attempt_at = (select min(d.next_attempt_at) from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending')
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now());

  return query
  select o.id, d.id, o.notification_id, s.id, s.endpoint, s.p256dh, s.auth,
    n.type::text, p.username,
    private.safe_push_target_url(case
      when n.comment_id is not null and n.status_id is not null and st.community_id is not null
        then '/comunidades/' || st.community_id::text || '/publicacoes/' || n.status_id::text || '/comentarios/' || n.comment_id::text
      else n.action_url end),
    n.metadata, n.priority,
    coalesce(cat.urgency, 'normal'), coalesce(cat.ttl_seconds, 86400)
  from public.notification_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.statuses st on st.id = n.status_id
  left join private.notification_catalog cat on cat.type = n.type::text
  left join public.public_profiles p on p.user_id = n.actor_id
  join public.notification_push_deliveries d on d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now()
  join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null
  where o.status = 'processing' and o.locked_by = p_worker_id;
end;
$$;
revoke execute on function public.claim_push_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text, integer) to service_role;

-- 5) Produtores. Todos criam `notifications`; Realtime e Push saem do pipeline único.

-- 5.1) Curtida em PUBLICAÇÃO (voto 👍). 👎, voto removido ou trocado cancelam o alerta. Link: a âncora
-- do card na comunidade (#publicacao-<id>; #treino-<id> para Treino Marcado).
create or replace function private.notify_post_like() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_status public.statuses; v_key text; v_author uuid; v_actor uuid; v_status_id uuid;
begin
  begin
    if tg_op = 'DELETE' then
      v_author := old.author_id; v_actor := old.user_id; v_status_id := old.status_id;
    else
      v_author := new.author_id; v_actor := new.user_id; v_status_id := new.status_id;
    end if;
    v_key := 'post-like:' || v_status_id::text || ':' || v_actor::text;
    if tg_op = 'DELETE' or new.value is distinct from 1 then
      delete from public.notifications where recipient_id = v_author and dedupe_key = v_key;
    elsif v_author is not null and v_author <> v_actor then
      select * into v_status from public.statuses where id = v_status_id;
      if found and v_status.community_id is not null then
        insert into public.notifications (recipient_id, actor_id, type, priority, status_id, entity_type, entity_id, action_url, dedupe_key)
        values (v_author, v_actor, 'post_like', 'normal', v_status_id, 'status', v_status_id,
          '/comunidades/' || v_status.community_id::text
            || case when v_status.type = 'workout' then '#treino-' else '#publicacao-' end || v_status_id::text,
          v_key)
        on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
      end if;
    end if;
  exception when others then
    raise warning '[Notifications] post_like skipped (%)', sqlstate;
  end;
  return coalesce(new, old);
end;
$$;
revoke execute on function private.notify_post_like() from public, anon, authenticated;
drop trigger if exists status_economy_votes_notify_like on public.status_economy_votes;
create trigger status_economy_votes_notify_like
after insert or update of value or delete on public.status_economy_votes
for each row execute function private.notify_post_like();

-- 5.2) Economia: UM trigger na ledger (ponto único de créditos/débitos). O valor vem da linha
-- confirmada no banco, nunca do cliente. Rotinas automáticas ficam de fora (já aparecem na carteira e
-- no aviso de moedas do app, e as reações já têm a notificação social): editar `v_silent` aqui.
create or replace function private.notify_economy_transaction() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_silent text[] := array['post_published', 'comment_posted', 'vote_reward', 'vote_charge',
    'daily_activity', 'workout_completed', 'promotion_purchase'];
begin
  if new.reason = any (v_silent) or new.reason like 'zz\_%' or new.amount is null or new.amount <= 0 then
    return new;
  end if;
  begin
    insert into public.notifications (recipient_id, type, priority, entity_type, entity_id, action_url, metadata, dedupe_key)
    values (new.user_id,
      (case when new.direction = 'credit' then 'economy_credit' else 'economy_debit' end)::public.notification_type,
      'normal', 'economy_transaction', new.id, '/evocash',
      jsonb_build_object('asset', new.asset, 'amount', new.amount, 'reason', new.reason),
      'economy:' || coalesce(new.natural_key, new.id::text))
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  exception when others then
    raise warning '[Notifications] economy skipped (%)', sqlstate;
  end;
  return new;
end;
$$;
revoke execute on function private.notify_economy_transaction() from public, anon, authenticated;
drop trigger if exists economy_transactions_notify on public.economy_transactions;
create trigger economy_transactions_notify after insert on public.economy_transactions
for each row execute function private.notify_economy_transaction();

-- 5.3) Moderação: `notices` é o canal atual de avisos ao usuário afetado (aviso, remoção, suspensão,
-- banimento, restauração). A notificação carrega só a AÇÃO (e a data de término); regra, motivo e
-- evidência continuam apenas na tela de Atendimento.
create or replace function private.notify_moderation_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.notifications (recipient_id, type, priority, entity_type, entity_id, action_url, metadata, dedupe_key)
    values (new.user_id, 'moderation_notice',
      case when new.action in ('warning', 'restore') then 'normal' else 'high' end,
      'notice', new.id, '/atendimento',
      jsonb_strip_nulls(jsonb_build_object('action', new.action, 'until', new.until)),
      'notice:' || new.id::text)
    on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
  exception when others then
    raise warning '[Notifications] moderation notice skipped (%)', sqlstate;
  end;
  return new;
end;
$$;
revoke execute on function private.notify_moderation_notice() from public, anon, authenticated;
drop trigger if exists notices_notify on public.notices;
create trigger notices_notify after insert on public.notices
for each row execute function private.notify_moderation_notice();

-- 5.4) Quem abriu a denúncia/recurso/solicitação é avisado quando o caso é encerrado (sem expor a decisão).
create or replace function private.notify_support_closed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.user_id is not null then
      insert into public.notifications (recipient_id, type, priority, entity_type, entity_id, action_url, metadata, dedupe_key)
      values (new.user_id, 'report_resolved', 'normal', 'support_request', new.id, '/atendimento',
        jsonb_build_object('kind', new.kind), 'support:' || new.id::text)
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing;
    end if;
  exception when others then
    raise warning '[Notifications] support closed skipped (%)', sqlstate;
  end;
  return new;
end;
$$;
revoke execute on function private.notify_support_closed() from public, anon, authenticated;
drop trigger if exists support_requests_notify_closed on public.support_requests;
create trigger support_requests_notify_closed after update of state on public.support_requests
for each row when (old.state = 'open' and new.state = 'closed')
execute function private.notify_support_closed();

-- 6) Rastreio ponta a ponta de cada job (para superadmin e service_role): notificação, job,
-- destinatário, dispositivo (id curto + provedor + plataforma, NUNCA o endpoint), status,
-- tentativas, resposta HTTP do provedor, erro sanitizado e horários.
create or replace function public.admin_push_job_trace(p_notification_id bigint default null, p_limit integer default 50)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (coalesce(public.is_superadmin(), false) or coalesce((select auth.role()), '') = 'service_role') then
    raise exception 'PERMISSION_DENIED';
  end if;
  return coalesce((
    select jsonb_agg(t order by t.created_at desc)
    from (
      select o.id as job_id, o.notification_id, n.type::text as notification_type, o.user_id as recipient_id,
        o.category, o.status as job_status, o.attempt_count, o.created_at, o.next_attempt_at, o.sent_at, o.last_error,
        coalesce((
          select jsonb_agg(jsonb_build_object(
            'subscription', left(d.subscription_id::text, 8),
            'provider', split_part(split_part(s.endpoint, '//', 2), '/', 1),
            'platform', s.platform,
            'status', d.status, 'attempts', d.attempt_count, 'http_status', d.last_http_status,
            'error', d.last_error, 'sent_at', d.sent_at, 'next_attempt_at', d.next_attempt_at)
            order by d.created_at)
          from public.notification_push_deliveries d
          join public.push_subscriptions s on s.id = d.subscription_id
          where d.outbox_id = o.id), '[]'::jsonb) as deliveries
      from public.notification_push_outbox o
      join public.notifications n on n.id = o.notification_id
      where p_notification_id is null or o.notification_id = p_notification_id
      order by o.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) t), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_push_job_trace(bigint, integer) from public, anon;
grant execute on function public.admin_push_job_trace(bigint, integer) to authenticated, service_role;
