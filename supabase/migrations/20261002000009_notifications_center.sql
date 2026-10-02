-- Central de notificações: evolui a tabela `notifications` (criada para comentários) em vez de
-- criar um segundo sistema. Acrescenta metadados genéricos, arquivamento ("limpar") e alertas
-- administrativos gerados SOMENTE pelo banco (triggers) para quem é superadmin.

-- 1) Colunas novas. status_id deixa de ser obrigatório: alertas administrativos não pertencem
--    a uma publicação.
alter table public.notifications
  alter column status_id drop not null,
  add column if not exists priority text not null default 'normal'
    check (priority in ('low', 'normal', 'high')),
  add column if not exists entity_type text
    check (entity_type is null or char_length(entity_type) <= 40),
  add column if not exists entity_id uuid,
  add column if not exists action_url text
    check (
      action_url is null
      or (left(action_url, 1) = '/' and left(action_url, 2) <> '//' and char_length(action_url) <= 300)
    ),
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists archived_at timestamptz;

-- Notificações de comentário continuam exigindo a publicação; só as administrativas não.
alter table public.notifications
  drop constraint if exists notifications_status_required_chk;
alter table public.notifications
  add constraint notifications_status_required_chk
  check (status_id is not null or type::text like 'admin\_%');

-- 2) Índices da caixa de entrada: só linhas não arquivadas, na ordem do cursor (created_at, id).
drop index if exists public.notifications_recipient_unread_idx;
drop index if exists public.notifications_recipient_all_idx;
create index if not exists notifications_inbox_idx
  on public.notifications (recipient_id, created_at desc, id desc)
  where archived_at is null;
create index if not exists notifications_inbox_unread_idx
  on public.notifications (recipient_id, created_at desc, id desc)
  where archived_at is null and read_at is null;

-- 3) Lista com o contexto mínimo de navegação, sem N+1. security_invoker mantém a RLS
--    (notifications_select_own + statuses): cada usuário só enxerga as próprias linhas, e
--    notificações de comentário cuja publicação ficou invisível somem da lista.
create or replace view public.notification_items
with (security_invoker = true) as
select
  n.id,
  n.recipient_id,
  n.actor_id,
  p.username as actor_username,
  n.type,
  n.priority,
  n.status_id,
  n.comment_id,
  s.community_id,
  n.entity_type,
  n.entity_id,
  n.action_url,
  n.metadata,
  n.read_at,
  n.created_at
from public.notifications n
left join public.statuses s on s.id = n.status_id
left join public.public_profiles p on p.user_id = n.actor_id
where n.archived_at is null
  and (n.status_id is null or s.id is not null);

revoke all on table public.notification_items from anon;
grant select on table public.notification_items to authenticated;

-- 4) Badge: conta (com teto de 100) só as não lidas e não arquivadas do próprio usuário, usando
--    o índice parcial; nunca lê o histórico inteiro. security invoker => a RLS filtra por dono.
create or replace function public.notifications_unread_count() returns integer
language sql stable set search_path = '' as $$
  select count(*)::integer from (
    select 1
    from public.notifications
    where recipient_id = (select auth.uid())
      and archived_at is null
      and read_at is null
    limit 100
  ) unread
$$;

-- 5) "Limpar notificações": arquiva (oculta) em vez de apagar. O evento original, denúncias e
--    decisões de moderação não são tocados.
create or replace function public.notifications_archive(
  p_ids bigint[] default null,
  p_before timestamptz default null
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;
  if p_ids is null and p_before is null then raise exception 'INVALID_ARGUMENT'; end if;
  update public.notifications
  set archived_at = now(),
      read_at = coalesce(read_at, now())
  where recipient_id = v_uid
    and archived_at is null
    and (p_ids is null or id = any(p_ids))
    and (p_before is null or created_at <= p_before);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.notifications_unread_count() from public, anon;
revoke execute on function public.notifications_archive(bigint[], timestamptz) from public, anon;
grant execute on function public.notifications_unread_count() to authenticated;
grant execute on function public.notifications_archive(bigint[], timestamptz) to authenticated;

-- 6) Alertas administrativos. O destinatário é decidido AQUI, no banco, por users.role =
--    'superadmin' -- o frontend nunca envia role nem destinatário, e `authenticated` não tem
--    INSERT em notifications.
create or replace function private.notify_superadmins(
  p_type public.notification_type,
  p_priority text,
  p_entity_type text,
  p_entity_id uuid,
  p_action_url text,
  p_metadata jsonb,
  p_dedupe_key text,
  p_exclude uuid default null,
  p_created_at timestamptz default now()
) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (
    recipient_id, type, priority, entity_type, entity_id, action_url, metadata, dedupe_key, created_at
  )
  select u.id, p_type, p_priority, p_entity_type, p_entity_id, p_action_url,
         coalesce(p_metadata, '{}'::jsonb), p_dedupe_key, p_created_at
  from public.users u
  where u.role = 'superadmin'
    and u.account_status <> 'deleting'
    and u.id is distinct from p_exclude
  on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing
$$;

-- Fonte única da classificação de uma solicitação (usada pelo trigger e pelo backfill).
create or replace function private.support_request_notification(
  p_kind text,
  p_category text,
  p_comment_id uuid,
  p_listing_id uuid,
  p_status_id uuid,
  out o_type public.notification_type,
  out o_priority text,
  out o_metadata jsonb
) language sql stable set search_path = '' as $$
  select
    (case p_kind
      when 'report' then 'admin_report'
      when 'appeal' then 'admin_appeal'
      else 'admin_privacy_request'
    end)::public.notification_type,
    case
      when p_kind = 'privacy' or p_category in ('fraud_or_scam', 'image_or_identity_misuse')
        then 'high'
      else 'normal'
    end,
    jsonb_build_object(
      'kind', p_kind,
      'category', p_category,
      'target', case
        when p_comment_id is not null then 'comment'
        when p_listing_id is not null then 'listing'
        when p_status_id is not null then 'publication'
        else null
      end
    )
$$;

-- Nova denúncia/recurso/pedido de privacidade => alerta para os superadmins. Cobre todos os
-- caminhos que criam support_requests (publicação, comentário, vitrine) sem duplicar o fluxo.
-- O alerta nunca carrega o texto da denúncia nem a identidade de quem denunciou.
create or replace function private.tg_notify_support_request() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_class record;
begin
  select * into v_class from private.support_request_notification(
    new.kind, new.category, new.comment_id, new.listing_id, new.status_id
  );
  perform private.notify_superadmins(
    v_class.o_type, v_class.o_priority, 'support_request', new.id,
    '/admin/moderacao', v_class.o_metadata, 'support-request:' || new.id::text
  );
  return new;
exception when others then
  -- Um alerta que falha nunca pode impedir o usuário de enviar a denúncia.
  raise warning 'notify support_request failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists notify_support_request on public.support_requests;
create trigger notify_support_request
  after insert on public.support_requests
  for each row execute function private.tg_notify_support_request();

-- Decisão de moderação => avisa os OUTROS superadmins (quem decidiu já sabe). 'no_action' não
-- gera alerta; suspensões/banimentos são restrições (prioridade alta).
create or replace function private.tg_notify_moderation_decision() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_restriction boolean := new.action in (
    'temporary_suspension', 'community_ban', 'system_ban', 'suspend_listing'
  );
begin
  if new.action = 'no_action' then return new; end if;
  perform private.notify_superadmins(
    (case when v_restriction then 'admin_restriction' else 'admin_moderation_decision' end)
      ::public.notification_type,
    case when v_restriction then 'high' else 'normal' end,
    'moderation_decision', new.id, '/admin/moderacao',
    jsonb_build_object('action', new.action),
    'moderation-decision:' || new.id::text,
    new.admin_id
  );
  return new;
exception when others then
  raise warning 'notify moderation_decision failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists notify_moderation_decision on public.moderation_decisions;
create trigger notify_moderation_decision
  after insert on public.moderation_decisions
  for each row execute function private.tg_notify_moderation_decision();

-- Exclusão de conta travada por pendência financeira => precisa de ação do admin.
create or replace function private.tg_notify_deletion_review() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state = 'blocked_financial_review'
     and old.state is distinct from 'blocked_financial_review'
     and new.kind = 'account' then
    perform private.notify_superadmins(
      'admin_deletion_review', 'high', 'deletion_job', new.id,
      '/admin/exclusao-contas', jsonb_build_object('kind', new.kind),
      'deletion-review:' || new.id::text
    );
  end if;
  return new;
exception when others then
  raise warning 'notify deletion_review failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists notify_deletion_review on public.deletion_jobs;
create trigger notify_deletion_review
  after update of state on public.deletion_jobs
  for each row execute function private.tg_notify_deletion_review();

revoke all on all functions in schema private from public, anon, authenticated;

-- 7) Backfill: solicitações ainda abertas (últimos 60 dias) passam a aparecer no sino dos
--    superadmins atuais. Idempotente pelo dedupe_key.
select private.notify_superadmins(
  c.o_type, c.o_priority, 'support_request', sr.id,
  '/admin/moderacao', c.o_metadata, 'support-request:' || sr.id::text, null, sr.created_at
)
from public.support_requests sr
cross join lateral private.support_request_notification(
  sr.kind, sr.category, sr.comment_id, sr.listing_id, sr.status_id
) c
where sr.state = 'open'
  and sr.created_at > now() - interval '60 days';
