-- Métricas de patrocinados (Fase 2: COLETA). Impressões visíveis, alcance único diário e cliques por
-- anúncio x posicionamento x contexto x dia. Sem dashboard, sem cobrança.
--
-- Princípios:
--  * O cliente só REPORTA "vi" / "cliquei" com ids; o servidor decide se o evento conta (anúncio existe,
--    está vigente AGORA, é elegível para o posicionamento, o usuário tem acesso) e define o dia.
--  * Só agregados diários (longo prazo) + marcadores temporários (48 h) estritamente necessários para
--    idempotência, alcance único e teto por usuário. Nenhuma tabela permanente de eventos brutos.
--  * Clique NÃO depende de impressão prévia (o usuário pode clicar antes de completar 1 s visível ou antes de a
--    impressão chegar ao servidor). Nunca se cria impressão para justificar clique: o clique sem impressão retida da
--    conta na mesma chave entra em `clicks` E em `unqualified_clicks`, para a leitura futura separar o CTR.
--  * Coleta DESLIGADA por padrão no servidor (sponsored_ad_metrics_settings.collection_enabled = false):
--    ligar exige UPDATE explícito depois da aprovação jurídica e da homologação.
--  * São estimativas operacionais, não comprovação de entrega para cobrança.
--
-- Posicionamento (placement) = formato + lugar:
--    home_banner       banner rotativo da Home (anúncio is_global com 'banner'); contexto = Home
--    community_banner  banner rotativo da comunidade ('banner' em display_mode); contexto = comunidade
--    community_feed    card no feed da comunidade ('feed' em display_mode); contexto = comunidade
--
-- Contexto estável: context_id é SEMPRE not null. Home usa o uuid zero (sem FK, de propósito); comunidade usa
-- o id da comunidade. Assim chaves únicas e deduplicação não dependem de NULL (NULL <> NULL em unique).
--
-- Dia de relatório: fecha à meia-noite de America/Sao_Paulo, calculado SEMPRE no servidor
-- (private.ad_metrics_day). Timestamps ficam em UTC (timestamptz).

create schema if not exists private;

-- ---------------------------------------------------------------------------------------------------
-- 0. Chave de coleta no servidor (kill switch independente da flag de build do cliente).
-- ---------------------------------------------------------------------------------------------------
create table public.sponsored_ad_metrics_settings (
  id boolean primary key default true check (id),
  collection_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
insert into public.sponsored_ad_metrics_settings default values;
alter table public.sponsored_ad_metrics_settings enable row level security;
revoke all on public.sponsored_ad_metrics_settings from public, anon, authenticated;
grant select, update on public.sponsored_ad_metrics_settings to service_role;

-- ---------------------------------------------------------------------------------------------------
-- 1. Agregados diários (retenção sugerida: 24 meses). Lidos só pelo superadmin.
--    Sem FK para sponsored_ads de propósito: apagar uma campanha não apaga o histórico; partner_name é um
--    retrato de quando a linha do dia foi criada.
-- ---------------------------------------------------------------------------------------------------
create table public.sponsored_ad_daily_stats (
  day date not null,
  ad_id uuid not null,
  placement text not null check (placement in ('home_banner', 'community_banner', 'community_feed')),
  context_id uuid not null,
  partner_name text not null check (char_length(partner_name) between 1 and 60),
  visible_impressions bigint not null default 0 check (visible_impressions >= 0),
  unique_viewers bigint not null default 0 check (unique_viewers >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  -- subconjunto de `clicks` recebido quando a conta NÃO tinha impressão retida (48 h) naquela chave: clique rápido,
  -- impressão ainda não enviada/qualificada, ou evento forjado. CTR bruto = clicks / visible_impressions; CTR
  -- "qualificado" = (clicks - unqualified_clicks) / visible_impressions.
  unqualified_clicks bigint not null default 0 check (unqualified_clicks >= 0),
  updated_at timestamptz not null default now(),
  primary key (day, ad_id, placement, context_id),
  constraint sponsored_ad_daily_stats_context_shape check (
    (placement = 'home_banner') = (context_id = '00000000-0000-0000-0000-000000000000')
  ),
  -- alcance único nunca passa das impressões (cada único é uma impressão aceita)
  constraint sponsored_ad_daily_stats_unique_le_impressions check (unique_viewers <= visible_impressions),
  -- clique NÃO é limitado pelas impressões (pode haver clique sem impressão), mas o subconjunto sem impressão é
  -- limitado pelos cliques
  constraint sponsored_ad_daily_stats_unqualified_le_clicks check (unqualified_clicks <= clicks)
);

alter table public.sponsored_ad_daily_stats enable row level security;
create policy sponsored_ad_daily_stats_select on public.sponsored_ad_daily_stats for select
  using (public.is_superadmin());
-- Sem policy de escrita: só a RPC (SECURITY DEFINER) grava.
revoke all on public.sponsored_ad_daily_stats from public, anon, authenticated;
grant select on public.sponsored_ad_daily_stats to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2+3. Marcador temporário ÚNICO: uma linha por evento aceito, com vida de 48 h. Serve ao mesmo tempo para
--      idempotência (PK user_id + event_id: retry/reenvio não conta de novo), alcance único (primeira
--      impressão do usuário no dia para a chave ad+placement+contexto) e teto por usuário/dia.
--      Combinar os dois marcadores evita uma segunda tabela e uma segunda escrita por evento.
--      Nunca legível por usuários comuns (RLS ligada, sem policy, sem GRANT). Cascata na exclusão de conta.
-- ---------------------------------------------------------------------------------------------------
create table public.sponsored_ad_event_marks (
  user_id uuid not null references public.users(id) on delete cascade,
  event_id uuid not null,
  kind text not null check (kind in ('impression', 'click')),
  day date not null,
  ad_id uuid not null,
  placement text not null check (placement in ('home_banner', 'community_banner', 'community_feed')),
  context_id uuid not null,
  expires_at timestamptz not null default now() + interval '48 hours',
  primary key (user_id, event_id)
);
-- Sem índice em expires_at de propósito: medido com 150 mil marcadores, a limpeza horária (~3% da tabela vencida)
-- leva ~16 ms por varredura sequencial contra ~14 ms com índice, e o índice custaria ~9 MB e uma escrita extra em
-- cada evento. Reavaliar se a tabela passar de algumas centenas de milhares de linhas. As consultas de decisão
-- usam só o prefixo user_id da PK (no máximo ~300 linhas por usuário/dia).

alter table public.sponsored_ad_event_marks enable row level security;
revoke all on public.sponsored_ad_event_marks from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Dia de relatório (fuso de negócio). Função separada para ser testável com instantes fixos.
-- ---------------------------------------------------------------------------------------------------
create function private.ad_metrics_day(p_at timestamptz) returns date
  language sql immutable parallel safe set search_path = '' as $$
    select (p_at at time zone 'America/Sao_Paulo')::date
$$;
revoke all on function private.ad_metrics_day(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 4. RPC de ingestão em lote.
--    SECURITY DEFINER é necessário: as tabelas acima não têm GRANT/policy de escrita para ninguém, e dar
--    INSERT direto ao papel authenticated permitiria forjar contadores. Mitigações: search_path vazio e todos
--    os objetos qualificados; sem SQL dinâmico; user_id vem SEMPRE de auth.uid(); elegibilidade e acesso
--    replicam as regras reais (has_app_access, is_community_member, vigência, display_mode, is_global,
--    community_ids) porque o RLS de sponsored_ads não vale dentro de uma função definer.
--
--    Evento: {"id": uuid, "type": "impression"|"click", "ad": uuid,
--             "placement": "home_banner"|"community_banner"|"community_feed", "community": uuid|null}
--    Qualquer outro formato/campo/tipo, > 20 eventos ou > 8 KiB => exceção INVALID_EVENTS (lote inteiro).
--    Evento semanticamente inelegível (vencido, fora de lugar, não membro...) é ignorado em silêncio.
--    Retorno: {"enabled": bool, "accepted": n} -- nunca contadores internos nem dados de outros usuários.
--
--    Ordem de custo CRESCENTE (chamada abusiva morre cedo e sem escrever nada):
--      1 auth.uid()  2 chave do servidor  3 contagem/tamanho  4 forma de cada evento (sem consulta)
--      5 reenvios (um ANY sobre a PK de marcadores)  6 acesso da conta  7 elegibilidade (leituras; 1 consulta por
--      anúncio distinto)  8 SÓ SE sobrou evento elegível: lock por usuário, contagens e gravação.
--    Chamadas rejeitadas não escrevem nada (nem contador de rejeição) e não tomam o lock do usuário.
-- ---------------------------------------------------------------------------------------------------
create function public.record_ad_events(events jsonb) returns jsonb
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

-- ---------------------------------------------------------------------------------------------------
-- 5. Retenção. Marcadores: 48 h (horário). Agregados: 24 meses (mensal). cron.schedule com o mesmo nome
--    substitui o job anterior (nunca cria um segundo). Reversão: cron.unschedule dos dois nomes abaixo.
-- ---------------------------------------------------------------------------------------------------
create function private.cleanup_sponsored_ad_metrics() returns integer
  language plpgsql security definer set search_path = '' as $$
declare v_marks integer;
begin
  delete from public.sponsored_ad_event_marks where expires_at < now();
  get diagnostics v_marks = row_count;
  return v_marks;
end;
$$;
revoke all on function private.cleanup_sponsored_ad_metrics() from public, anon, authenticated;

create function private.cleanup_sponsored_ad_stats() returns integer
  language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  delete from public.sponsored_ad_daily_stats
   where day < (private.ad_metrics_day(now()) - interval '24 months')::date;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function private.cleanup_sponsored_ad_stats() from public, anon, authenticated;

select cron.schedule('cleanup-sponsored-ad-marks', '11 * * * *', $$select private.cleanup_sponsored_ad_metrics()$$);
select cron.schedule('cleanup-sponsored-ad-stats', '41 4 1 * *', $$select private.cleanup_sponsored_ad_stats()$$);
