-- Telemetria da "última milha" do Web Push. Mede, por ENTREGA (um Push para um aparelho), onde o
-- tempo passa depois de a notificação existir: worker -> Push Service -> Service Worker -> tela.
-- Nada aqui altera quando, para quem ou com que urgência/TTL um Push é enviado.
--
-- Modelo de segurança:
--  * o identificador usado fora do banco é um token opaco de 256 bits gerado no claim, entregue ao
--    worker, embutido no payload CRIPTOGRAFADO do Push (só o aparelho o lê) e guardado AQUI apenas
--    como hash SHA-256. Endpoint, p256dh, auth, VAPID e conteúdo da notificação nunca entram;
--  * o Service Worker não tem sessão: ele chama `push_delivery_ack(token, evento)` como `anon`. A
--    função só avança UMA coluna de tempo de UMA entrega (a do token), com o relógio do servidor, e
--    nunca devolve se o token existe (resposta idêntica para qualquer entrada);
--  * as colunas de tempo do worker (`worker_started_at`, `provider_accepted_at`) só chegam por
--    `finish_push_batch`, exclusivo do service_role.

alter table public.notification_push_deliveries
  add column if not exists ack_token_hash bytea,
  add column if not exists claimed_at timestamptz,
  add column if not exists worker_started_at timestamptz,
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists sw_received_at timestamptz,
  add column if not exists show_resolved_at timestamptz,
  add column if not exists show_failed_at timestamptz,
  add column if not exists show_failure text,
  add column if not exists clicked_at timestamptz;

alter table public.notification_push_deliveries drop constraint if exists notification_push_deliveries_telemetry_chk;
alter table public.notification_push_deliveries add constraint notification_push_deliveries_telemetry_chk check (
  (ack_token_hash is null or octet_length(ack_token_hash) = 32)
  and (show_failure is null or show_failure ~ '^[A-Za-z]{1,40}$')
  and (last_http_status is null or last_http_status between 100 and 599));

create unique index if not exists notification_push_deliveries_ack_token_key
  on public.notification_push_deliveries (ack_token_hash) where ack_token_hash is not null;

-- Relógio informado pelo worker: aceita só horários plausíveis (±1h/+1min); qualquer outra coisa
-- (texto inválido incluso) vira nulo em vez de derrubar o lote inteiro.
create or replace function private.push_clock(p_value text) returns timestamptz
language plpgsql stable set search_path = '' as $$
declare v timestamptz;
begin
  v := p_value::timestamptz;
  if v between now() - interval '1 hour' and now() + interval '1 minute' then return v; end if;
  return null;
exception when others then
  return null;
end;
$$;
revoke execute on function private.push_clock(text) from public, anon, authenticated;

-- claim_push_jobs: mesma seleção, elegibilidade e retries; a diferença é que cada entrega devolvida
-- recebe um token novo (hash guardado) e `claimed_at`, e os tempos da tentativa anterior são zerados.
-- O tipo de retorno ganha `ack_token`, então a função precisa ser recriada.
drop function if exists public.claim_push_jobs(text, integer);
create function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text, urgency text, ttl_seconds integer,
  variant integer, group_count integer, ack_token text
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

  with ineligible as (
    update public.notification_push_outbox o set status = 'cancelled', locked_at = null, locked_by = null,
      last_error = 'RECIPIENT_NOT_ELIGIBLE'
    where o.status = 'processing' and o.locked_by = p_worker_id and not exists (
      select 1 from public.users u
      join public.push_notification_preferences p on p.user_id = u.id and p.enabled
      where u.id = o.user_id and u.account_status not in ('disabled', 'deleting')
        and (o.critical or private.push_category_enabled(p.categories, o.category)))
    returning o.id
  )
  update public.notification_push_deliveries d set status = 'cancelled', last_error = 'RECIPIENT_NOT_ELIGIBLE'
  from ineligible i where d.outbox_id = i.id and d.status = 'pending';

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

  update public.notification_push_outbox o set
    status = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then 'sent'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed', 'expired')) then 'failed'
      else 'cancelled' end,
    sent_at = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent')
      then coalesce(o.sent_at, now()) else o.sent_at end,
    last_error = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed', 'expired')) then 'DELIVERY_FAILURE'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then null
      else 'NO_ACTIVE_SUBSCRIPTIONS' end,
    locked_at = null, locked_by = null
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending');

  update public.notification_push_outbox o set status = 'pending', locked_at = null, locked_by = null,
    next_attempt_at = (select min(d.next_attempt_at) from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending')
  where o.status = 'processing' and o.locked_by = p_worker_id
    and not exists (select 1 from public.notification_push_deliveries d
      where d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now());

  return query
  with base as (
    select o.id as x_job, d.id as x_delivery, o.notification_id as x_notification, s.id as x_subscription,
      s.endpoint as x_endpoint, s.p256dh as x_p256dh, s.auth as x_auth,
      n.type::text as x_type, p.username as x_actor,
      private.safe_push_target_url(case
        when n.comment_id is not null and n.status_id is not null and st.community_id is not null
          then '/comunidades/' || st.community_id::text || '/publicacoes/' || n.status_id::text || '/comentarios/' || n.comment_id::text
        else n.action_url end) as x_url,
      n.metadata as x_metadata, n.priority as x_priority,
      coalesce(cat.urgency, 'normal') as x_urgency, coalesce(cat.ttl_seconds, 86400) as x_ttl,
      o.variant as x_variant, o.coalesced_count as x_group
    from public.notification_push_outbox o
    join public.notifications n on n.id = o.notification_id
    left join public.statuses st on st.id = n.status_id
    left join private.notification_catalog cat on cat.type = n.type::text
    left join public.public_profiles p on p.user_id = n.actor_id
    join public.notification_push_deliveries d on d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now()
    join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null
    where o.status = 'processing' and o.locked_by = p_worker_id
  ),
  stamped as (
    update public.notification_push_deliveries d set
      ack_token_hash = sha256(convert_to(t.tok, 'utf8')),
      claimed_at = clock_timestamp(),
      worker_started_at = null, provider_accepted_at = null,
      sw_received_at = null, show_resolved_at = null, show_failed_at = null, show_failure = null, clicked_at = null
    from (select b.x_delivery as did, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '') as tok from base b) t
    where d.id = t.did
    returning d.id as sid, t.tok as stok
  )
  select b.x_job, b.x_delivery, b.x_notification, b.x_subscription, b.x_endpoint, b.x_p256dh, b.x_auth,
    b.x_type, b.x_actor, b.x_url, b.x_metadata, b.x_priority, b.x_urgency, b.x_ttl, b.x_variant, b.x_group,
    st2.stok
  from base b join stamped st2 on st2.sid = b.x_delivery;
end;
$$;
revoke execute on function public.claim_push_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_push_jobs(text, integer) to service_role;

-- finish_push_batch: igual ao anterior, mais os tempos do worker e o código HTTP REAL do Push Service.
create or replace function public.finish_push_batch(p_worker_id text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_delay interval;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 500 then raise exception 'INVALID_RESULTS'; end if;
  for r in select * from jsonb_to_recordset(p_results) as x(
    delivery_id uuid, outcome text, http_status integer, error text,
    worker_started_at text, provider_accepted_at text)
  loop
    if r.delivery_id is null then raise exception 'INVALID_RESULTS'; end if;
    if r.outcome is null or r.outcome not in ('sent','expired','transient','permanent') then raise exception 'INVALID_OUTCOME'; end if;
    select case d.attempt_count when 0 then interval '1 minute' when 1 then interval '5 minutes'
      when 2 then interval '15 minutes' else interval '1 hour' end into v_delay
    from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
    where d.id = r.delivery_id and o.locked_by = p_worker_id and o.status = 'processing';
    update public.notification_push_deliveries d set
      attempt_count = d.attempt_count + 1,
      status = case when r.outcome = 'sent' then 'sent' when r.outcome = 'expired' then 'expired'
        when r.outcome = 'permanent' or d.attempt_count + 1 >= 6 then 'failed' else 'pending' end,
      next_attempt_at = case when r.outcome = 'transient' and d.attempt_count + 1 < 6 then now() + v_delay else d.next_attempt_at end,
      last_http_status = case when r.http_status between 100 and 599 then r.http_status end,
      last_error = left(r.error, 500),
      sent_at = case when r.outcome = 'sent' then now() else d.sent_at end,
      worker_started_at = private.push_clock(r.worker_started_at),
      provider_accepted_at = case when r.outcome = 'sent' then private.push_clock(r.provider_accepted_at) end
    from public.notification_push_outbox o
    where d.id = r.delivery_id and o.id = d.outbox_id and o.locked_by = p_worker_id and o.status = 'processing'
      and d.status = 'pending';
  end loop;

  update public.push_subscriptions s set
    revoked_at = case when d.status = 'expired' then now() else s.revoked_at end,
    failure_count = case when d.status = 'sent' then 0 else s.failure_count + 1 end,
    last_failure_at = case when d.status = 'sent' then s.last_failure_at else now() end,
    updated_at = now()
  from public.notification_push_deliveries d join public.notification_push_outbox o on o.id = d.outbox_id
  where s.id = d.subscription_id and o.locked_by = p_worker_id and d.id in (
    select (x->>'delivery_id')::uuid from jsonb_array_elements(p_results) x
  );

  update public.notification_push_outbox o set
    status = case
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending') then 'pending'
      when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent') then 'sent'
      else 'failed' end,
    next_attempt_at = coalesce((select min(d.next_attempt_at) from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending'), o.next_attempt_at),
    sent_at = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'sent')
      and not exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status = 'pending') then now() else o.sent_at end,
    last_error = case when exists (select 1 from public.notification_push_deliveries d where d.outbox_id = o.id and d.status in ('failed','expired')) then 'DELIVERY_FAILURE' else null end,
    locked_at = null, locked_by = null
  where o.locked_by = p_worker_id and o.status = 'processing';
end;
$$;
revoke execute on function public.finish_push_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_push_batch(text, jsonb) to service_role;

-- ACK do Service Worker. Eventos: received (push chegou ao SW), shown (showNotification resolveu),
-- show_failed (showNotification rejeitou; p_failure = nome do erro, só letras), clicked.
-- Cada evento grava o relógio do SERVIDOR uma única vez (coalesce => retry idempotente) e só na
-- entrega dona do token. Token/evento inválido, entrega inexistente e token vencido (>30 dias) são
-- indistinguíveis para quem chama: sempre retorna sem erro e sem dados.
create or replace function public.push_delivery_ack(p_token text, p_event text, p_failure text default null)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_hash bytea;
  v_now timestamptz := clock_timestamp();
begin
  if p_token is null or p_event is null or p_token !~ '^[0-9a-f]{64}$' then return; end if;
  v_hash := sha256(convert_to(p_token, 'utf8'));
  if p_event = 'received' then
    update public.notification_push_deliveries set sw_received_at = coalesce(sw_received_at, v_now)
      where ack_token_hash = v_hash and claimed_at > now() - interval '30 days';
  elsif p_event = 'shown' then
    update public.notification_push_deliveries set show_resolved_at = coalesce(show_resolved_at, v_now)
      where ack_token_hash = v_hash and claimed_at > now() - interval '30 days';
  elsif p_event = 'show_failed' then
    update public.notification_push_deliveries set
      show_failed_at = coalesce(show_failed_at, v_now),
      show_failure = coalesce(show_failure, case when p_failure ~ '^[A-Za-z]{1,40}$' then p_failure else 'Error' end)
      where ack_token_hash = v_hash and claimed_at > now() - interval '30 days';
  elsif p_event = 'clicked' then
    update public.notification_push_deliveries set clicked_at = coalesce(clicked_at, v_now)
      where ack_token_hash = v_hash and claimed_at > now() - interval '30 days';
  end if;
end;
$$;
revoke execute on function public.push_delivery_ack(text, text, text) from public;
grant execute on function public.push_delivery_ack(text, text, text) to anon, authenticated;

-- Linha do tempo por entrega (leitura administrativa via SQL; o schema `private` não é exposto pela
-- API). Os deltas em milissegundos respondem "em qual etapa o tempo passou".
create or replace view private.push_delivery_timeline as
select
  d.id as delivery_id, d.notification_id, n.type::text as type, s.platform,
  substring(s.endpoint from '^https://([^/]+)') as provider_host,
  d.status, d.attempt_count, d.last_http_status as provider_http_status,
  n.created_at as notification_created_at, o.created_at as outbox_created_at, o.next_attempt_at as available_at,
  d.worker_started_at, d.claimed_at, d.provider_accepted_at,
  d.sw_received_at, d.show_resolved_at, d.show_failed_at, d.show_failure, d.clicked_at,
  round(extract(epoch from (o.next_attempt_at - o.created_at)) * 1000) as hold_ms,
  round(extract(epoch from (d.worker_started_at - o.next_attempt_at)) * 1000) as wait_for_worker_ms,
  round(extract(epoch from (d.claimed_at - d.worker_started_at)) * 1000) as worker_to_claim_ms,
  round(extract(epoch from (d.provider_accepted_at - d.claimed_at)) * 1000) as claim_to_provider_ms,
  round(extract(epoch from (d.sw_received_at - d.provider_accepted_at)) * 1000) as provider_to_sw_ms,
  round(extract(epoch from (d.show_resolved_at - d.sw_received_at)) * 1000) as sw_to_show_ms,
  round(extract(epoch from (d.show_resolved_at - n.created_at)) * 1000) as total_to_show_ms
from public.notification_push_deliveries d
join public.notification_push_outbox o on o.id = d.outbox_id
join public.notifications n on n.id = d.notification_id
join public.push_subscriptions s on s.id = d.subscription_id;
revoke all on private.push_delivery_timeline from public, anon, authenticated;
