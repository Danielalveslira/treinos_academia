-- ROLLBACK NÃO DESTRUTIVO da migration 20261019000001 (controles de privacidade da medição).
-- Restaura record_ad_events exatamente como na 20261018000001 (sem checar menores nem oposição) e remove só a RPC
-- administrativa. Mantém a tabela de oposições e a coluna exclude_minors (sem uso). NÃO use sem decisão: sem isto a
-- medição volta a incluir menores e contas que se opuseram.
create or replace function public.record_ad_events(events jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_max_events constant integer := 20;
  c_max_bytes constant integer := 8192;
  c_max_impressions constant integer := 10;  -- impressões aceitas por usuário/anúncio/posição/contexto/dia
  c_max_clicks constant integer := 5;        -- cliques aceitos por usuário/anúncio/posição/contexto/dia
  c_max_daily constant integer := 300;       -- eventos aceitos por usuário/dia (todas as campanhas)
  c_max_hourly constant integer := 100;      -- eventos aceitos por usuário na última hora (rajada de script)
  v_uid uuid := auth.uid();
  v_day date := private.ad_metrics_day(now());
  v_el jsonb;
  v_ids uuid[] := '{}';
  v_types text[] := '{}';
  v_ads uuid[] := '{}';
  v_places text[] := '{}';
  v_ctxs uuid[] := '{}';
  v_text text;
  v_place text;
  v_seen uuid[];
  v_rec record;
  v_ad record;
  v_last_ad uuid;
  v_ad_found boolean := false;
  v_member boolean;
  v_ok_ctx uuid[] := '{}';
  v_bad_ctx uuid[] := '{}';
  -- eventos que passaram pela elegibilidade (mesma ordem: por anúncio, posição, contexto, impressão antes de clique)
  v_e_ids uuid[] := '{}';
  v_e_types text[] := '{}';
  v_e_ads uuid[] := '{}';
  v_e_places text[] := '{}';
  v_e_ctxs uuid[] := '{}';
  v_e_partners text[] := '{}';
  v_i integer;
  v_cnt record;
  v_daily integer;
  v_hourly integer;
  v_inserted integer;
  v_accepted integer := 0;
  v_cur_ad uuid;
  v_cur_place text;
  v_cur_ctx uuid;
  v_cur_partner text;
  v_d_imp bigint := 0;
  v_d_uniq bigint := 0;
  v_d_clk bigint := 0;
  v_d_unq bigint := 0;
begin
  if v_uid is null then raise exception 'NOT_AUTHENTICATED'; end if;

  if not coalesce((select s.collection_enabled from public.sponsored_ad_metrics_settings s where s.id), false) then
    return jsonb_build_object('enabled', false, 'accepted', 0);
  end if;

  -- Formato: tudo ou nada. Nada é gravado antes de o lote inteiro estar validado.
  if events is null or jsonb_typeof(events) <> 'array'
     or jsonb_array_length(events) > c_max_events
     or octet_length(events::text) > c_max_bytes then
    raise exception 'INVALID_EVENTS';
  end if;
  if jsonb_array_length(events) = 0 then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  for v_el in select value from jsonb_array_elements(events) loop
    -- chaves extras: sobra algo depois de remover as permitidas (expressão pura, sem subconsulta por evento)
    if (case when jsonb_typeof(v_el) = 'object'
         then (v_el - array['id', 'type', 'ad', 'placement', 'community']) <> '{}'::jsonb else true end)
       or jsonb_typeof(v_el -> 'id') is distinct from 'string'
       or jsonb_typeof(v_el -> 'type') is distinct from 'string'
       or jsonb_typeof(v_el -> 'ad') is distinct from 'string'
       or jsonb_typeof(v_el -> 'placement') is distinct from 'string'
       or (v_el ->> 'id') !~* c_uuid_re
       or (v_el ->> 'ad') !~* c_uuid_re
       or (v_el ->> 'type') not in ('impression', 'click')
       or (v_el ->> 'placement') not in ('home_banner', 'community_banner', 'community_feed') then
      raise exception 'INVALID_EVENTS';
    end if;
    v_place := v_el ->> 'placement';
    if v_place = 'home_banner' then
      -- Home não tem comunidade: ausente ou null; qualquer outro valor é tentativa de falsificar contexto.
      if v_el ? 'community' and jsonb_typeof(v_el -> 'community') <> 'null' then
        raise exception 'INVALID_EVENTS';
      end if;
      v_ctxs := v_ctxs || c_nil;
    else
      v_text := v_el ->> 'community';
      if jsonb_typeof(v_el -> 'community') is distinct from 'string' or v_text !~* c_uuid_re
         or v_text::uuid = c_nil then
        raise exception 'INVALID_EVENTS';
      end if;
      v_ctxs := v_ctxs || v_text::uuid;
    end if;
    v_ids := v_ids || (v_el ->> 'id')::uuid;
    v_types := v_types || (v_el ->> 'type');
    v_ads := v_ads || (v_el ->> 'ad')::uuid;
    v_places := v_places || v_place;
  end loop;

  -- Reenvios (retry após timeout, lote repetido por script): uma busca pela PK dos marcadores. Se TODOS os eventos
  -- já foram processados, a chamada termina aqui, sem consultar usuário/anúncio e sem lock.
  select coalesce(array_agg(m.event_id), '{}') into v_seen
    from public.sponsored_ad_event_marks m where m.user_id = v_uid and m.event_id = any (v_ids);
  if not exists (select 1 from unnest(v_ids) i where i <> all (v_seen)) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  -- Conta já no teto diário/horário (estado estável de um script que não para): sai antes de consultar usuário e
  -- anúncios. É só uma saída antecipada; a decisão que vale é refeita com o lock, mais abaixo.
  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;
  if v_daily >= c_max_daily or v_hourly >= c_max_hourly then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  -- Acesso do usuário (conta desativada/em exclusão, restrição, aceite legal...) e superadmin (prévias de
  -- campanha não contam): lote ignorado em silêncio, sem erro para o cliente tentar de novo.
  if not coalesce(public.has_app_access(), false) or coalesce(public.is_superadmin(), false) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  -- Elegibilidade (só leituras), decidida AQUI com dados e relógio do servidor. A ordenação por anúncio permite
  -- reaproveitar a última leitura: 20 eventos do mesmo anúncio inexistente/vencido custam UMA consulta.
  for v_rec in
    select t.id, t.type, t.ad, t.placement, t.ctx
      from unnest(v_ids, v_types, v_ads, v_places, v_ctxs) as t(id, type, ad, placement, ctx)
     order by t.ad, t.placement, t.ctx, (t.type = 'click'), t.id
  loop
    continue when v_rec.id = any (v_seen);

    if v_last_ad is distinct from v_rec.ad then
      select a.partner_name, a.display_mode, a.is_global, a.community_ids, a.expires_at into v_ad
        from public.sponsored_ads a where a.id = v_rec.ad;
      v_ad_found := found;
      v_last_ad := v_rec.ad;
    end if;
    continue when not v_ad_found
      or (v_ad.expires_at is not null and v_ad.expires_at <= now());

    if v_rec.placement = 'home_banner' then
      continue when not (v_ad.is_global and 'banner' = any (v_ad.display_mode));
    else
      continue when not (v_rec.ctx = any (v_ad.community_ids))
        or not ((case v_rec.placement when 'community_banner' then 'banner' else 'feed' end)
                = any (v_ad.display_mode));
      -- Participação real (inclui comunidade ativa e banimento), uma consulta por comunidade distinta.
      if v_rec.ctx = any (v_bad_ctx) then continue; end if;
      if not (v_rec.ctx = any (v_ok_ctx)) then
        v_member := coalesce(public.is_community_member(v_rec.ctx), false);
        if v_member then v_ok_ctx := v_ok_ctx || v_rec.ctx; else v_bad_ctx := v_bad_ctx || v_rec.ctx; continue; end if;
      end if;
    end if;

    v_e_ids := v_e_ids || v_rec.id;
    v_e_types := v_e_types || v_rec.type;
    v_e_ads := v_e_ads || v_rec.ad;
    v_e_places := v_e_places || v_rec.placement;
    v_e_ctxs := v_e_ctxs || v_rec.ctx;
    v_e_partners := v_e_partners || v_ad.partner_name;
  end loop;

  if cardinality(v_e_ids) = 0 then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  -- A partir daqui há algo a gravar. Serializa as chamadas do MESMO usuário (outra aba, retry concorrente): a
  -- decisão "primeira impressão do dia" e os tetos leem os marcadores e precisam enxergar a chamada anterior.
  perform pg_advisory_xact_lock(hashtextextended('record_ad_events:' || v_uid::text, 0));

  -- Tetos por conta numa só leitura (prefixo user_id da PK; os marcadores nascem com expires_at = agora + 48 h, logo
  -- "expires_at > agora + 47 h" = aceito na última hora).
  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;

  -- Ordem determinística por chave de agregado: cada chave é gravada uma vez, e duas chamadas concorrentes
  -- travam as linhas agregadas na MESMA ordem (sem deadlock).
  for v_i in 1 .. cardinality(v_e_ids) loop
    -- Fecha o grupo anterior ao mudar de chave.
    if v_cur_ad is not null
       and (v_cur_ad, v_cur_place, v_cur_ctx) is distinct from (v_e_ads[v_i], v_e_places[v_i], v_e_ctxs[v_i]) then
      insert into public.sponsored_ad_daily_stats as s
        (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
      values (v_day, v_cur_ad, v_cur_place, v_cur_ctx, v_cur_partner, v_d_imp, v_d_uniq, v_d_clk, v_d_unq)
      on conflict (day, ad_id, placement, context_id) do update
        set visible_impressions = s.visible_impressions + excluded.visible_impressions,
            unique_viewers = s.unique_viewers + excluded.unique_viewers,
            clicks = s.clicks + excluded.clicks,
            unqualified_clicks = s.unqualified_clicks + excluded.unqualified_clicks,
            updated_at = now();
      v_cur_ad := null; v_d_imp := 0; v_d_uniq := 0; v_d_clk := 0; v_d_unq := 0;
    end if;

    exit when v_daily >= c_max_daily or v_hourly >= c_max_hourly;

    select count(*) filter (where m.kind = 'impression' and m.day = v_day) as imp_today,
           count(*) filter (where m.kind = 'impression') as imp_any,
           count(*) filter (where m.kind = 'click' and m.day = v_day) as clk_today
      into v_cnt
      from public.sponsored_ad_event_marks m
     where m.user_id = v_uid and m.ad_id = v_e_ads[v_i] and m.placement = v_e_places[v_i]
       and m.context_id = v_e_ctxs[v_i];

    if v_e_types[v_i] = 'impression' then
      continue when v_cnt.imp_today >= c_max_impressions;
    else
      -- Clique NÃO exige impressão prévia (ver cabeçalho); só respeita o teto.
      continue when v_cnt.clk_today >= c_max_clicks;
    end if;

    insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
    values (v_uid, v_e_ids[v_i], v_e_types[v_i], v_day, v_e_ads[v_i], v_e_places[v_i], v_e_ctxs[v_i])
    on conflict (user_id, event_id) do nothing;
    get diagnostics v_inserted = row_count;
    continue when v_inserted = 0;  -- processado por chamada concorrente que acabou de terminar: idempotente

    v_daily := v_daily + 1;
    v_hourly := v_hourly + 1;
    v_accepted := v_accepted + 1;
    v_cur_ad := v_e_ads[v_i]; v_cur_place := v_e_places[v_i]; v_cur_ctx := v_e_ctxs[v_i]; v_cur_partner := v_e_partners[v_i];
    if v_e_types[v_i] = 'impression' then
      v_d_imp := v_d_imp + 1;
      if v_cnt.imp_today = 0 then v_d_uniq := v_d_uniq + 1; end if;
    else
      v_d_clk := v_d_clk + 1;
      -- Sem impressão retida desta conta na chave: clique "não qualificado" (separado para o CTR futuro).
      if v_cnt.imp_any = 0 then v_d_unq := v_d_unq + 1; end if;
    end if;
  end loop;

  if v_cur_ad is not null then
    insert into public.sponsored_ad_daily_stats as s
      (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
    values (v_day, v_cur_ad, v_cur_place, v_cur_ctx, v_cur_partner, v_d_imp, v_d_uniq, v_d_clk, v_d_unq)
    on conflict (day, ad_id, placement, context_id) do update
      set visible_impressions = s.visible_impressions + excluded.visible_impressions,
          unique_viewers = s.unique_viewers + excluded.unique_viewers,
          clicks = s.clicks + excluded.clicks,
          unqualified_clicks = s.unqualified_clicks + excluded.unqualified_clicks,
          updated_at = now();
  end if;

  return jsonb_build_object('enabled', true, 'accepted', v_accepted);
end;
$$;

revoke all on function public.record_ad_events(jsonb) from public, anon;
grant execute on function public.record_ad_events(jsonb) to authenticated;
drop function if exists public.admin_set_ad_metrics_opt_out(uuid, boolean);
