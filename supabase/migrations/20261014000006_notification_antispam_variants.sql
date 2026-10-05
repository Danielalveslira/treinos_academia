-- Anti-spam, variação de mensagens e alertas críticos no pipeline único de Push.
-- Tudo acontece no INSERT da notificação (um upsert de PK por Push) e no claim em lote: nenhuma
-- consulta extra por mensagem, nenhum polling, nenhum Realtime novo.

-- 1) Regras por tipo no catálogo existente (uma linha por evento).
alter table private.notification_catalog
  add column if not exists critical boolean not null default false,
  add column if not exists hold_seconds integer not null default 0 check (hold_seconds between 0 and 600),
  add column if not exists coalesce_scope text not null default 'none' check (coalesce_scope in ('none', 'entity', 'type')),
  add column if not exists cooldown_seconds integer not null default 0 check (cooldown_seconds between 0 and 86400),
  add column if not exists hourly_cap integer not null default 0 check (hourly_cap >= 0),
  add column if not exists rotate_variants boolean not null default false;

-- critical: a preferência por CATEGORIA não silencia (segurança da conta, filas administrativas).
--   O interruptor geral de Push do usuário continua valendo.
-- hold + coalesce_scope: curtidas em rajada viram UM Push ("@João e mais 3 pessoas curtiram").
--   'entity' = mesma publicação/comentário; 'type' = mesmo tipo (alertas administrativos).
-- cooldown: o mesmo ator/entidade (curtir, descurtir, curtir de novo) só gera um Push por janela.
-- hourly_cap: teto de Push por tipo/hora para o destinatário (a notificação na Central não é limitada).
update private.notification_catalog set hourly_cap = 40
  where type in ('post_reply', 'comment_reply', 'comment_mention');
-- rotate_variants: só os tipos cujo texto varia (e que o worker escolhe por `variant`) pagam o upsert de
-- estado; moderação, administração, pagamento e treino (variante vem da data) não escrevem nada extra.
update private.notification_catalog set rotate_variants = true
  where type in ('post_like', 'comment_like', 'post_reply', 'comment_reply', 'comment_mention', 'economy_credit');
update private.notification_catalog set hold_seconds = 45, coalesce_scope = 'entity', cooldown_seconds = 21600, hourly_cap = 30
  where type in ('post_like', 'comment_like');
update private.notification_catalog set critical = true where type in ('moderation_notice');
update private.notification_catalog set critical = true, hourly_cap = 30
  where type in ('admin_report', 'admin_appeal', 'admin_privacy_request', 'admin_restriction', 'admin_deletion_review');
update private.notification_catalog set hold_seconds = 30, coalesce_scope = 'type'
  where type in ('admin_report', 'admin_appeal', 'admin_privacy_request');

-- 2) Estado mínimo por destinatário (NÃO é histórico): sequência de variantes por tipo, contador
-- da janela de 1h e carimbo do cooldown. Uma linha por (usuário, tipo) e por (usuário, ator+entidade).
create table if not exists private.push_state (
  recipient_id uuid not null references public.users(id) on delete cascade,
  key text not null,
  seq integer not null default 0,
  window_start timestamptz not null default now(),
  hits integer not null default 0,
  last_at timestamptz not null default now(),
  primary key (recipient_id, key)
);
alter table private.push_state enable row level security;
revoke all on private.push_state from public, anon, authenticated;
grant select, insert, update, delete on private.push_state to service_role;

-- 3) Colunas da outbox usadas pelo claim/worker.
alter table public.notification_push_outbox
  add column if not exists variant integer not null default 0,
  add column if not exists coalesced_count integer not null default 1 check (coalesced_count >= 1),
  add column if not exists critical boolean not null default false;

-- 4) Trigger único de enfileiramento (mesma elegibilidade de antes + anti-spam + variante).
create or replace function private.enqueue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_cat private.notification_catalog;
  v_category text;
  v_ok integer;
  v_seq integer;
  v_hits integer;
begin
  select * into v_cat from private.notification_catalog c where c.type = new.type::text;
  if found then
    if not v_cat.push then return new; end if;
    v_category := v_cat.category;
  else
    v_category := private.notification_push_category(new.type);
    if v_category is null then return new; end if;
  end if;
  begin
    if not exists (
      select 1 from public.users u
      join public.push_notification_preferences p on p.user_id = u.id and p.enabled
      where u.id = new.recipient_id and u.account_status not in ('disabled', 'deleting')
        and (coalesce(v_cat.critical, false) or private.push_category_enabled(p.categories, v_category))
        and exists (select 1 from public.push_subscriptions s where s.user_id = u.id and s.revoked_at is null)
    ) then
      return new;
    end if;

    -- Cooldown: curtir -> descurtir -> curtir de novo (mesmo ator e entidade) não repete o Push.
    if coalesce(v_cat.cooldown_seconds, 0) > 0 and new.dedupe_key is not null then
      v_ok := null;
      insert into private.push_state as s (recipient_id, key, last_at)
      values (new.recipient_id, 'c:' || new.dedupe_key, now())
      on conflict (recipient_id, key) do update set last_at = now()
        where s.last_at < now() - make_interval(secs => v_cat.cooldown_seconds)
      returning 1 into v_ok;
      if v_ok is null then return new; end if;
    end if;

    -- Sequência de variantes (passo 1 ou 2: nunca repete a mensagem anterior do mesmo tipo) e teto/hora.
    -- Só quando o tipo precisa (texto variável ou teto): os demais não escrevem estado nenhum.
    v_seq := 0;
    if coalesce(v_cat.rotate_variants, false) or coalesce(v_cat.hourly_cap, 0) > 0 then
      insert into private.push_state as s (recipient_id, key, seq, window_start, hits, last_at)
      values (new.recipient_id, 't:' || new.type::text, (abs(hashtext(new.recipient_id::text)) % 1000) + 1, now(), 1, now())
      on conflict (recipient_id, key) do update set
        seq = s.seq + 1 + (abs(hashtext(new.id::text)) % 2),
        hits = case when s.window_start < now() - interval '1 hour' then 1 else s.hits + 1 end,
        window_start = case when s.window_start < now() - interval '1 hour' then now() else s.window_start end,
        last_at = now()
      returning s.seq, s.hits into v_seq, v_hits;
      if coalesce(v_cat.hourly_cap, 0) > 0 and v_hits > v_cat.hourly_cap then return new; end if;
    end if;

    -- Agrupa em rajada: se já existe um job do mesmo grupo ainda em espera (e nunca tentado), ele passa
    -- a apontar para a notificação mais recente e conta +1; a notificação anterior continua na Central.
    if coalesce(v_cat.hold_seconds, 0) > 0 and v_cat.coalesce_scope <> 'none' then
      update public.notification_push_outbox o
      set notification_id = new.id, coalesced_count = o.coalesced_count + 1
      where o.id = (
        select o2.id
        from public.notification_push_outbox o2
        join public.notifications n2 on n2.id = o2.notification_id
        where o2.user_id = new.recipient_id and o2.status = 'pending' and o2.attempt_count = 0
          and o2.next_attempt_at > now() and n2.type = new.type
          and (v_cat.coalesce_scope = 'type'
            or (n2.status_id is not distinct from new.status_id and n2.comment_id is not distinct from new.comment_id))
        order by o2.created_at desc limit 1
        for update skip locked);
      if found then return new; end if;
    end if;

    insert into public.notification_push_outbox (notification_id, user_id, category, variant, critical, next_attempt_at)
    values (new.id, new.recipient_id, v_category, v_seq, coalesce(v_cat.critical, false),
      now() + make_interval(secs => coalesce(v_cat.hold_seconds, 0)))
    on conflict (notification_id, user_id) do nothing;
  exception when others then
    raise warning '[Push] enqueue skipped (%)', sqlstate;
  end;
  return new;
end;
$$;
revoke execute on function private.enqueue_notification_push() from public, anon, authenticated;

-- Desfazer a ação ANTES de o Push sair (a notificação é apagada e o job vai junto) libera o cooldown:
-- senão a curtida seguinte nunca geraria Push. Se o Push já foi enviado, o carimbo permanece.
create or replace function private.release_push_cooldown() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.push_state s
  where s.recipient_id = old.recipient_id and s.key = 'c:' || old.dedupe_key
    and exists (select 1 from public.notification_push_outbox o
      where o.notification_id = old.id and o.status = 'pending' and o.attempt_count = 0);
  return old;
end;
$$;
revoke execute on function private.release_push_cooldown() from public, anon, authenticated;
drop trigger if exists notifications_release_push_cooldown on public.notifications;
create trigger notifications_release_push_cooldown before delete on public.notifications
for each row when (old.dedupe_key is not null) execute function private.release_push_cooldown();

-- 5) Claim: honra `critical`, devolve variante, tamanho do grupo e destinatário (sem consulta extra).
drop function if exists public.claim_push_jobs(text, integer);
create or replace function public.claim_push_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  job_id uuid, delivery_id uuid, notification_id bigint, subscription_id uuid,
  endpoint text, p256dh text, auth text, notification_type text, actor_username text,
  action_url text, metadata jsonb, priority text, urgency text, ttl_seconds integer,
  variant integer, group_count integer
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
  select o.id, d.id, o.notification_id, s.id, s.endpoint, s.p256dh, s.auth,
    n.type::text, p.username,
    private.safe_push_target_url(case
      when n.comment_id is not null and n.status_id is not null and st.community_id is not null
        then '/comunidades/' || st.community_id::text || '/publicacoes/' || n.status_id::text || '/comentarios/' || n.comment_id::text
      else n.action_url end),
    n.metadata, n.priority,
    coalesce(cat.urgency, 'normal'), coalesce(cat.ttl_seconds, 86400),
    o.variant, o.coalesced_count
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

-- 6) Limpeza: o estado de anti-spam é efêmero (cooldowns em 2 dias, o resto em 30).
create or replace function private.cleanup_push_history() returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.notification_push_outbox where status in ('sent', 'failed', 'cancelled') and created_at < now() - interval '90 days';
  delete from public.push_subscriptions where revoked_at < now() - interval '180 days';
  delete from private.push_state where (key like 'c:%' and last_at < now() - interval '2 days') or last_at < now() - interval '30 days';
end;
$$;
revoke execute on function private.cleanup_push_history() from public, anon, authenticated;

-- 7) Lembretes de treino: a variante deixa de ser reduzida módulo 6 no banco. O app/worker reduz
-- pelo tamanho do catálogo (que pode crescer sem nova migration) e dias consecutivos usam
-- variantes consecutivas, logo diferentes.
create or replace function private.dispatch_due_workout_reminders(p_limit integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_job public.workout_reminder_jobs;
  v_plan jsonb;
  v_names text[] := array['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  v_id bigint;
  v_count integer := 0;
  v_variant integer;
begin
  for v_job in select * from public.workout_reminder_jobs
    where status = 'pending' and scheduled_at <= now()
    order by scheduled_at, id limit least(greatest(p_limit, 1), 100) for update skip locked
  loop
    select training_preferences into v_plan from public.users
      where id = v_job.user_id and account_status not in ('disabled','deleting');
    if v_plan is null or coalesce((v_plan->>'reminderEnabled')::boolean, false) is not true
      or v_plan->>'timezone' is distinct from v_job.timezone
      or v_job.planned_date < coalesce((v_plan->>'effectiveFrom')::date, v_job.planned_date)
      or not coalesce((v_plan->'plannedTrainingDays') ? v_names[extract(isodow from v_job.planned_date)::int], false)
      or v_job.scheduled_at < now() - interval '15 minutes'
      or exists (select 1 from public.workouts w where w.user_id = v_job.user_id and w.date = v_job.planned_date)
    then
      update public.workout_reminder_jobs set status = 'skipped', processed_at = now() where id = v_job.id;
    else
      v_id := null;
      v_variant := ((v_job.planned_date - date '2000-01-01')::bigint + (abs(hashtext(v_job.user_id::text)) % 997))::int;
      insert into public.notifications (recipient_id, type, priority, entity_type, action_url, metadata, dedupe_key)
      values (v_job.user_id,
        (case when v_job.kind = 'before' then 'workout_reminder_before' else 'workout_reminder_start' end)::public.notification_type,
        'normal', 'weekly_training_plan', '/novo-treino?planejado=' || v_job.planned_date::text,
        jsonb_build_object('plannedDate', v_job.planned_date, 'reminderKind', v_job.kind, 'variant', v_variant),
        'workout-reminder:' || v_job.planned_date::text || ':' || v_job.kind || ':' || extract(epoch from v_job.scheduled_at)::bigint::text)
      on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
      returning id into v_id;
      if v_id is null then
        select id into v_id from public.notifications
          where recipient_id = v_job.user_id and dedupe_key = 'workout-reminder:' || v_job.planned_date::text || ':' || v_job.kind || ':' || extract(epoch from v_job.scheduled_at)::bigint::text;
      end if;
      update public.workout_reminder_jobs set status = 'sent', processed_at = now(), notification_id = v_id
        where id = v_job.id;
      if v_id is not null then v_count := v_count + 1; end if;
    end if;
    perform private.schedule_next_workout_reminder(v_job.user_id, v_job.kind, greatest(now(), v_job.scheduled_at) + interval '1 second');
  end loop;
  return v_count;
end;
$$;
revoke all on function private.dispatch_due_workout_reminders(integer) from public, anon, authenticated;
grant execute on function private.dispatch_due_workout_reminders(integer) to service_role;
