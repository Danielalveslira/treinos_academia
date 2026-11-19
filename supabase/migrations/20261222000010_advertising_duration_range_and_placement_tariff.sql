set local lock_timeout='5s';
set local statement_timeout='30s';
-- Reestruturação do portal do anunciante (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md).
--
-- 1) `desired_duration_days` era validado só contra o limite genérico de sanidade
-- (1-3650, ver 20261207000005). Isso aceitava valores fora da faixa real da oferta
-- comercial vigente (commercial_price_versions.min_days/max_days), que o anunciante só
-- descobriria estar errada na hora da cotação de contratação. Mesma assinatura da função
-- (nenhum novo parâmetro): valida contra a faixa real quando existe uma versão de preço
-- ativa para a oferta do recurso; cai para o limite genérico só quando não há nenhuma
-- versão de preço publicada ainda (nunca mais restritivo do que hoje nesse caso, preserva
-- registros antigos). Delega o resto do corpo, inalterado, para o helper privado existente.
create or replace function public.edit_advertising_campaign(p_id uuid,p_version bigint,p_title text,p_description text,p_destination text,p_submit boolean,p_media_id uuid default null,p_desired_days integer default null) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare result jsonb; v_offering text; v_min integer; v_max integer;
begin
 if p_desired_days is not null then
 select r.offering_code into v_offering from private.commercial_resources r where r.id=p_id;
 if v_offering is not null then
 select v.min_days,v.max_days into v_min,v_max from public.commercial_price_versions v
 where v.offering_code=v_offering and v.active_from<=statement_timestamp() order by v.active_from desc limit 1;
 end if;
 if v_min is not null and v_max is not null then
 if p_desired_days<v_min or p_desired_days>v_max then raise exception 'AD_DURATION_OUT_OF_OFFER_RANGE'; end if;
 elsif p_desired_days not between 1 and 3650 then raise exception 'INVALID_DURATION';
 end if;
 end if;
 result:=private.edit_advertising_campaign_before_duration(p_id,p_version,p_title,p_description,p_destination,p_submit,p_media_id);
 if p_desired_days is not null then
 update private.advertising_drafts set desired_duration_days=p_desired_days where ad_id=p_id;
 result:=result||jsonb_build_object('desired_duration_days',p_desired_days);
 end if;
 return result;
end $$;
revoke all on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) from public,anon,service_role;
grant execute on function public.edit_advertising_campaign(uuid,bigint,text,text,text,boolean,uuid,integer) to authenticated;

-- 2) `advertising_sales_status` só devolvia {code,salesEnabled} -- insuficiente para a
-- Etapa 1 do assistente (preço/faixa de dias antes mesmo de existir um rascunho). Reaproveita
-- a mesma resolução de tarifa já usada em `get_advertising_campaigns` (oferta + versão de
-- preço vigente), só que por `advertising_placements.offering_code` em vez de
-- `commercial_resources.offering_code` -- mesma fonte de verdade, sem capacidade, revisão
-- nem qualquer outro dado administrativo. `tariff` só é preenchida quando o placement já é
-- `salesEnabled` (mesmos gates de `private.advertising_placement_sellable`); caso contrário é
-- `null`, para nunca sugerir um preço que não corresponde a uma contratação possível.
create or replace function public.advertising_sales_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 return coalesce((select jsonb_agg(jsonb_build_object(
   'code',p.code,
   'salesEnabled',private.advertising_placement_sellable(p.code),
   'tariff',case when private.advertising_placement_sellable(p.code) then (
     select jsonb_build_object('price',v.unit_price_cash::text,'minDays',v.min_days,'maxDays',v.max_days)
     from public.commercial_offerings f left join lateral(
       select * from public.commercial_price_versions where offering_code=f.code and active_from<=statement_timestamp() order by active_from desc limit 1
     )v on true where f.code=p.offering_code
   ) else null end
 ) order by p.code)
 from public.advertising_placements p where p.content_type in('banner','feed')),'[]'::jsonb);
end $$;
revoke all on function public.advertising_sales_status() from public,anon,service_role;
grant execute on function public.advertising_sales_status() to authenticated;
