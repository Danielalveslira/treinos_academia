set local lock_timeout='5s';
set local statement_timeout='30s';
-- Novo posicionamento `progress_banner`, independente de `home_banner`: superfície global
-- (zero UUID, como Home), formato banner compacto, venda e exibição desligadas por padrão.
-- Administração precisa configurar preço/capacidade e ligar os gates explicitamente
-- (sales_enabled/delivery_enabled no posicionamento e sales_enabled na oferta comercial)
-- depois de validar a cadeia completa -- nada aqui começa a vender.
insert into public.commercial_offerings(code,name,description) values
('ad_progress','Publicidade no Progresso','Elegibilidade de publicidade na página de Progresso.');
-- O adaptador está implementado nesta migration. Preço, vendas, capacidade e entrega
-- continuam desligados; a administração pode liberá-los após homologação.
update public.commercial_offerings set integration_ready=true where code='ad_progress';

-- Sem documento mapeado, `capture_commercial_quote_terms` grava document_id=null em toda
-- cotação desta oferta e `accept_commercial_terms` recusa para sempre com
-- COMMERCIAL_TERMS_UNAVAILABLE (ver 20261212000002_commercial_terms_evidence.sql: "nenhuma
-- oferta fica isenta"). Mesmo termo já usado por ad_home/ad_community/ad_network.
insert into private.commercial_offering_documents(offering_code,document_id) values
 ('ad_progress','advertising-terms');

-- display_limit=4: mesmo formato de banner rotativo compacto do home_banner (ver
-- 20261207000006_advertising_home_banner_rotation.sql), mesma justificativa de amostra.
insert into public.advertising_placements(code,name,description,surface,content_type,offering_code,display_limit) values
 ('progress_banner','Banner no Progresso','Banner patrocinado compacto na página de Progresso, independente do Banner da Home.','home','banner','ad_progress',4);

-- `is_global` era calculado como `'home_banner'=any(scope)` -- certo só porque até aqui
-- 'home_banner' era o único posicionamento de superfície `home`. Generalizado para qualquer
-- posicionamento de superfície `home` (inclui `progress_banner` agora, e qualquer futuro).
-- Sem este fix, uma campanha gerida só de `progress_banner` nasceria com is_global=false e
-- teria seus eventos de impressão/clique descartados em record_ad_events (ver abaixo).
-- Corpo idêntico ao de 20261205000002_advertising_campaigns.sql no resto.
create or replace function public.create_advertising_campaign(p_account uuid,p_placement text,p_community uuid,p_title text,p_description text,p_destination text,p_request_id uuid) returns uuid
language plpgsql security definer set search_path='' set lock_timeout='5s' as $$
declare a public.advertiser_accounts; id uuid; offering text; scope text[]; existing private.advertising_drafts;
begin
 perform private.require_advertising_editor(p_account);
 perform 1 from public.users u where u.id=auth.uid() for no key update;
 select * into a from public.advertiser_accounts ac where ac.id=p_account for share;
 perform private.require_advertising_editor(p_account);
 if a.owner_user_id is null then raise exception 'AD_ACCOUNT_OWNER_REQUIRED'; end if;
 if p_request_id is null then raise exception 'AD_REQUEST_REQUIRED'; end if;
 select * into existing from private.advertising_drafts where ad_id=p_request_id;
 if found then
 if existing.account_id<>p_account or existing.creation_request is distinct from jsonb_build_object('placement',p_placement,'community',p_community,'title',p_title,'description',p_description,'destination',p_destination) then raise exception 'IDEMPOTENCY_CONFLICT'; end if;
 return existing.ad_id;
 end if;
 if p_placement='network' then
 select array_agg(placement_code order by placement_code) into scope from private.advertising_network_bundle;
 if coalesce(cardinality(scope),0)=0 then raise exception 'AD_NETWORK_UNCONFIGURED'; end if;
 offering:='ad_network';
 else
 select array[code],offering_code into scope,offering from public.advertising_placements where code=p_placement;
 if not found then raise exception 'AD_PLACEMENT_NOT_FOUND'; end if;
 end if;
 if exists(select 1 from public.advertising_placements where code=any(scope) and surface='community') then
 if p_community is null or not exists(select 1 from public.communities c where c.id=p_community and owner_id=a.owner_user_id and is_active) then raise exception 'AD_COMMUNITY_NOT_AUTHORIZED'; end if;
 elsif p_community is not null then raise exception 'AD_CONTEXT_INVALID'; end if;
 if (select count(*) from private.advertising_drafts d where d.account_id=p_account)>=100 then raise exception 'AD_DRAFT_LIMIT'; end if;
 id:=p_request_id;
 insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision) values(id,offering,a.owner_user_id,1);
 insert into public.sponsored_ads(id,partner_name,title,description,cta_label,cta_type,cta_target,community_ids,is_global,display_mode,created_by,commercial_resource_id)
 values(id,left(a.name,60),'Em preparação','','Saiba mais','external',p_destination,
 case when p_community is null then '{}'::uuid[] else array[p_community] end,
 exists(select 1 from public.advertising_placements where code=any(scope) and surface='home'),
 array(select distinct content_type from public.advertising_placements where code=any(scope)),a.owner_user_id,id);
 insert into private.advertising_drafts(ad_id,account_id,title,description,destination,creation_request) values(id,p_account,p_title,p_description,p_destination,jsonb_build_object('placement',p_placement,'community',p_community,'title',p_title,'description',p_description,'destination',p_destination));
 insert into public.advertiser_campaigns(ad_id,account_id,title,partner_name,linked_by) values(id,p_account,p_title,left(a.name,60),auth.uid());
 insert into private.advertising_resource_inventory(resource_id,placement_code,context_id)
 select id,p.code,case when p.surface='home' then '00000000-0000-0000-0000-000000000000'::uuid else p_community end from public.advertising_placements p where code=any(scope);
 insert into public.advertising_operations(actor_user_id,resource_id,action,reason) values(auth.uid(),id,'create','Campanha criada sem cobrança');
 return id;
end $$;

-- Estende a validação de `placement` e as duas regras de elegibilidade legada para incluir
-- `progress_banner`, SEM reabrir o vazamento do item 2: um anúncio legado nunca é elegível
-- para `progress_banner` (só campanha gerida, já validada acima por advertising_eligible).
-- Corpo idêntico ao de 20261205000003_advertising_authorization_metrics.sql, com:
--  * 'progress_banner' somado à lista de placements aceitos e à regra "sem campo community";
--  * `a.commercial_resource_id` somado à leitura de v_ad;
--  * ramo `elsif v_rec.placement = 'progress_banner'` novo, que rejeita linha legada de cara.
create or replace function public.record_ad_events(events jsonb) returns jsonb
  language plpgsql security definer set search_path = '' as $$
declare
  c_nil constant uuid := '00000000-0000-0000-0000-000000000000';
  c_uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  c_max_events constant integer := 20;
  c_max_bytes constant integer := 8192;
  c_max_impressions constant integer := 10;
  c_max_clicks constant integer := 5;
  c_max_daily constant integer := 300;
  c_max_hourly constant integer := 100;
  v_uid uuid := auth.uid();
  v_enabled boolean;
  v_exclude_minors boolean;
  v_birth date;
  v_opted_out boolean;
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

  select s.collection_enabled, s.exclude_minors into v_enabled, v_exclude_minors
    from public.sponsored_ad_metrics_settings s where s.id;
  if not coalesce(v_enabled, false) then
    return jsonb_build_object('enabled', false, 'accepted', 0);
  end if;

  if events is null or jsonb_typeof(events) <> 'array'
     or jsonb_array_length(events) > c_max_events
     or octet_length(events::text) > c_max_bytes then
    raise exception 'INVALID_EVENTS';
  end if;
  if jsonb_array_length(events) = 0 then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  for v_el in select value from jsonb_array_elements(events) loop
    if (case when jsonb_typeof(v_el) = 'object'
         then (v_el - array['id', 'type', 'ad', 'placement', 'community']) <> '{}'::jsonb else true end)
       or jsonb_typeof(v_el -> 'id') is distinct from 'string'
       or jsonb_typeof(v_el -> 'type') is distinct from 'string'
       or jsonb_typeof(v_el -> 'ad') is distinct from 'string'
       or jsonb_typeof(v_el -> 'placement') is distinct from 'string'
       or (v_el ->> 'id') !~* c_uuid_re
       or (v_el ->> 'ad') !~* c_uuid_re
       or (v_el ->> 'type') not in ('impression', 'click')
       or (v_el ->> 'placement') not in ('home_banner', 'community_banner', 'community_feed', 'progress_banner') then
      raise exception 'INVALID_EVENTS';
    end if;
    v_place := v_el ->> 'placement';
    if v_place in ('home_banner', 'progress_banner') then
      -- Nem Home nem Progresso têm comunidade: ausente ou null; qualquer outro valor é
      -- tentativa de falsificar contexto.
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

  select coalesce(array_agg(m.event_id), '{}') into v_seen
    from public.sponsored_ad_event_marks m where m.user_id = v_uid and m.event_id = any (v_ids);
  if not exists (select 1 from unnest(v_ids) i where i <> all (v_seen)) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;
  if v_daily >= c_max_daily or v_hourly >= c_max_hourly then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  if not coalesce(public.has_app_access(), false) or coalesce(public.is_superadmin(), false) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  select u.data_nascimento, exists (select 1 from public.sponsored_ad_metrics_opt_outs o where o.user_id = u.id)
    into v_birth, v_opted_out
    from public.users u where u.id = v_uid;
  if coalesce(v_opted_out, false)
     or (coalesce(v_exclude_minors, true) and (v_birth is null or extract(year from age(now(), v_birth)) < 18)) then
    return jsonb_build_object('enabled', true, 'accepted', 0);
  end if;

  for v_rec in
    select t.id, t.type, t.ad, t.placement, t.ctx
      from unnest(v_ids, v_types, v_ads, v_places, v_ctxs) as t(id, type, ad, placement, ctx)
     order by t.ad, t.placement, t.ctx, (t.type = 'click'), t.id
  loop
    continue when v_rec.id = any (v_seen);

    if v_last_ad is distinct from v_rec.ad then
      select a.partner_name, a.display_mode, a.is_global, a.community_ids, a.expires_at, a.commercial_resource_id into v_ad
        from public.sponsored_ads a where a.id = v_rec.ad;
      v_ad_found := found;
      v_last_ad := v_rec.ad;
    end if;
    continue when exists(select 1 from public.sponsored_ads ma where ma.id=v_rec.ad and ma.commercial_resource_id is not null)
      and (not private.advertising_eligible(v_rec.ad,v_rec.placement,v_rec.ctx)
        or exists(select 1 from public.advertiser_campaigns ac join public.advertiser_members m on m.account_id=ac.account_id
          where ac.ad_id=v_rec.ad and m.user_id=v_uid and m.revoked_at is null));
    continue when not v_ad_found
      or (v_ad.expires_at is not null and v_ad.expires_at <= now());
    -- A coleta também respeita o bloqueio administrativo para anúncios legados.
    continue when not exists (
      select 1 from public.advertising_placements ap
       where ap.code = v_rec.placement and ap.delivery_enabled
    );

    if v_rec.placement = 'home_banner' then
      continue when not (v_ad.is_global and 'banner' = any (v_ad.display_mode));
    elsif v_rec.placement = 'progress_banner' then
      -- Anúncio legado (commercial_resource_id is null) nunca é elegível para Progresso: só
      -- campanha gerida, já validada acima por advertising_eligible. Sem este ramo próprio, um
      -- evento forjado apontando pro id de um anúncio global do home_banner (is_global=true)
      -- seria aceito aqui como se fosse de Progresso.
      continue when v_ad.commercial_resource_id is null;
    else
      continue when not (v_rec.ctx = any (v_ad.community_ids))
        or not ((case v_rec.placement when 'community_banner' then 'banner' else 'feed' end)
                = any (v_ad.display_mode));
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

  perform pg_advisory_xact_lock(hashtextextended('record_ad_events:' || v_uid::text, 0));

  select count(*) filter (where m.day = v_day),
         count(*) filter (where m.expires_at > now() + interval '47 hours')
    into v_daily, v_hourly
    from public.sponsored_ad_event_marks m where m.user_id = v_uid;

  for v_i in 1 .. cardinality(v_e_ids) loop
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
      continue when v_cnt.clk_today >= c_max_clicks;
    end if;

    insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
    values (v_uid, v_e_ids[v_i], v_e_types[v_i], v_day, v_e_ads[v_i], v_e_places[v_i], v_e_ctxs[v_i])
    on conflict (user_id, event_id) do nothing;
    get diagnostics v_inserted = row_count;
    continue when v_inserted = 0;

    v_daily := v_daily + 1;
    v_hourly := v_hourly + 1;
    v_accepted := v_accepted + 1;
    v_cur_ad := v_e_ads[v_i]; v_cur_place := v_e_places[v_i]; v_cur_ctx := v_e_ctxs[v_i]; v_cur_partner := v_e_partners[v_i];
    if v_e_types[v_i] = 'impression' then
      v_d_imp := v_d_imp + 1;
      if v_cnt.imp_today = 0 then v_d_uniq := v_d_uniq + 1; end if;
    else
      v_d_clk := v_d_clk + 1;
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

-- Permite `progress_banner` nas mesmas colunas `placement` da coleta de métricas.
-- Aditivo: drop+add do check, nunca editando a migration original.
alter table public.sponsored_ad_event_marks drop constraint sponsored_ad_event_marks_placement_check;
alter table public.sponsored_ad_event_marks add constraint sponsored_ad_event_marks_placement_check
  check (placement in ('home_banner', 'community_banner', 'community_feed', 'progress_banner'));

alter table public.sponsored_ad_daily_stats drop constraint sponsored_ad_daily_stats_placement_check;
alter table public.sponsored_ad_daily_stats add constraint sponsored_ad_daily_stats_placement_check
  check (placement in ('home_banner', 'community_banner', 'community_feed', 'progress_banner'));

alter table public.sponsored_ad_daily_stats drop constraint sponsored_ad_daily_stats_context_shape;
alter table public.sponsored_ad_daily_stats add constraint sponsored_ad_daily_stats_context_shape
  check ((placement in ('home_banner', 'progress_banner')) = (context_id = '00000000-0000-0000-0000-000000000000'));

-- Mesmas duas RPCs de leitura agregada (dashboard do admin e snapshot do anunciante),
-- somando 'progress_banner' ao filtro validado e às ordenações por posicionamento, e à
-- regra "sem nome de comunidade" (Home e Progresso não têm comunidade).
create or replace function public.get_sponsored_ad_metrics_dashboard(
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

  if p_placement is not null and p_placement not in ('home_banner', 'community_banner', 'community_feed', 'progress_banner') then
    raise exception 'INVALID_FILTER';
  end if;

  if p_from is null and p_to is null then
    if p_days is null or p_days < 1 or p_days > c_max_days then raise exception 'INVALID_RANGE'; end if;
    v_to := v_today;
    v_from := v_today - (p_days - 1);
  else
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > c_max_days
       or p_to > v_today or p_from < date '2020-01-01' then
      raise exception 'INVALID_RANGE';
    end if;
    v_from := p_from;
    v_to := p_to;
  end if;

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
                                                 order by array_position(array['home_banner', 'community_banner', 'community_feed', 'progress_banner'], p.placement))
                                from per_placement p), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object(
                                 'ad_id', r.ad_id,
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
                                'community_name', case when r.placement in ('home_banner', 'progress_banner') then null else r.community_name end)
                              || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                              from context_rows r where r.rn <= c_context_limit), '[]'::jsonb),
    'contexts_total', (select count(*) from context_rows),
    'contexts_truncated', (select count(*) > c_context_limit from context_rows)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function private.advertiser_snapshot(
  p_account_id uuid,
  p_campaign_offset integer,
  p_context_offset integer,
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
  c_campaign_limit constant integer := 100;
  c_context_limit constant integer := 100;
  v_today date := private.ad_metrics_day(now());
  v_from date;
  v_to date;
  v_result jsonb;
begin
  if p_campaign_offset is null or p_campaign_offset < 0 or p_campaign_offset > 100000
     or p_context_offset is null or p_context_offset < 0 or p_context_offset > 100000 then
    raise exception 'INVALID_FILTER';
  end if;

  if p_placement is not null and p_placement not in ('home_banner', 'community_banner', 'community_feed', 'progress_banner') then
    raise exception 'INVALID_FILTER';
  end if;

  if p_from is null and p_to is null then
    if p_days is null or p_days < 1 or p_days > c_max_days then raise exception 'INVALID_RANGE'; end if;
    v_to := v_today;
    v_from := v_today - (p_days - 1);
  else
    if p_from is null or p_to is null or p_to < p_from or p_to - p_from + 1 > c_max_days
       or p_to > v_today or p_from < date '2020-01-01' then
      raise exception 'INVALID_RANGE';
    end if;
    v_from := p_from;
    v_to := p_to;
  end if;

  with base as (
    select s.day, s.ad_id, s.placement, s.context_id, s.partner_name,
           s.visible_impressions, s.unique_viewers, s.clicks, s.unqualified_clicks
      from public.sponsored_ad_daily_stats s
     where s.day between v_from and v_to
       and (p_account_id is null or exists (select 1 from public.advertiser_campaigns ac
            where ac.ad_id = s.ad_id and ac.account_id = p_account_id))
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
    select c.*, coalesce(a.title, ac.title) as title, coalesce(a.partner_name, ac.partner_name) as current_name, coalesce(a.expires_at, ac.expires_at) as expires_at, a.image_url, a.created_at as starts_at, (a.id is null) as deleted,
           row_number() over (order by c.imp desc, c.clk desc, c.ad_id) as rn
      from agg c left join public.sponsored_ads a on a.id = c.ad_id left join public.advertiser_campaigns ac on ac.ad_id=c.ad_id
     where c.g = 11
  ),
  context_rows as (
    select x.*, cm.name as community_name,
           row_number() over (order by x.imp desc, x.clk desc, x.placement, x.context_id) as rn
      from agg x left join public.communities cm on cm.id = x.context_id
     where x.g = 12
  )
  select jsonb_build_object(
    'generated_at', statement_timestamp(),
    'period', jsonb_build_object('from', v_from, 'to', v_to, 'days', v_to - v_from + 1, 'today', v_today,
                                 'timezone', 'America/Sao_Paulo'),
    'filters', jsonb_build_object('ad_id', p_ad_id, 'community_id', p_community_id, 'placement', p_placement),
    'collection', jsonb_build_object(
      'server_enabled', coalesce((select st.collection_enabled from public.sponsored_ad_metrics_settings st where st.id), false),
      'has_any_data', exists (select 1 from public.sponsored_ad_daily_stats h where (p_ad_id is null or h.ad_id=p_ad_id) and (p_account_id is null or exists(select 1 from public.advertiser_campaigns ac where ac.ad_id=h.ad_id and ac.account_id=p_account_id))),
      'last_day', (select max(s2.day) from public.sponsored_ad_daily_stats s2 where (p_ad_id is null or s2.ad_id=p_ad_id) and (p_account_id is null or exists(select 1 from public.advertiser_campaigns ac where ac.ad_id=s2.ad_id and ac.account_id=p_account_id)))
    ),
    'has_data', (select sm.row_count > 0 from summary sm),
    'summary', (select private.ad_metrics_object(case when sm.row_count > 0 then sm.imp end, case when sm.row_count > 0 then sm.uniq end, case when sm.row_count > 0 then sm.clk end, case when sm.row_count > 0 then sm.unq end) from summary sm),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', d.day) || private.ad_metrics_object(d.imp, d.uniq, d.clk, d.unq)
                                          order by d.day) from daily d), '[]'::jsonb),
    'by_placement', coalesce((select jsonb_agg(jsonb_build_object('placement', p.placement) || private.ad_metrics_object(p.imp, p.uniq, p.clk, p.unq)
                                                 order by array_position(array['home_banner', 'community_banner', 'community_feed', 'progress_banner'], p.placement))
                                from per_placement p), '[]'::jsonb),
    'by_campaign', coalesce((select jsonb_agg(jsonb_build_object(
                                 'ad_id', r.ad_id,
                                 'partner_name', coalesce(r.current_name, (
                                   select h.partner_name from public.sponsored_ad_daily_stats h
                                    where h.ad_id = r.ad_id and h.day between v_from and v_to
                                    order by h.day desc limit 1)),
                                 'image_url', r.image_url, 'starts_at', r.starts_at, 'title', r.title, 'deleted', r.deleted, 'expires_at', r.expires_at)
                               || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                               from campaign_rows r where r.rn > p_campaign_offset and r.rn <= p_campaign_offset + c_campaign_limit), '[]'::jsonb),
    'campaigns_total', (select count(*) from campaign_rows),
    'campaigns_truncated', (select count(*) > p_campaign_offset + c_campaign_limit from campaign_rows),
    'by_context', coalesce((select jsonb_agg(jsonb_build_object(
                                'placement', r.placement, 'context_id', r.context_id,
                                'community_name', case when r.placement in ('home_banner', 'progress_banner') then null else r.community_name end)
                              || private.ad_metrics_object(r.imp, r.uniq, r.clk, r.unq) order by r.rn)
                              from context_rows r where r.rn > p_context_offset and r.rn <= p_context_offset + c_context_limit), '[]'::jsonb),
    'contexts_total', (select count(*) from context_rows),
    'contexts_truncated', (select count(*) > p_context_offset + c_context_limit from context_rows)
  ) into v_result;

  return v_result;
end;
$$;

-- RLS de `sponsored_ads` (policy sponsored_ads_select) hardcodava 'home_banner' no ramo de
-- linha gerida -- sem isso, uma campanha gerida só de progress_banner nunca passaria RLS em
-- leitura direta da tabela (hoje nenhum caminho de cliente faz essa leitura direta fora do
-- admin, mas é a fronteira de segurança declarada: não deve ficar incompleta). Corpo idêntico
-- ao de 20261205000013_advertising_rls_gate.sql, só somando a checagem de progress_banner.
drop policy sponsored_ads_select on public.sponsored_ads;
create policy sponsored_ads_select on public.sponsored_ads for select using(coalesce(public.has_app_access(),false) and (
 public.is_superadmin() or
 (commercial_resource_id is null and (expires_at is null or expires_at>statement_timestamp()) and
 ((is_global and auth.uid() is not null and 'banner'=any(display_mode) and exists(
   select 1 from public.advertising_placements p where p.code='home_banner' and p.delivery_enabled))
  or exists(select 1 from public.community_members cm join public.advertising_placements p
    on p.surface='community' and p.delivery_enabled and p.content_type=any(display_mode)
    where cm.user_id=auth.uid() and cm.community_id=any(community_ids))))
 or (commercial_resource_id is not null and coalesce(public.has_app_access(),false) and
 (private.advertising_eligible(id,'home_banner',null) or private.advertising_eligible(id,'progress_banner',null) or exists(select 1 from unnest(community_ids) c where public.is_community_member(c) and (private.advertising_eligible(id,'community_banner',c) or private.advertising_eligible(id,'community_feed',c)))))));

-- Mesmo defeito do RLS acima, só que na porta de entrada da imagem do anúncio (Edge Function
-- storefront-media, GET): o ramo de leitura pública de campanha gerida também hardcodava os
-- três posicionamentos antigos. Corpo idêntico ao de 20261205000007_advertising_media.sql, só
-- somando progress_banner.
create or replace function public.authorize_storefront_media(p_media_id uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare path text;
begin
 path:=private.authorize_storefront_media_before_ads(p_media_id);
 if path is not null then return path; end if;
 if not coalesce(public.has_app_access(),false) then return null; end if;
 select m.storage_path into path from public.storefront_media m
 where m.id=p_media_id and m.state='ready' and (
 exists(select 1 from private.advertising_drafts d join public.advertiser_members am on am.account_id=d.account_id
 join public.advertiser_accounts ac on ac.id=d.account_id
 where d.ad_id=m.storefront_id and ac.active and am.user_id=auth.uid() and am.revoked_at is null and am.permission in('manager','owner'))
 or exists(select 1 from public.sponsored_ads a where a.id=m.storefront_id and a.media_id=m.id and (
 private.advertising_eligible(a.id,'home_banner',null) or private.advertising_eligible(a.id,'progress_banner',null) or exists(select 1 from unnest(a.community_ids)c
 where public.is_community_member(c) and (private.advertising_eligible(a.id,'community_banner',c) or private.advertising_eligible(a.id,'community_feed',c))))));
 return path;
end $$;

-- Leitura fina para o assistente do anunciante decidir quais cartões mostrar no passo 1 --
-- "disponível" só quando a contratação de fato completaria: os dois gates do posicionamento
-- (vendas/exibição), os dois gates da oferta comercial (vendas/integração), uma versão de
-- preço vigente e um documento comercial publicado (sem isso, accept_commercial_terms recusa
-- com COMMERCIAL_TERMS_UNAVAILABLE). Nunca expõe capacidade, preço, revisão ou
-- delivery_enabled -- isso é informação administrativa, não deve chegar ao anunciante.
create function private.advertising_placement_sellable(p_code text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
   select 1 from public.advertising_placements p join public.commercial_offerings f on f.code=p.offering_code
   where p.code=p_code and p.sales_enabled and p.delivery_enabled and p.capacity>0
     and f.sales_enabled and f.integration_ready
     and exists(select 1 from public.commercial_price_versions v where v.offering_code=f.code and v.active_from<=statement_timestamp())
     and exists(select 1 from private.commercial_offering_documents cod join public.legal_document_policy ldp on ldp.document_id=cod.document_id where cod.offering_code=f.code)
 )
$$;
revoke all on function private.advertising_placement_sellable(text) from public,anon,authenticated,service_role;

create function public.advertising_sales_status() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_commercial_user();
 return coalesce((select jsonb_agg(jsonb_build_object('code',p.code,'salesEnabled',private.advertising_placement_sellable(p.code)) order by p.code)
 from public.advertising_placements p where p.content_type in('banner','feed')),'[]'::jsonb);
end $$;
revoke all on function public.advertising_sales_status() from public,anon,service_role;
grant execute on function public.advertising_sales_status() to authenticated;

-- Evidência sob demanda para a tela administrativa. Conta campanhas com reserva vigente,
-- inclusive suspensas, pois o compromisso financeiro continua até expirar ou ser revertido.
-- A amostra de nomes é limitada; o total permanece exato.
create or replace function public.admin_advertising_inventory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 perform private.require_evocash_admin();
 return jsonb_build_object(
  'placements',(select jsonb_agg(to_jsonb(p) || jsonb_build_object(
    'activeContracts',(select count(distinct o.resource_id) from private.advertising_reservations r
      join public.commercial_orders o on o.id=r.order_id
      where r.placement_code=p.code and o.status='fulfilled'
        and r.starts_at<=statement_timestamp() and r.expires_at>statement_timestamp()),
    'affectedCampaigns',coalesce((select jsonb_agg(to_jsonb(x)) from (
      select o.resource_id as id, coalesce(a.title,'Campanha removida') as title, max(r.expires_at) as expires_at
      from private.advertising_reservations r join public.commercial_orders o on o.id=r.order_id
      left join public.sponsored_ads a on a.id=o.resource_id
      where r.placement_code=p.code and o.status='fulfilled'
        and r.starts_at<=statement_timestamp() and r.expires_at>statement_timestamp()
      group by o.resource_id,a.title order by max(r.expires_at),o.resource_id limit 20
    ) x),'[]'::jsonb)) order by p.code) from public.advertising_placements p),
  'serverTime',statement_timestamp(),
  'networkRevision',(select network_revision::text from private.advertising_configuration where id),
  'networkPlacements',coalesce((select jsonb_agg(placement_code order by placement_code) from private.advertising_network_bundle),'[]'::jsonb));
end $$;
