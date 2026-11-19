set local lock_timeout='5s';
set local statement_timeout='30s';
-- Reestruturação do portal do anunciante (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md),
-- seção 4.1: "Filtrar o conjunto real no backend, não apenas os 20 itens carregados" e
-- "resumo compacto de total, ativos e em análise, quando houver contagens corretas".
--
-- `p_status` é aditivo (default null preserva o comportamento atual para todo chamador
-- existente). O bucket é calculado nesta função com a MESMA precedência de
-- src/utils/advertisingStatus.js (archived > suspended > draft lifecycle > approved
-- delivery lifecycle) -- ver o comentário lá: qualquer mudança de precedência precisa ser
-- replicada aqui, porque filtrar no backend exige saber o bucket antes de paginar (um filtro
-- aplicado depois do limit 20 do cliente omitiria resultados reais). O campo nunca é exposto
-- na resposta (so usado para o WHERE); o rótulo/ação continuam vindo só do JS.
create or replace function public.get_advertising_campaigns(p_account uuid default null,p_after uuid default null,p_status text default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if p_account is null then perform private.require_evocash_admin(); else perform private.require_advertising_editor(p_account); end if;
 if p_status is not null and p_status not in ('draft','submitted','rejected','approved_unpaid','contracted_pending_start','live','blocked','paused','suspended','pause_limit_suspended','legacy_suspended','ended','archived') then
 raise exception 'INVALID_STATUS_FILTER';
 end if;
 return coalesce((
 select jsonb_agg(to_jsonb(f)-'status_key' order by f.ad_id desc) from (
 select x.* from (
 select y.*,
 case
 when y.moderation_state='archived' or y.state='archived' then 'archived'
 when y.moderation_state='suspended' then coalesce(
 case y.suspension_origin when 'pause_limit' then 'pause_limit_suspended' when 'legacy_voluntary' then 'legacy_suspended' end,
 'suspended')
 when y.advertiser_paused and y.expires_at is not null and y.expires_at>statement_timestamp() then 'paused'
 when y.moderation_state<>'approved' then case y.state when 'rejected' then 'rejected' when 'submitted' then 'submitted' else 'draft' end
 when y.expires_at is null then 'approved_unpaid'
 when y.expires_at<=statement_timestamp() then 'ended'
 when y.starts_at>statement_timestamp() then 'contracted_pending_start'
 when y.delivery_state='active' and y.placement_delivery_active then 'live'
 else 'blocked'
 end as status_key
 from (
 select d.*,a.name as partner_name,r.offering_code,r.moderation_state,
 (select o.id from public.advertising_operations o where o.resource_id=r.id order by o.id desc limit 1) as pause_operation_id,
 (r.advertiser_paused_at is not null) as advertiser_paused,e.starts_at,e.expires_at,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 0 else r.advertiser_pause_count end as pauses_used,
 case when e.starts_at <= statement_timestamp() and e.expires_at > statement_timestamp() and r.advertiser_pause_period_start is distinct from e.starts_at then 3 else 3 - r.advertiser_pause_count end as pauses_available,
 case when r.moderation_state = 'suspended'
 then private.advertising_suspension_origin(r.id, d.account_id) else null end as suspension_origin,
 case when r.moderation_state = 'suspended'
 then (select o.reason from public.advertising_operations o
 where o.resource_id = r.id and o.action in ('suspend', 'admin_suspend', 'suspend_pause_limit')
 order by o.id desc limit 1) else null end as suspension_reason,
 case when private.commercial_resource_visible(r.id) then 'active' when e.expires_at<=statement_timestamp() then 'expired' else 'private' end delivery_state,
 greatest(0,floor(extract(epoch from e.expires_at-statement_timestamp())))::bigint remaining_seconds,
 (a.owner_user_id=auth.uid()) as can_pay,
 (select jsonb_agg(jsonb_build_object('code',i.placement_code,'context',i.context_id)) from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placements,
 (select bool_or(private.advertising_eligible(d.ad_id,i.placement_code,i.context_id))
 from private.advertising_resource_inventory i where i.resource_id=d.ad_id) as placement_delivery_active,
 (select jsonb_build_object('salesEnabled',f.sales_enabled and f.integration_ready,'price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
 from public.commercial_offerings f left join lateral(select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1)v on true where f.code=r.offering_code) as tariff
 from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 join public.advertiser_accounts a on a.id=d.account_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where (p_account is null or d.account_id=p_account) and (p_after is null or d.ad_id<p_after)
 ) y
 ) x
 where (p_status is null or x.status_key=p_status)
 order by x.ad_id desc limit 20
 ) f
 ),'[]'::jsonb);
end $$;
revoke all on function public.get_advertising_campaigns(uuid,uuid,text) from public,anon,service_role;
grant execute on function public.get_advertising_campaigns(uuid,uuid,text) to authenticated;

-- Resumo de contagens para a listagem do anunciante (seção 4.1): só por conta própria
-- (nunca o painel administrativo, que teria N contas e exigiria uma consulta diferente),
-- então o teto de 100 rascunhos por conta (ver AD_DRAFT_LIMIT em create_advertising_campaign)
-- mantém esta contagem sempre barata e exata -- nunca soma de uma página parcial.
create function public.advertising_campaigns_summary(p_account uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_advertising_editor(p_account);
 return (
 select jsonb_build_object(
 'total',count(*),
 'live',count(*) filter (where
 r.moderation_state='approved' and e.expires_at is not null and e.expires_at>statement_timestamp()
 and e.starts_at<=statement_timestamp()
 and private.commercial_resource_visible(r.id)
 and exists(select 1 from private.advertising_resource_inventory i where i.resource_id=d.ad_id and private.advertising_eligible(d.ad_id,i.placement_code,i.context_id))),
 'submitted',count(*) filter (where r.moderation_state<>'approved' and d.state='submitted')
 ) from private.advertising_drafts d join private.commercial_resources r on r.id=d.ad_id
 left join public.visibility_entitlements e on e.resource_id=d.ad_id
 where d.account_id=p_account
 );
end $$;
revoke all on function public.advertising_campaigns_summary(uuid) from public,anon,service_role;
grant execute on function public.advertising_campaigns_summary(uuid) to authenticated;
