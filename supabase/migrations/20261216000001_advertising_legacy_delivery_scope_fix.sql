set local lock_timeout='5s';
-- Defeitos confirmados em auditoria no select_advertising vigente
-- (20261207000006_advertising_home_banner_rotation.sql), ambos só no ramo de anúncios
-- legados (commercial_resource_id is null) do CTE `candidates`:
--
-- 1) `delivery_enabled` nunca era checado para linhas legadas -- só para reservas de
--    campanha gerida. Desligar "Permitir exibição" de um posicionamento interrompia
--    campanhas pagas mas deixava anúncios institucionais/legados no ar.
-- 2) A condição de superfície era `p.surface='home' and a.is_global`, não
--    `p.code='home_banner'`. Isso casava QUALQUER posicionamento futuro de superfície
--    `home` com todo anúncio legado global existente -- a próxima migration cria
--    `progress_banner` com `surface='home'`; sem este fix, campanhas antigas do
--    `home_banner` apareceriam em `/progresso` sem nunca terem contratado aquele espaço.
--
-- Para `home_banner` em si (o único posicionamento `home` legado hoje) o comportamento
-- observável não muda: `p.code='home_banner'` e `p.surface='home'` são equivalentes
-- enquanto for o único. Rotação local, amostra, `eligible_total` e RLS continuam iguais.
create or replace function public.select_advertising(p_placement text,p_context uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.advertising_placements; begin
 perform private.require_commercial_user();
 select * into p from public.advertising_placements where code=p_placement;
 if not found or p.content_type not in('banner','feed') then return '[]'; end if;
 if p.surface='home' and p_context is not null then return '[]'; end if;
 if p.surface='community' and not coalesce(public.is_community_member(p_context),false) then return '[]'; end if;
 return coalesce((with candidates as (
 select distinct o.resource_id as id from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where p.delivery_enabled and r.placement_code=p.code and r.context_id=coalesce(p_context,'00000000-0000-0000-0000-000000000000'::uuid)
 and r.starts_at<=statement_timestamp() and r.expires_at>statement_timestamp() and o.status='fulfilled'
 union all
 select a.id from public.sponsored_ads a where a.commercial_resource_id is null and p.delivery_enabled
 and (a.expires_at is null or a.expires_at>statement_timestamp())
 and p.content_type=any(a.display_mode) and ((p.code='home_banner' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids)))
 ), eligible as (
 select a.id,a.partner_name,a.title,a.description,a.image_url,a.media_id,a.cta_label,a.cta_type,a.cta_target,
 case when a.commercial_resource_id is null then a.expires_at else e.expires_at end expires_at,a.is_global,array[p.content_type] display_mode,statement_timestamp() as server_time
 from candidates c join public.sponsored_ads a on a.id=c.id left join public.visibility_entitlements e on e.resource_id=a.id
 where a.commercial_resource_id is null or private.advertising_eligible(a.id,p.code,p_context)
 ) select jsonb_agg(to_jsonb(x)) from (
 select *,(select count(*) from eligible) as eligible_total from eligible order by random() limit p.display_limit)x),'[]'::jsonb);
end $$;

-- O cálculo de capacidade também tratava qualquer superfície global como Home.
-- Legados da Home não consomem capacidade do espaço novo de Progresso.
create or replace function private.advertising_peak(p_code text,p_context uuid,p_start timestamptz,p_end timestamptz) returns integer
language sql stable security definer set search_path='' as $$
 with windows as (
 select greatest(r.starts_at,p_start) s,least(r.expires_at,p_end) e
 from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
 where r.placement_code=p_code and r.context_id=p_context and o.status='fulfilled' and r.starts_at<p_end and r.expires_at>p_start
 union all
 select greatest(a.created_at,p_start),least(coalesce(a.expires_at,'infinity'::timestamptz),p_end)
 from public.sponsored_ads a join public.advertising_placements p on p.code=p_code
 where a.commercial_resource_id is null and a.created_at<p_end and coalesce(a.expires_at,'infinity'::timestamptz)>p_start
 and p.content_type=any(a.display_mode) and ((p.code='home_banner' and a.is_global) or (p.surface='community' and p_context=any(a.community_ids)))
 ),changes as(select s t,1 delta from windows union all select e,-1 from windows),
 sums as(select sum(sum(delta)) over(order by t) n from changes group by t)
 select coalesce(max(n),0)::integer from sums
$$;
