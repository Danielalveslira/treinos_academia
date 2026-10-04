-- Endurecimento do Web Push (corrige 20261012000001 sem reescrevê-la) e CONVERGÊNCIA do banco.
--
-- Em produção a versão 20261012000002 é o hardening "paralelo" (ver o arquivo 02, recuperado do
-- histórico de migrations): ele não tinha allowlist de endpoint (SSRF), cancelamento de entregas
-- na troca de conta/subscription revogada, teto de dispositivos nem `get_my_push_status(text)` --
-- o frontend chama essa RPC com `p_endpoint` e recebia 404 (PGRST202). Esta migration é
-- IDEMPOTENTE e leva qualquer um dos dois estados (02 de produção ou 02 anterior deste branch) ao
-- mesmo resultado final; o gatilho `users_revoke_push_on_account_block` da 02 é preservado.
--  * claim/finish: delivery de subscription revogada/reassociada não fica em loop nem vaza para
--    outra conta; elegibilidade do destinatário é rechecada no envio.
--  * endpoint só aceita os serviços de push dos navegadores (evita SSRF pelo worker).
--  * targetUrl rejeita "\" (o navegador trata "/\host" como "//host").
--  * o registro/sync nunca religa preferência; revogar não desliga a preferência global.

-- 1) Delivery cancelada (subscription revogada, reassociada ou destinatário inelegível).
alter table public.notification_push_deliveries
  drop constraint if exists notification_push_deliveries_status_check;
alter table public.notification_push_deliveries
  add constraint notification_push_deliveries_status_check
  check (status in ('pending','sent','failed','expired','cancelled'));

-- FKs sem índice de apoio: cascade de usuário/subscription e a reassociação varriam a tabela.
create index if not exists notification_push_deliveries_subscription_idx
  on public.notification_push_deliveries (subscription_id);
create index if not exists notification_push_outbox_user_idx
  on public.notification_push_outbox (user_id);

-- 2) Auditoria sobrevive à exclusão física do superadmin (RESTRICT travaria o worker de exclusão).
alter table public.push_broadcast_audit alter column created_by drop not null;
alter table public.push_broadcast_audit drop constraint if exists push_broadcast_audit_created_by_fkey;
alter table public.push_broadcast_audit
  add constraint push_broadcast_audit_created_by_fkey
  foreign key (created_by) references public.users(id) on delete set null;

-- 3) Helpers.
create or replace function private.safe_push_target_url(p_url text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_url is not null and char_length(p_url) <= 300 and left(p_url, 1) = '/'
      and left(p_url, 2) <> '//' and position(chr(92) in p_url) = 0
      and p_url !~ '[[:cntrl:]]' then p_url
    else '/'
  end
$$;

-- Somente os serviços de push dos navegadores (FCM/Chrome, Mozilla, Apple, WNS/Edge). O
-- endpoint vem do cliente e o worker faz POST nele: sem allowlist seria SSRF.
create or replace function private.is_push_endpoint_allowed(p_endpoint text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    char_length(p_endpoint) <= 4096 and p_endpoint ~*
      '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com)/',
    false)
$$;

create or replace function private.push_category_enabled(p_categories jsonb, p_category text) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(p_categories ->> p_category, 'true') <> 'false'
$$;

-- 4) Registro: dono sempre = auth.uid(); reassociação cancela entregas pendentes da conta anterior.
create or replace function public.register_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null,
  p_device_label text default null, p_platform text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_id uuid;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if not private.is_push_endpoint_allowed(p_endpoint)
     or char_length(coalesce(p_p256dh, '')) not between 20 and 512
     or char_length(coalesce(p_auth, '')) not between 8 and 256 then
    raise exception 'INVALID_SUBSCRIPTION';
  end if;
  if not exists (select 1 from public.users where id = v_uid and account_status not in ('disabled','deleting')) then
    raise exception 'ACCOUNT_UNAVAILABLE';
  end if;
  -- Só cria a preferência padrão; nunca religa uma preferência desligada (o sync periódico
  -- do app chama esta função).
  insert into public.push_notification_preferences (user_id, enabled)
  values (v_uid, true) on conflict (user_id) do nothing;

  update public.notification_push_deliveries d
  set status = 'cancelled', last_error = 'SUBSCRIPTION_REASSIGNED'
  from public.push_subscriptions s
  where d.subscription_id = s.id and s.endpoint = p_endpoint and s.user_id <> v_uid and d.status = 'pending';

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, device_label, platform)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 500), left(p_device_label, 100), left(p_platform, 80))
  on conflict (endpoint) do update set
    user_id = v_uid, p256dh = excluded.p256dh, auth = excluded.auth,
    user_agent = excluded.user_agent, device_label = excluded.device_label, platform = excluded.platform,
    revoked_at = null, failure_count = 0, last_failure_at = null, last_seen_at = now(), updated_at = now()
  returning id into v_id;

  -- Teto de 20 dispositivos ativos por conta: os menos recentes são revogados.
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where id in (
    select id from public.push_subscriptions where user_id = v_uid and revoked_at is null
    order by last_seen_at desc, id offset 20
  );
  return v_id;
end;
$$;

-- Revogar subscriptions não altera a preferência: ela só muda por escolha explícita.
create or replace function public.unregister_push_subscription(p_endpoint text default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where user_id = v_uid and revoked_at is null and (p_endpoint is null or endpoint = p_endpoint);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- `thisDevice` diz se o endpoint informado pertence à conta atual e está ativo (a UI não
-- pode inferir o estado do dispositivo a partir da contagem de todos os dispositivos).
drop function if exists public.get_my_push_status();
create or replace function public.get_my_push_status(p_endpoint text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled', coalesce((select enabled from public.push_notification_preferences where user_id = (select auth.uid())), false),
    'activeSubscriptions', (select count(*) from public.push_subscriptions where user_id = (select auth.uid()) and revoked_at is null),
    'thisDevice', p_endpoint is not null and exists (
      select 1 from public.push_subscriptions
      where user_id = (select auth.uid()) and endpoint = p_endpoint and revoked_at is null),
    'categories', coalesce((select categories from public.push_notification_preferences where user_id = (select auth.uid())), '{}'::jsonb)
  )
$$;
revoke execute on function public.get_my_push_status(text) from public, anon;
grant execute on function public.get_my_push_status(text) to authenticated;

-- 5) A criação da notificação nunca pode falhar por causa do Push.
create or replace function private.enqueue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_category text := private.notification_push_category(new.type);
begin
  if v_category is null then return new; end if;
  begin
    if exists (
      select 1 from public.users u
      join public.push_notification_preferences p on p.user_id = u.id and p.enabled
      where u.id = new.recipient_id and u.account_status not in ('disabled','deleting')
        and private.push_category_enabled(p.categories, v_category)
        and exists (select 1 from public.push_subscriptions s where s.user_id = u.id and s.revoked_at is null)
    ) then
      insert into public.notification_push_outbox (notification_id, user_id, category)
      values (new.id, new.recipient_id, v_category) on conflict (notification_id, user_id) do nothing;
    end if;
  exception when others then
    raise warning '[Push] enqueue skipped (%)', sqlstate;
  end;
  return new;
end;
$$;

revoke execute on function private.enqueue_notification_push() from public, anon, authenticated;

-- 6) Claim: recheca elegibilidade, cancela entregas órfãs e solta jobs sem entrega vencida.
create or replace function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text
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
    n.metadata, n.priority
  from public.notification_push_outbox o
  join public.notifications n on n.id = o.notification_id
  left join public.statuses st on st.id = n.status_id
  left join public.public_profiles p on p.user_id = n.actor_id
  join public.notification_push_deliveries d on d.outbox_id = o.id and d.status = 'pending' and d.next_attempt_at <= now()
  join public.push_subscriptions s on s.id = d.subscription_id and s.user_id = o.user_id and s.revoked_at is null
  where o.status = 'processing' and o.locked_by = p_worker_id;
end;
$$;

-- 7) Finish: rejeita resultado sem entrega/outcome em vez de gravar "pending" sem backoff.
create or replace function public.finish_push_batch(p_worker_id text, p_results jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r record; v_delay interval;
begin
  if jsonb_typeof(p_results) is distinct from 'array' or jsonb_array_length(p_results) > 500 then raise exception 'INVALID_RESULTS'; end if;
  for r in select * from jsonb_to_recordset(p_results) as x(delivery_id uuid, outcome text, http_status integer, error text)
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
      last_http_status = r.http_status, last_error = left(r.error, 500),
      sent_at = case when r.outcome = 'sent' then now() else d.sent_at end
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

-- 8) Bloquear a conta (disabled/deleting) revoga as subscriptions e cancela jobs pendentes. Já
-- existe em produção (02); recriado aqui de forma idempotente para os demais ambientes.
create or replace function private.revoke_push_on_account_block() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.push_subscriptions set revoked_at = now(), updated_at = now()
  where user_id = new.id and revoked_at is null;
  update public.notification_push_outbox set status = 'cancelled', locked_at = null, locked_by = null,
    last_error = 'ACCOUNT_UNAVAILABLE'
  where user_id = new.id and status = 'pending';
  return new;
end;
$$;
revoke execute on function private.revoke_push_on_account_block() from public, anon, authenticated;
drop trigger if exists users_revoke_push_on_account_block on public.users;
create trigger users_revoke_push_on_account_block after update of account_status on public.users
for each row
when (new.account_status in ('disabled','deleting') and old.account_status is distinct from new.account_status)
execute function private.revoke_push_on_account_block();
