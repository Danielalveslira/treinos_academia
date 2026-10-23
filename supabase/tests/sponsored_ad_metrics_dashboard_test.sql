\ir _helpers/auth_session.sql
-- pgTAP: RPC get_sponsored_ad_metrics_dashboard (migration 20261018000002).
-- Fixtures (prefixo b1...): 01 superadmin | 02 usuário comum. Comunidades C1/C2/C3. Anúncios A1 (C1 banner+feed) e A2 (global).
-- Dias relativos a D = dia de hoje em America/Sao_Paulo (private.ad_metrics_day(now())).
begin;
select no_plan();
-- isolamento: o teste assume a tabela de agregados vazia (tudo é revertido no ROLLBACK final)
delete from public.sponsored_ad_daily_stats;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b1000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'dash' || n || '@example.invalid', 'x', now(), '{}', '{}', now(), now()
  from generate_series(1, 2) n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'b1000000-%';
update public.users set role = 'superadmin', username = 'dashsuper01' where id = 'b1000000-0000-0000-0000-000000000001';
insert into public.communities (id, name, created_by) values
  ('b2000000-0000-0000-0000-000000000001', 'Comunidade C1', 'b1000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000002', 'Comunidade C2', 'b1000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000003', 'Comunidade C3', 'b1000000-0000-0000-0000-000000000001');
insert into public.sponsored_ads (id, partner_name, title, community_ids, is_global, display_mode, created_by) values
  ('b3000000-0000-0000-0000-000000000001', 'Parceiro A1', 'Campanha A1', '{b2000000-0000-0000-0000-000000000001}', false, '{banner,feed}', 'b1000000-0000-0000-0000-000000000001'),
  ('b3000000-0000-0000-0000-000000000002', 'Parceiro A2', 'Campanha A2', '{}', true, '{banner}', 'b1000000-0000-0000-0000-000000000001');

create function pg_temp.dash(p_days integer default 30, p_from date default null, p_to date default null, p_ad uuid default null,
                             p_comm uuid default null, p_place text default null) returns jsonb language sql as
  $f$select public.get_sponsored_ad_metrics_dashboard(p_days, p_from, p_to, p_ad, p_comm, p_place)$f$;
create function pg_temp.err(p_sql text) returns text language plpgsql as
  $f$begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end$f$;
create function pg_temp.as_user(p_n integer) returns void language sql as
  $f$select pg_temp.set_test_user( 'b1000000-0000-0000-0000-00000000000' || p_n, true)$f$;
create function pg_temp.today() returns date language sql security definer set search_path = '' as $f$select private.ad_metrics_day(now())$f$;

-- ---------------------------------------------------------------------------------------------------
-- 1. Estrutura e privilégios
-- ---------------------------------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)', 'execute'), 'anon sem EXECUTE');
select ok(not has_function_privilege('public', 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)', 'execute'), 'PUBLIC sem EXECUTE');
select ok(has_function_privilege('authenticated', 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)', 'execute'), 'authenticated com EXECUTE (a checagem real é is_superadmin)');
select ok(not has_function_privilege('authenticated', 'private.ad_metrics_object(bigint,bigint,bigint,bigint)', 'execute'), 'helper privado não é executável');
select ok((select proconfig from pg_proc where oid = 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)'::regprocedure) @> array['search_path=""'], 'search_path vazio');
select ok((select prosecdef and provolatile = 's' from pg_proc where oid = 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)'::regprocedure), 'SECURITY DEFINER e STABLE (somente leitura)');
select ok((select prosrc !~* 'execute |event_marks|user_id|insert |update |delete ' from pg_proc where oid = 'public.get_sponsored_ad_metrics_dashboard(integer,date,date,uuid,uuid,text)'::regprocedure), 'sem SQL dinâmico, sem marcadores, sem user_id, sem escrita');

-- ---------------------------------------------------------------------------------------------------
-- 2. Permissões
-- ---------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.get_sponsored_ad_metrics_dashboard()$$, '42501', null, 'anon não executa');
set local role authenticated;
select pg_temp.set_test_user( '', true);
select throws_ok($$select public.get_sponsored_ad_metrics_dashboard()$$, 'P0001', 'PERMISSION_DENIED', 'sem login: PERMISSION_DENIED');
select pg_temp.as_user(2);
select throws_ok($$select public.get_sponsored_ad_metrics_dashboard()$$, 'P0001', 'PERMISSION_DENIED', 'usuário comum: PERMISSION_DENIED');
select throws_ok($$select public.get_sponsored_ad_metrics_dashboard(7, null, null, 'b3000000-0000-0000-0000-000000000001', null, 'home_banner')$$, 'P0001', 'PERMISSION_DENIED', 'usuário comum com filtros: PERMISSION_DENIED');
select throws_ok($$select public.get_sponsored_ad_metrics_dashboard(null, '2026-01-01', '2026-01-31')$$, 'P0001', 'PERMISSION_DENIED', 'usuário comum com intervalo: PERMISSION_DENIED (antes de validar parâmetros)');

-- ---------------------------------------------------------------------------------------------------
-- 3. Sem nenhum dado
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(1);
select is((pg_temp.dash() -> 'has_data'), 'false'::jsonb, 'tabela vazia: has_data = false');
select is((pg_temp.dash() #> '{collection,has_any_data}'), 'false'::jsonb, 'tabela vazia: nunca houve coleta');
select is((pg_temp.dash() #> '{collection,server_enabled}'), 'false'::jsonb, 'chave do servidor desligada é informada');
select is((pg_temp.dash() #> '{collection,last_day}'), 'null'::jsonb, 'sem último dia');
select is((pg_temp.dash() -> 'summary'), '{"clicks":0,"ctr_raw":null,"ctr_qualified":null,"unique_viewers":0,"qualified_clicks":0,"unqualified_clicks":0,"visible_impressions":0}'::jsonb, 'resumo zerado; CTR null (sem divisão por zero)');
select is((pg_temp.dash() -> 'daily'), '[]'::jsonb, 'série vazia');
select is((pg_temp.dash() -> 'by_campaign'), '[]'::jsonb, 'campanhas vazias');
select is((pg_temp.dash() #>> '{period,today}')::date, pg_temp.today(), 'hoje = dia do servidor em America/Sao_Paulo');
select is((pg_temp.dash() #>> '{period,timezone}'), 'America/Sao_Paulo', 'fuso informado');

-- ---------------------------------------------------------------------------------------------------
-- 4. Dados sintéticos (somente este teste)
-- ---------------------------------------------------------------------------------------------------
reset role;
insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
select pg_temp.today() - d, a::uuid, pl, c::uuid, pn, i, u, k, q from (values
  (0,  'b3000000-0000-0000-0000-000000000001', 'community_banner', 'b2000000-0000-0000-0000-000000000001', 'Parceiro A1', 100, 60, 10, 2),
  (1,  'b3000000-0000-0000-0000-000000000001', 'community_banner', 'b2000000-0000-0000-0000-000000000001', 'Parceiro A1',  50, 30,  5, 0),
  (10, 'b3000000-0000-0000-0000-000000000001', 'community_banner', 'b2000000-0000-0000-0000-000000000001', 'Parceiro A1', 200, 100, 20, 5),
  (40, 'b3000000-0000-0000-0000-000000000001', 'community_banner', 'b2000000-0000-0000-0000-000000000001', 'Parceiro A1', 1000, 500, 100, 0),
  (0,  'b3000000-0000-0000-0000-000000000001', 'community_feed',   'b2000000-0000-0000-0000-000000000001', 'Parceiro A1',  40, 30,  4, 4),
  (0,  'b3000000-0000-0000-0000-000000000001', 'community_banner', 'b2000000-0000-0000-0000-000000000002', 'Parceiro A1',  10, 10,  0, 0),
  (0,  'b3000000-0000-0000-0000-000000000002', 'home_banner',      '00000000-0000-0000-0000-000000000000', 'Parceiro A2', 300, 200, 3, 3),
  (2,  'b3000000-0000-0000-0000-000000000002', 'home_banner',      '00000000-0000-0000-0000-000000000000', 'Parceiro A2',   0,  0, 2, 2),
  (3,  'b3000000-0000-0000-0000-0000000000ff', 'community_feed',   'b2000000-0000-0000-0000-000000000001', 'Parceiro Excluído', 20, 20, 1, 0)
) as t(d, a, pl, c, pn, i, u, k, q);
set local role authenticated;
select pg_temp.as_user(1);

-- 30 dias (padrão): 720 impressões, 450 alcance diário, 45 cliques, 16 sem impressão
select is((pg_temp.dash() -> 'summary'), jsonb_build_object('visible_impressions', 720, 'unique_viewers', 450, 'clicks', 45, 'unqualified_clicks', 16,
  'qualified_clicks', 29, 'ctr_qualified', 4.03, 'ctr_raw', 6.25), 'resumo de 30 dias: somas, qualificados = cliques - sem impressão, CTRs');
select is((pg_temp.dash() #>> '{period,from}')::date, pg_temp.today() - 29, 'janela de 30 dias começa em hoje-29');
select ok((pg_temp.dash() -> 'summary' ->> 'unqualified_clicks')::int <= (pg_temp.dash() -> 'summary' ->> 'clicks')::int, 'sem impressão <= cliques');
select is((pg_temp.dash() #> '{collection,has_any_data}'), 'true'::jsonb, 'agora há dados');
select is((pg_temp.dash() #>> '{collection,last_day}')::date, pg_temp.today(), 'último dia com dados');
select is((pg_temp.dash(7) -> 'summary' ->> 'visible_impressions')::int, 520, '7 dias exclui hoje-10 e hoje-40');
select is((pg_temp.dash(90) -> 'summary' ->> 'visible_impressions')::int, 1720, '90 dias inclui hoje-40 (1.000 impressões a mais)');
select is((pg_temp.dash(1) -> 'summary' ->> 'visible_impressions')::int, 450, '1 dia = só hoje (100+40+10+300)');

-- série diária: só dias com registro, ordem crescente
select is((select jsonb_array_length(pg_temp.dash() -> 'daily')), 5, 'série diária: 5 dias com registro');
select is((select string_agg(e ->> 'day', ',' order by ord) from jsonb_array_elements(pg_temp.dash() -> 'daily') with ordinality t(e, ord)),
  (select string_agg((pg_temp.today() - d)::text, ',' order by d desc) from unnest(array[0, 1, 2, 3, 10]) d), 'dias em ordem crescente');
select is((pg_temp.dash() -> 'daily' -> 4 ->> 'visible_impressions')::int, 450, 'hoje soma banners, feed e Home (100+40+10+300)');
select is((pg_temp.dash() -> 'daily' -> 2 -> 'ctr_qualified'), 'null'::jsonb, 'dia com 0 impressões e 2 cliques: CTR null, sem divisão por zero');
select is((pg_temp.dash() -> 'daily' -> 2 ->> 'qualified_clicks')::int, 0, 'cliques sem impressão não viram qualificados');

-- por posicionamento: ordem fixa
select is((select string_agg(e ->> 'placement' || ':' || (e ->> 'visible_impressions'), ',' order by ord) from jsonb_array_elements(pg_temp.dash() -> 'by_placement') with ordinality t(e, ord)),
  'home_banner:300,community_banner:360,community_feed:60', 'por posicionamento (Home, banner da comunidade, feed)');

-- por campanha: ordem por impressões; excluída preserva o nome histórico
select is((select string_agg((e ->> 'partner_name') || ':' || (e ->> 'visible_impressions') || ':' || (e ->> 'deleted'), ',' order by ord) from jsonb_array_elements(pg_temp.dash() -> 'by_campaign') with ordinality t(e, ord)),
  'Parceiro A1:400:false,Parceiro A2:300:false,Parceiro Excluído:20:true', 'por campanha: ordenado, campanha inexistente aparece como excluída com o nome do retrato');
select is((pg_temp.dash() -> 'by_campaign' -> 0 ->> 'title'), 'Campanha A1', 'título vem da campanha existente');
select is((pg_temp.dash() -> 'by_campaign' -> 2 -> 'title'), 'null'::jsonb, 'sem título para campanha excluída (não inventa)');
select is((pg_temp.dash() ->> 'campaigns_total')::int, 3, 'total de campanhas');
select is((pg_temp.dash() ->> 'campaigns_truncated')::boolean, false, 'sem truncamento');

-- por comunidade/posição
select is((select string_agg((e ->> 'placement') || ':' || coalesce(e ->> 'community_name', '-') || ':' || (e ->> 'visible_impressions'), ',' order by ord) from jsonb_array_elements(pg_temp.dash() -> 'by_context') with ordinality t(e, ord)),
  'community_banner:Comunidade C1:350,home_banner:-:300,community_feed:Comunidade C1:60,community_banner:Comunidade C2:10', 'por comunidade e posição (Home sem nome de comunidade)');

-- filtros
select is((pg_temp.dash(30, null, null, 'b3000000-0000-0000-0000-000000000001') -> 'summary' ->> 'visible_impressions')::int, 400, 'filtro por campanha');
select is((pg_temp.dash(30, null, null, null, 'b2000000-0000-0000-0000-000000000001') -> 'summary' ->> 'visible_impressions')::int, 410, 'filtro por comunidade (banner + feed + excluída)');
select is((pg_temp.dash(30, null, null, null, null, 'home_banner') -> 'summary' ->> 'visible_impressions')::int, 300, 'filtro por posicionamento');
select is((pg_temp.dash(30, null, null, 'b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'community_feed') -> 'summary' ->> 'visible_impressions')::int, 40, 'filtros combinados');
select is((pg_temp.dash(30, null, null, gen_random_uuid()) -> 'has_data'), 'false'::jsonb, 'filtro sem resultado: has_data = false (não inventa números)');
select is((pg_temp.dash(30, null, null, gen_random_uuid()) #> '{collection,has_any_data}'), 'true'::jsonb, 'e distingue "sem dados no filtro" de "nunca coletou"');
select is((pg_temp.dash(30, null, null, null, null, 'home_banner') -> 'daily' -> 0 ->> 'day')::date, pg_temp.today() - 2, 'série filtrada');

-- intervalo personalizado
select is((pg_temp.dash(null, pg_temp.today() - 3, pg_temp.today() - 2) -> 'summary' ->> 'visible_impressions')::int, 20, 'intervalo personalizado inclusivo nos dois extremos');
select is((pg_temp.dash(null, pg_temp.today(), pg_temp.today()) #>> '{period,days}')::int, 1, 'intervalo de 1 dia');
select is((pg_temp.dash(null, pg_temp.today() - 365, pg_temp.today()) #>> '{period,days}')::int, 366, 'intervalo máximo de 366 dias é aceito');

-- validações
select is(pg_temp.err('select pg_temp.dash(0)'), 'INVALID_RANGE', 'p_days = 0');
select is(pg_temp.err('select pg_temp.dash(367)'), 'INVALID_RANGE', 'p_days > 366');
select is(pg_temp.err('select pg_temp.dash(null)'), 'INVALID_RANGE', 'p_days nulo sem intervalo');
select is(pg_temp.err('select pg_temp.dash(null, current_date - 5)'), 'INVALID_RANGE', 'só o início do intervalo');
select is(pg_temp.err('select pg_temp.dash(null, null, current_date - 5)'), 'INVALID_RANGE', 'só o fim do intervalo');
select is(pg_temp.err('select pg_temp.dash(null, current_date, current_date - 5)'), 'INVALID_RANGE', 'fim antes do início');
select is(pg_temp.err('select pg_temp.dash(null, current_date - 366, current_date)'), 'INVALID_RANGE', '367 dias');
select is(pg_temp.err('select pg_temp.dash(null, pg_temp.today(), pg_temp.today() + 1)'), 'INVALID_RANGE', 'fim no futuro');
select is(pg_temp.err('select pg_temp.dash(null, date ''2019-12-31'', date ''2020-01-02'')'), 'INVALID_RANGE', 'início anterior a 2020');
select is(pg_temp.err('select pg_temp.dash(30, null, null, null, null, ''sidebar'')'), 'INVALID_FILTER', 'posicionamento desconhecido');
select is(pg_temp.err('select pg_temp.dash(30, null, null, null, null, '''')'), 'INVALID_FILTER', 'posicionamento vazio');

-- exclusão de campanha existente: histórico permanece com o nome do retrato
reset role;
delete from public.sponsored_ads where id = 'b3000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.as_user(1);
select is((select (e ->> 'partner_name') || ':' || (e ->> 'deleted') || ':' || (e ->> 'visible_impressions') from jsonb_array_elements(pg_temp.dash(30, null, null, 'b3000000-0000-0000-0000-000000000002') -> 'by_campaign') e),
  'Parceiro A2:true:300', 'campanha excluída depois da coleta: números e nome preservados');
select is((pg_temp.dash() -> 'summary' ->> 'visible_impressions')::int, 720, 'excluir campanha não altera o total');

-- sem dados pessoais nem eventos individuais
select ok(not (pg_temp.dash()::text ~* 'user_id|event_id|email'), 'resposta sem user_id, event_id ou e-mail');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.dash()) k),
  array['by_campaign', 'by_context', 'by_placement', 'campaigns_total', 'campaigns_truncated', 'collection', 'contexts_total', 'contexts_truncated', 'daily', 'filters', 'has_data', 'period', 'summary'],
  'chaves de topo estáveis e documentadas');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.dash() -> 'summary') k),
  array['clicks', 'ctr_qualified', 'ctr_raw', 'qualified_clicks', 'unique_viewers', 'unqualified_clicks', 'visible_impressions'], 'chaves do resumo');
select is(pg_temp.dash() = pg_temp.dash(), true, 'resposta determinística');

-- volume: 60 campanhas e 60 contextos num recorte isolado; totais NÃO são cortados, listas sim (com sinalização)
reset role;
insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, visible_impressions, unique_viewers, clicks, unqualified_clicks)
select pg_temp.today() - 5, ('b4000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'community_feed',
       ('b5000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'Volume ' || n, n, n, 0, 0
  from generate_series(1, 60) n;
set local role authenticated;
select pg_temp.as_user(1);
select is((pg_temp.dash(7, null, null, null, null, 'community_feed') -> 'summary' ->> 'visible_impressions')::int, 1830 + 60, 'volume: o total soma TODAS as campanhas (1830 + 60 do feed anterior)');
select is((select jsonb_array_length(pg_temp.dash(7, null, null, null, null, 'community_feed') -> 'by_campaign')), 50, 'volume: lista limitada a 50 campanhas');
select is((pg_temp.dash(7, null, null, null, null, 'community_feed') ->> 'campaigns_total')::int, 62, 'volume: total real de campanhas informado (60 + A1 + excluída)');
select is((pg_temp.dash(7, null, null, null, null, 'community_feed') ->> 'campaigns_truncated')::boolean, true, 'volume: truncamento sinalizado');
select is((pg_temp.dash(7, null, null, null, null, 'community_feed') -> 'by_campaign' -> 0 ->> 'partner_name'), 'Volume 60', 'volume: ordenado por impressões desc');
select is((select jsonb_array_length(pg_temp.dash(7, null, null, null, null, 'community_feed') -> 'by_context')), 50, 'volume: contextos limitados a 50');
select is((pg_temp.dash(7, null, null, null, null, 'community_feed') ->> 'contexts_truncated')::boolean, true, 'volume: contextos truncados sinalizados');

select * from finish();
rollback;
