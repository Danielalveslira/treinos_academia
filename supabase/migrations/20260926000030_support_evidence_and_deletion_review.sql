-- AUD-007: cópia da foto denunciada, preservada mesmo se a publicação original expirar
-- ou for apagada antes da moderação analisar. Path previsível ({requestId}.webp) resolve
-- o problema de "ovo e galinha" da policy de Storage (o id da denúncia já existe assim
-- que o pedido é criado, antes de qualquer coisa saber o path definitivo).
-- Nota: no main isso é feito no servidor (Admin SDK, dentro da própria Cloud Function).
-- Aqui, sem Edge Functions ainda, o cliente que fez a denúncia baixa a foto original
-- (já tem permissão de leitura como membro) e reenvia pra este bucket — best-effort,
-- e sinalizado para endurecer depois com uma Edge Function quando essa camada existir.
alter table public.support_requests
  add column if not exists evidence_path text,
  add column if not exists evidence_expires_at timestamptz;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('moderation-evidence', 'moderation-evidence', false, 4194304, array['image/webp'])
on conflict (id) do nothing;

create policy moderation_evidence_insert on storage.objects for insert
  with check (
    bucket_id = 'moderation-evidence'
    and exists (
      select 1 from public.support_requests sr
      where sr.id::text || '.webp' = storage.objects.name
        and sr.user_id = auth.uid()
        and sr.kind = 'report'
    )
  );

create policy moderation_evidence_select on storage.objects for select
  using (bucket_id = 'moderation-evidence' and public.is_superadmin());

-- Grava o path/expiração da evidência depois do upload (idempotente — só a primeira
-- chamada vale). Retenção: 30 dias enquanto o pedido segue aberto, 7 dias se foi
-- cancelado/sem ação, indefinida (null) se a decisão aplicou penalidade real — a
-- expiração final é recalculada por decide_support_request/cancel_support_request,
-- não aqui.
create or replace function public.record_support_evidence(p_request_id uuid) returns void
  language plpgsql security definer set search_path = public as $$
begin
  update public.support_requests
    set evidence_path = p_request_id::text || '.webp',
        evidence_expires_at = now() + interval '30 days'
    where id = p_request_id and user_id = auth.uid() and evidence_path is null;
end;
$$;

-- deletion_jobs ganhou um terceiro estado (fix/deletion-blocked-financial-review):
-- uma conta com compra de EvoCash pendente ou saldo positivo não conclui a exclusão
-- automaticamente — fica represada até revisão. block_reason fica pronto agora; quem
-- efetivamente grava esse estado é o worker de exclusão (fase de economia).
alter table public.deletion_jobs drop constraint if exists deletion_jobs_state_check;
alter table public.deletion_jobs alter column state drop default;
alter table public.deletion_jobs add column if not exists block_reason text;
update public.deletion_jobs set state = 'pending' where state not in ('pending', 'complete');
alter table public.deletion_jobs add constraint deletion_jobs_state_check
  check (state in ('pending', 'complete', 'blocked_financial_review'));
alter table public.deletion_jobs alter column state set default 'pending';

-- Equivalente a getMyDeletionStatus: só {state} (nunca block_reason/dado financeiro)
-- para o próprio usuário.
create or replace function public.get_my_deletion_status() returns text
  language sql stable security definer set search_path = public as $$
    select state from public.deletion_jobs
    where kind = 'account' and target_id = auth.uid() and state <> 'complete'
    limit 1
$$;
