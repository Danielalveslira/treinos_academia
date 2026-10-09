-- Métricas de patrocinados (Fase 3): leitura agregada para o dashboard do superadmin.
-- DEPENDE da Fase 2 (20261018000001_sponsored_ad_metrics.sql: sponsored_ad_daily_stats, sponsored_ad_metrics_settings,
-- private.ad_metrics_day). A ordem numérica garante a dependência; nada aqui altera a coleta (record_ad_events).
--
-- Uma única RPC devolve, num jsonb limitado e estável: resumo, série diária, por posicionamento, por campanha e por
-- comunidade/posição. Tudo é agregação SQL sobre sponsored_ad_daily_stats (nunca marcadores nem eventos brutos, nunca
-- user_id). Leitura SOMENTE superadmin, verificada aqui no banco.
--
-- SECURITY DEFINER justificado: a RPC também lê a chave de coleta (sponsored_ad_metrics_settings, sem GRANT para
-- clientes) para o dashboard distinguir "coleta desligada" de "sem dados". search_path vazio, objetos qualificados, sem SQL
-- dinâmico, EXECUTE só para authenticated e a checagem is_superadmin() é a primeira instrução.
--
-- Fórmulas (valores prontos para a tela; null quando não há impressões, nunca divisão por zero):
--   qualified_clicks = clicks - unqualified_clicks
--   ctr_qualified    = qualified_clicks / visible_impressions * 100   (2 casas)
--   ctr_raw          = clicks / visible_impressions * 100             (2 casas; pode passar de 100)
-- unique_viewers é a SOMA dos únicos diários (a mesma conta em dias/posições/comunidades diferentes conta de novo).
-- Os dias são os do agregado, já fechados em America/Sao_Paulo pela coleta; "hoje" e a janela padrão também.

-- Objeto de métricas reutilizado em todos os agrupamentos (função pura, só para a RPC).
create function private.ad_metrics_object(p_impressions bigint, p_unique bigint, p_clicks bigint, p_unqualified bigint)
  returns jsonb language sql immutable parallel safe set search_path = '' as $$
    select jsonb_build_object(
      'visible_impressions', p_impressions,
      'unique_viewers', p_unique,
      'clicks', p_clicks,
      'unqualified_clicks', p_unqualified,
      'qualified_clicks', p_clicks - p_unqualified,
      'ctr_qualified', case when p_impressions > 0 then round(100.0 * (p_clicks - p_unqualified) / p_impressions, 2) end,
      'ctr_raw', case when p_impressions > 0 then round(100.0 * p_clicks / p_impressions, 2) end
    )
$$;
revoke all on function private.ad_metrics_object(bigint, bigint, bigint, bigint) from public, anon, authenticated;

create function public.get_sponsored_ad_metrics_dashboard(
  p_days integer default 30,
  p_from date default null,
  p_to date default null,
  p_ad_id uuid default null,
  p_community_id uuid default null,
  p_placement text default null
) returns jsonb
  language plpgsql stable security definer set search_path = '' as $$
declare
  c_max_days constant integer := 366;
  c_campaign_limit constant integer := 50;
  c_context_limit constant integer := 50;
  v_today date := private.ad_metrics_day(now());
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if auth.uid() is null or not coalesce(public.is_superadmin(), false) then
    raise exception 'PERMISSION_DENIED';
  end if;

  if p_placement is not null and p_placement not in ('home_banner', 'community_banner', 'community_feed') then
    raise exception 'INVALID_FILTER';
  end if;

  if p_from is null and p_to is null then
    -- janela móvel terminando HOJE (dia do servidor em America/Sao_Paulo)
    if p_days is null or p_days < 1 or p_days > c_max_days then raise exception 'INVALID_RANGE'; end if;
    v_to := v_today;
    v_from := v_today - (p_days - 1);
  else
    -- intervalo personalizado: os dois extremos, ordem correta, no máximo 366 dias, sem futuro
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > c_max_days
       or p_to > v_today or p_from < date '2020-01-01' then
      raise exception 'INVALID_RANGE';
    end if;
    v_from := p_from;
    v_to := p_to;
  end if;

  -- UMA passagem pelo intervalo (índice da PK por dia): GROUPING SETS calcula resumo, série diária, posições,
  -- campanhas e comunidade/posição de uma vez. (Uma CTE materializada lida 5 vezes estourava work_mem e gravava
  -- temporário em 366 dias. Um array_agg ordenado para o nome histórico também custava ~370 ms: o nome da campanha
  -- excluída é buscado só para as linhas devolvidas, mais abaixo.) grouping(day, ad_id, placement,
  -- context_id): 15 = total, 7 = por dia, 13 = por posição, 11 = por campanha, 12 = por posição e contexto.
  with base as (
    select s.day, s.ad_id, s.placement, s.context_id, s.partner_name,
           s.visible_impressions, s.unique_viewers, s.clicks, s.unqualified_clicks
      from public.sponsored_ad_daily_stats s
     where s.day between v_from and v_to
       and (p_ad_id is null or s.ad_id = p_ad_id)
       and (p_community_id is null or s.context_id = p_community_id)
       and (p_placement is null or s.placement = p_placement)
  ),
  agg as (
    select grouping(day, ad_id, placement, context_id) as g, day, ad_id, placement, context_id,
           coalesce(sum(visible_impressions), 0)::bigint as imp, coalesce(sum(unique_viewers), 0)::bigint as uniq,
           coalesce(sum(clicks), 0)::bigint as clk, coalesce(sum(unqualified_clicks), 0)::bigint as unq,
           count(*) as row_count
      from base
     group by grouping sets ((), (day), (placement), (ad_id), (placement, context_id))
  ),
  summary as (select * from agg where g = 15),
  daily as (select * from agg where g = 7),
  per_placement as (select * from agg where g = 13),
  campaign_rows as (
    select c.*, a.title, a.partner_name as current_name, a.expires_at, (a.id is null) as deleted,
           row_number() over (order by c.imp desc, c.clk desc, c.ad_id) as rn
      from agg c left join public.sponsored_ads a on a.id = c.ad_id
     where c.g = 11
  ),
  context_rows as (
    select x.*, cm.name as community_name,
           row_number() over (order by x.imp desc, x.clk desc, x.placement, x.context_id) as rn
      from agg x left join public.communities cm on cm.id = x.context_id
     where x.g = 12
  )
  select jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_to - v_from + 1, 'today', v_today,
                                 'timezone', 'America/Sao_Paulo'),
    'filters', jsonb_build_object('ad_id', p_ad_id, 'community_id', p_community_id, 'placement', p_placement),
    'collection', jsonb_build_object(
      'server_enabled', coalesce((select st.collection_enabled from public.sponsored_ad_metrics_settings st where st.id), false),
      'has_any_data', exists (select 1 from public.sponsored_ad_daily_stats),
      'last_day', (select max(s2.day) from public.sponsored_ad_daily_stats s2)
    ),
    'has_data', (select sm.row_count > 0 from summary sm),
    'summary', (select private.ad_metrics_object(sm.imp, sm.uniq, sm.clk, sm.unq) from summary sm),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day) || private.ad_metrics_object(d.imp, d.uniq, d.clk, d.unq)
                                          order by d.day) from daily d), '[]'::jsonb),
    'by_placement', coalesce((select jsonb_agg(jsonb_build_object('placement', p.placement) || private.ad_metrics_object(p.imp, p.uniq, p.clk, p.unq)
                                                 order by array_position(array['home_banner', 'community_banner', 'community_feed'], p.placement))
                                from per_placement p), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object(
                                 'ad_id', r.ad_id,
                                 -- campanha excluída: retrato mais recente do nome guardado no agregado (só p/ linhas devolvidas)
                                 'partner_name', coalesce(r.current_name, (
                                   select h.partner_name from public.sponsored_ad_daily_stats h
                                    where h.ad_id = r.ad_id and h.day between v_from and v_to
                                    order by h.day desc limit 1)),
                                 'title', r.title, 'deleted', r.deleted, 'expires_at', r.expires_at)
                               || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                               from campaign_rows r where r.rn <= c_campaign_limit), '[]'::jsonb),
    'campaigns_total', (select count(*) from campaign_rows),
    'campaigns_truncated', (select count(*) > c_campaign_limit from campaign_rows),
    'by_context', coalesce((select jsonb_agg(jsonb_build_object(
                                'placement', r.placement, 'context_id', r.context_id,
                                'community_name', case when r.placement = 'home_banner' then null else r.community_name end)
                              || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                              from context_rows r where r.rn <= c_context_limit), '[]'::jsonb),
    'contexts_total', (select count(*) from context_rows),
    'contexts_truncated', (select count(*) > c_context_limit from context_rows)
  ) into v_result;

  return v_result;
end;
$$;
revoke all on function public.get_sponsored_ad_metrics_dashboard(integer, date, date, uuid, uuid, text) from public, anon;
grant execute on function public.get_sponsored_ad_metrics_dashboard(integer, date, date, uuid, uuid, text) to authenticated;
