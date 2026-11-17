-- Bug real: um retry atrasado (rede lenta, resposta perdida) da MESMA requisição de pausa pode
-- chegar depois que o anunciante já retomou e pausou de novo, consumindo uma pausa que não
-- corresponde a nenhuma intenção real naquele momento. O guard por estado (`advertiser_paused_at
-- is not null then return`) só protege contra duplicar enquanto o anúncio AINDA está pausado --
-- não protege contra essa retomada+nova-pausa entre o original e o retry. A identidade correta
-- de uma requisição não é o estado atual do recurso, é a própria requisição: um `request_id`
-- gerado uma vez no cliente (reaproveitado em novas tentativas da MESMA intenção, igual ao já
-- usado em create_advertising_campaign) e registrado de forma permanente no histórico de
-- operações já existente -- sem criar nenhuma tabela nova.
set local lock_timeout = '5s';

alter table public.advertising_operations add column request_id uuid;
create unique index advertising_operations_request_id_idx
  on public.advertising_operations(request_id) where request_id is not null;

-- Clientes antigos (sem o parâmetro) chamavam esta assinatura; manter os dois argumentos vivos,
-- mas sem a lógica insegura, evita quebrar o app sem aviso e dá uma mensagem acionável.
create or replace function public.interrupt_advertising_campaign(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'AD_APP_UPDATE_REQUIRED';
end $$;

create function public.interrupt_advertising_campaign(
  p_id uuid, p_reason text, p_request_id uuid) returns void
language plpgsql security definer set search_path = '' set lock_timeout = '5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
  v_count smallint; existing public.advertising_operations;
begin
  if p_request_id is null then raise exception 'AD_REQUEST_ID_REQUIRED'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 5 and 500 then raise exception 'AD_REVIEW_REASON_REQUIRED'; end if;
  select * into r from private.commercial_resources where id = p_id for update;
  if r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
  select * into d from private.advertising_drafts where ad_id = p_id;
  perform private.require_advertising_editor(d.account_id);
  -- Retry exato da mesma intenção (mesmo recurso, ação e autor): a pausa já foi aplicada (ou
  -- recusada) por essa requisição em algum momento -- devolve sucesso sem tocar no estado atual,
  -- mesmo que o anúncio já tenha sido retomado e pausado de novo depois. Reuso do mesmo
  -- request_id para outro recurso/ação/autor é erro de cliente, nunca aceito silenciosamente.
  select * into existing from public.advertising_operations where request_id = p_request_id;
  if found then
    if existing.resource_id is distinct from p_id or existing.action <> 'advertiser_pause'
      or existing.actor_user_id is distinct from auth.uid()
    then raise exception 'AD_REQUEST_ID_REUSED'; end if;
    return;
  end if;
  if r.moderation_state = 'suspended' then return; end if;
  if r.moderation_state <> 'approved' or r.approved_revision is null
    or r.approved_revision <> r.content_revision or d.approved_version <> r.approved_revision
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  if r.advertiser_paused_at is not null then return; end if;
  select * into e from public.visibility_entitlements where resource_id = p_id for update;
  if not found or e.administrative_state <> 'enabled'
    or e.starts_at > statement_timestamp() or e.expires_at <= statement_timestamp()
  then raise exception 'ENTITLEMENT_BLOCKED'; end if;
  v_count := case when r.advertiser_pause_period_start is distinct from e.starts_at
    then 0 else r.advertiser_pause_count end;
  if v_count >= 3 then raise exception 'AD_PAUSE_LIMIT_CONFIRM_REQUIRED'; end if;
  update private.commercial_resources set advertiser_paused_at = clock_timestamp(),
    advertiser_paused_by = auth.uid(), advertiser_pause_count = v_count + 1,
    advertiser_pause_period_start = e.starts_at where id = p_id;
  insert into public.advertising_operations(actor_user_id, resource_id, action, reason, request_id)
    values (auth.uid(), p_id, 'advertiser_pause', btrim(p_reason), p_request_id);
end $$;
revoke all on function public.interrupt_advertising_campaign(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.interrupt_advertising_campaign(uuid, text, uuid) to authenticated;

create or replace function public.resume_my_advertising_campaign(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'AD_APP_UPDATE_REQUIRED';
end $$;

create function public.resume_my_advertising_campaign(p_id uuid, p_request_id uuid) returns void
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare d private.advertising_drafts; r private.commercial_resources; e public.visibility_entitlements;
  existing public.advertising_operations;
begin
 if p_request_id is null then raise exception 'AD_REQUEST_ID_REQUIRED'; end if;
 perform private.require_commercial_user();
 select * into r from private.commercial_resources where id=p_id for update;
 select * into d from private.advertising_drafts where ad_id=p_id;
 if not found or r.id is null or not private.valid_advertising_resource(p_id) then raise exception 'AD_NOT_FOUND'; end if;
 perform private.require_advertising_editor(d.account_id);
 -- Mesma garantia do lado da pausa: um retry atrasado da mesma retomada nunca desfaz uma pausa
 -- posterior, porque ele só reconhece a SUA PRÓPRIA operação já registrada, nunca a atual.
 select * into existing from public.advertising_operations where request_id = p_request_id;
 if found then
   if existing.resource_id is distinct from p_id or existing.action <> 'advertiser_resume'
     or existing.actor_user_id is distinct from auth.uid()
   then raise exception 'AD_REQUEST_ID_REUSED'; end if;
   return;
 end if;
 if r.advertiser_paused_at is null then
  if r.moderation_state='approved' then return; end if;
  raise exception 'AD_RESUME_BLOCKED';
 end if;
 if r.moderation_state<>'approved' or r.approved_revision is null
  or r.approved_revision<>r.content_revision or d.approved_version<>r.approved_revision
  or not exists(select 1 from public.advertiser_accounts a where a.id=d.account_id and a.active and a.owner_user_id=r.owner_user_id)
  or not exists(select 1 from public.users u where u.id=r.owner_user_id and u.account_status='active')
  or exists(select 1 from public.account_restrictions a where a.user_id=r.owner_user_id
   and not (a.action='temporary_suspension' and a.until<=statement_timestamp()))
 then raise exception 'AD_RESUME_BLOCKED'; end if;
 select * into e from public.visibility_entitlements where resource_id=p_id for update;
 if not found or e.administrative_state<>'enabled' or e.starts_at>statement_timestamp()
  or e.expires_at<=statement_timestamp() then raise exception 'AD_RESUME_BLOCKED'; end if;
 if not exists(select 1 from private.advertising_resource_inventory i
  join public.advertising_placements p on p.code=i.placement_code
  where i.resource_id=p_id and p.delivery_enabled
  and (p.surface='home' or exists(select 1 from public.communities c
   where c.id=i.context_id and c.is_active and c.owner_id=r.owner_user_id)))
 then raise exception 'AD_RESUME_PLACEMENT_BLOCKED'; end if;
 update private.commercial_resources set advertiser_paused_at=null,advertiser_paused_by=null where id=p_id;
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason,request_id)
  values(auth.uid(),p_id,'advertiser_resume','Retomada solicitada pelo anunciante',p_request_id);
end $$;
revoke all on function public.resume_my_advertising_campaign(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.resume_my_advertising_campaign(uuid, uuid) to authenticated;
