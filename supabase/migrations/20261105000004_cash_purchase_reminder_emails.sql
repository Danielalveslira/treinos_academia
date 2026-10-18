-- "Enviar lembrete" -- botão por compra pendente (conta ativa) na tela admin "Compras de
-- EvoCash", avisando o comprador por e-mail. Mesmo desenho arquitetural do Web Push
-- (20261012000001/20261012000003/20261014000002): fila (outbox) + worker (Edge Function,
-- Resend) + cron, nunca um fetch síncrono no clique do admin. Nenhuma linha nova guarda o
-- e-mail em texto puro -- o worker o resolve de auth.users no momento do envio, e o
-- histórico fica só com referências (purchase_id/user_id), no mesmo espírito de
-- account_financial_cases.

create table public.cash_purchase_reminder_emails (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.cash_purchases(id),
  user_id uuid references public.users(id) on delete set null,
  requested_by uuid references public.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'cancelled')),
  attempt_count integer not null default 0,
  last_error text check (last_error is null or char_length(last_error) <= 500),
  locked_at timestamptz,
  locked_by text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index cash_purchase_reminder_emails_purchase_idx
  on public.cash_purchase_reminder_emails(purchase_id, created_at desc);
create index cash_purchase_reminder_emails_user_idx
  on public.cash_purchase_reminder_emails(user_id, created_at desc);
create index cash_purchase_reminder_emails_pending_idx
  on public.cash_purchase_reminder_emails(status, created_at) where status = 'pending';

alter table public.cash_purchase_reminder_emails enable row level security;
-- No raw email here, so a direct superadmin read is safe -- the admin list page reads this
-- batched by purchase_id (one query per page, same pattern as resolveUsernamesByIds) to show
-- "Último lembrete enviado em..." without a per-row round trip.
create policy cash_purchase_reminder_emails_select on public.cash_purchase_reminder_emails
  for select using (public.is_superadmin());

update public.economy_config set config = config || jsonb_build_object(
  'cashPurchaseReminders', jsonb_build_object('cooldownHours', 24, 'dailyLimitPerUser', 3)
), updated_at = now() where id;

-- Masks an email for the confirmation dialog ("nome e email mascarado do destinatário")
-- without ever sending the real address to the browser.
create or replace function private._mask_email(p_email text) returns text
  language plpgsql immutable set search_path = pg_temp as $$
declare
  v_local text; v_domain text; v_tld text; v_domain_name text; v_dot_pos integer;
begin
  if p_email is null or position('@' in p_email) < 2 then return '***'; end if;
  v_local := split_part(p_email, '@', 1);
  v_domain := split_part(p_email, '@', 2);
  v_dot_pos := position('.' in reverse(v_domain));
  if v_dot_pos > 0 then
    v_tld := right(v_domain, v_dot_pos);
    v_domain_name := left(v_domain, length(v_domain) - v_dot_pos);
  else
    v_tld := ''; v_domain_name := v_domain;
  end if;
  return left(v_local, 2) || repeat('*', greatest(length(v_local) - 2, 1))
    || '@' || left(v_domain_name, 1) || repeat('*', greatest(length(v_domain_name) - 1, 1)) || v_tld;
end;
$$;
revoke all on function private._mask_email(text) from public, anon, authenticated;

-- Enqueues one reminder. Locks the purchase row first, so two concurrent clicks (or a
-- double click) on the SAME purchase serialize and the second always sees the row the
-- first just inserted -- the cooldown check below then rejects it. Never calls Resend
-- itself: the worker does, asynchronously, so this returns immediately.
create or replace function public.admin_request_cash_purchase_reminder(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_purchase public.cash_purchases;
  v_account_status text;
  v_cooldown_hours integer;
  v_daily_limit integer;
  v_last_at timestamptz;
  v_daily_count integer;
  v_new_id uuid;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_purchase from public.cash_purchases where id = p_purchase_id for update;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if v_purchase.payment_provider <> 'infinitepay' or v_purchase.status <> 'pending' then
    raise exception 'PURCHASE_NOT_PENDING';
  end if;
  if v_purchase.user_id is null then raise exception 'PURCHASE_ACCOUNT_DELETED'; end if;

  select account_status into v_account_status from public.users where id = v_purchase.user_id;
  if v_account_status is distinct from 'active' then raise exception 'ACCOUNT_NOT_ACTIVE'; end if;

  select coalesce((config->'cashPurchaseReminders'->>'cooldownHours')::integer, 24),
         coalesce((config->'cashPurchaseReminders'->>'dailyLimitPerUser')::integer, 3)
    into v_cooldown_hours, v_daily_limit
    from public.economy_config where id;
  if v_cooldown_hours is null or v_cooldown_hours <= 0 or v_cooldown_hours > 168 then v_cooldown_hours := 24; end if;
  if v_daily_limit is null or v_daily_limit <= 0 or v_daily_limit > 20 then v_daily_limit := 3; end if;

  select max(created_at) into v_last_at from public.cash_purchase_reminder_emails
    where purchase_id = p_purchase_id and status <> 'cancelled';
  if v_last_at is not null and v_last_at > now() - (v_cooldown_hours || ' hours')::interval then
    return jsonb_build_object('queued', false, 'reason', 'cooldown',
      'cooldownUntil', v_last_at + (v_cooldown_hours || ' hours')::interval);
  end if;

  select count(*) into v_daily_count from public.cash_purchase_reminder_emails
    where user_id = v_purchase.user_id and status <> 'cancelled' and created_at > now() - interval '24 hours';
  if v_daily_count >= v_daily_limit then
    return jsonb_build_object('queued', false, 'reason', 'daily_limit_reached');
  end if;

  v_new_id := gen_random_uuid();
  insert into public.cash_purchase_reminder_emails (id, purchase_id, user_id, requested_by)
    values (v_new_id, p_purchase_id, v_purchase.user_id, auth.uid());

  return jsonb_build_object('queued', true, 'id', v_new_id);
end;
$$;
revoke all on function public.admin_request_cash_purchase_reminder(uuid) from public, anon;
grant execute on function public.admin_request_cash_purchase_reminder(uuid) to authenticated;

-- Read-only preview for the confirmation dialog: username, masked email, cooldown and
-- whether sending is currently possible -- the same checks admin_request_cash_purchase_
-- reminder repeats server-side right before actually queuing (the preview can go stale
-- between the dialog opening and the confirm click; the request RPC is the real gate).
create or replace function public.admin_get_cash_purchase_reminder_preview(p_purchase_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_purchase public.cash_purchases;
  v_username text;
  v_email text;
  v_account_status text;
  v_cooldown_hours integer;
  v_daily_limit integer;
  v_last_at timestamptz;
  v_daily_count integer;
  v_can_send boolean := true;
  v_reason text;
begin
  if not public.is_superadmin() then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_purchase from public.cash_purchases where id = p_purchase_id;
  if v_purchase.id is null then raise exception 'PURCHASE_NOT_FOUND'; end if;

  select u.username, au.email::text, u.account_status into v_username, v_email, v_account_status
    from public.users u join auth.users au on au.id = u.id where u.id = v_purchase.user_id;

  select coalesce((config->'cashPurchaseReminders'->>'cooldownHours')::integer, 24),
         coalesce((config->'cashPurchaseReminders'->>'dailyLimitPerUser')::integer, 3)
    into v_cooldown_hours, v_daily_limit
    from public.economy_config where id;
  if v_cooldown_hours is null or v_cooldown_hours <= 0 or v_cooldown_hours > 168 then v_cooldown_hours := 24; end if;
  if v_daily_limit is null or v_daily_limit <= 0 or v_daily_limit > 20 then v_daily_limit := 3; end if;

  select max(created_at) into v_last_at from public.cash_purchase_reminder_emails
    where purchase_id = p_purchase_id and status <> 'cancelled';
  select count(*) into v_daily_count from public.cash_purchase_reminder_emails
    where user_id = v_purchase.user_id and status <> 'cancelled' and created_at > now() - interval '24 hours';

  if v_purchase.payment_provider <> 'infinitepay' or v_purchase.status <> 'pending' then
    v_can_send := false; v_reason := 'not_pending';
  elsif v_purchase.user_id is null or v_account_status is distinct from 'active' then
    v_can_send := false; v_reason := 'account_not_active';
  elsif v_last_at is not null and v_last_at > now() - (v_cooldown_hours || ' hours')::interval then
    v_can_send := false; v_reason := 'cooldown';
  elsif v_daily_count >= v_daily_limit then
    v_can_send := false; v_reason := 'daily_limit_reached';
  end if;

  return jsonb_build_object(
    'username', v_username, 'maskedEmail', private._mask_email(v_email),
    'lastSentAt', (select max(sent_at) from public.cash_purchase_reminder_emails
      where purchase_id = p_purchase_id and status = 'sent'),
    'cooldownUntil', case when v_last_at is not null
      then v_last_at + (v_cooldown_hours || ' hours')::interval else null end,
    'canSend', v_can_send, 'reason', v_reason
  );
end;
$$;
revoke all on function public.admin_get_cash_purchase_reminder_preview(uuid) from public, anon;
grant execute on function public.admin_get_cash_purchase_reminder_preview(uuid) to authenticated;

-- Lease (client req.: "o que acontece com um item reivindicado se o worker falhar antes de
-- concluir"): claiming sets locked_at/locked_by, but never clears them until
-- finish_cash_purchase_reminder_batch runs for that row. If the worker crashes, times out, or
-- the whole Edge Function instance is killed between claim and finish, a row stays locked
-- with no one left to call finish on it. Mirroring claim_push_jobs's own lease: any row still
-- 'pending' with a lock older than 5 MINUTES is released right here, before picking new rows,
-- so the next cron tick (one minute later) reclaims it automatically. 5 minutes is well under
-- the 24h Resend keeps an Idempotency-Key, so a reclaim that re-sends with the SAME key
-- (job.id never changes across reclaims) is still covered by Resend's own dedup if the first,
-- abandoned attempt had actually reached Resend's servers.
--
-- Revalidation (client req.: "antes de chamar o Resend, o worker deve reconfirmar compra
-- pendente e conta ativa"): admin_request_cash_purchase_reminder already checks this at
-- enqueue time, but time passes between a click and this claim (the purchase can get paid,
-- cancelled, or its account disabled in between). So every picked row is re-checked HERE,
-- under the SAME row lock used to claim it -- no separate round trip, no race between the
-- check and the send. A row that no longer qualifies is marked 'cancelled' with the reason
-- recorded in last_error and is NEVER returned to the caller, so the worker can never send
-- for it.
create or replace function public.claim_cash_purchase_reminder_jobs(p_worker_id text, p_limit integer default 25)
returns table (
  id uuid, purchase_id uuid, user_id uuid, username text, email text,
  package_label text, cash_amount numeric, amount_centavos integer, currency text,
  purchase_created_at timestamptz, attempt_count integer
) language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_picked record;
  v_purchase_status text;
  v_account_status text;
  v_reason text;
begin
  if p_worker_id is null or char_length(p_worker_id) > 100 then raise exception 'INVALID_WORKER'; end if;
  update public.cash_purchase_reminder_emails set locked_at = null, locked_by = null
    where status = 'pending' and locked_at < now() - interval '5 minutes';

  for v_picked in
    select r.id, r.purchase_id, r.user_id from public.cash_purchase_reminder_emails r
    where r.status = 'pending' and r.locked_at is null
    order by r.created_at
    for update of r skip locked limit least(greatest(p_limit, 1), 100)
  loop
    select p.status, u.account_status into v_purchase_status, v_account_status
      from public.cash_purchases p left join public.users u on u.id = p.user_id
      where p.id = v_picked.purchase_id for update of p;

    v_reason := case
      when v_purchase_status is null then 'purchase_not_found'
      when v_purchase_status <> 'pending' then 'purchase_status_' || v_purchase_status
      when v_account_status is distinct from 'active' then 'account_not_active'
      else null
    end;

    if v_reason is not null then
      update public.cash_purchase_reminder_emails r set status = 'cancelled',
        locked_at = null, locked_by = null, last_error = v_reason
        where r.id = v_picked.id;
      continue;
    end if;

    update public.cash_purchase_reminder_emails r
      set locked_at = now(), locked_by = p_worker_id, attempt_count = r.attempt_count + 1
      where r.id = v_picked.id;

    return query
      select v_picked.id, v_picked.purchase_id, v_picked.user_id, u.username, au.email::text,
        p.package_label, p.cash_amount, p.amount_centavos, p.currency, p.created_at,
        r.attempt_count
      from public.cash_purchases p
      join public.cash_purchase_reminder_emails r on r.id = v_picked.id
      left join public.users u on u.id = v_picked.user_id
      left join auth.users au on au.id = v_picked.user_id
      where p.id = v_picked.purchase_id;
  end loop;
end;
$$;
revoke all on function public.claim_cash_purchase_reminder_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_cash_purchase_reminder_jobs(text, integer) to service_role;

-- Finish, mirroring finish_push_batch: 'retry' puts the row back to 'pending' for the next
-- cron tick (transient provider failure -- a locked_by mismatch, e.g. a stale-lock reclaim
-- by another worker mid-batch, is simply ignored instead of overwriting someone else's row).
create or replace function public.finish_cash_purchase_reminder_batch(p_worker_id text, p_results jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_item jsonb;
begin
  if p_worker_id is null then raise exception 'INVALID_WORKER'; end if;
  for v_item in select * from jsonb_array_elements(p_results) loop
    if (v_item->>'outcome') = 'sent' then
      update public.cash_purchase_reminder_emails set status = 'sent', sent_at = now(),
        locked_at = null, locked_by = null, last_error = null
        where id = (v_item->>'id')::uuid and locked_by = p_worker_id;
    elsif (v_item->>'outcome') = 'retry' then
      update public.cash_purchase_reminder_emails set status = 'pending', locked_at = null, locked_by = null,
        last_error = left(coalesce(v_item->>'error', ''), 500)
        where id = (v_item->>'id')::uuid and locked_by = p_worker_id;
    else
      update public.cash_purchase_reminder_emails set status = 'failed', locked_at = null, locked_by = null,
        last_error = left(coalesce(v_item->>'error', ''), 500)
        where id = (v_item->>'id')::uuid and locked_by = p_worker_id;
    end if;
  end loop;
end;
$$;
revoke all on function public.finish_cash_purchase_reminder_batch(text, jsonb) from public, anon, authenticated;
grant execute on function public.finish_cash_purchase_reminder_batch(text, jsonb) to service_role;

-- Same cron-dispatch pattern as process-push-outbox (20261012000003): the anon key here is
-- the project's public gateway key (already committed, same one used by every browser
-- client), never an authorization by itself -- the worker refuses to run without the
-- X-Cash-Reminder-Worker-Secret header, read from Vault (secret
-- `cash_purchase_reminder_worker_secret`, created OUTSIDE Git, same operational step as
-- `push_worker_secret`). Runs every minute so a queued reminder goes out within ~1 minute,
-- without ever blocking the admin's click.
select cron.schedule(
  'send-cash-purchase-reminder-emails', '* * * * *',
  $$select net.http_post(
    url := 'https://ywrjojrjgozdfpddkkuy.supabase.co/functions/v1/send-cash-purchase-reminder-emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl3cmpvanJqZ296ZGZwZGRra3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA0MzA3MjYsImV4cCI6MjEwNjAwNjcyNn0.CKODsrNrIpijKaiJGk9tQbTvuw24EuctjFouaLWMPRg',
      'Content-Type', 'application/json',
      'X-Cash-Reminder-Worker-Secret', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'cash_purchase_reminder_worker_secret'), '')
    )
  )$$
);
