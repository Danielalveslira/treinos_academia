\ir _helpers/auth_session.sql
-- pgTAP: coleta de métricas de patrocinados (migration 20261018000001_sponsored_ad_metrics.sql).
-- Fixtures (prefixo a1...): usuários 01 superadmin | 02 membro C1+C2 | 03 não membro | 04 banido em C1 |
-- 05 conta desativada | 06 membro C1 (segundo espectador) | 07 membro C1 (cliques sem impressão) |
-- 08, 09 membros C1 (tetos por hora). Comunidades C1 (a2..01) e C2 (a2..02).
-- Anúncios (todos criados pelo superadmin):
--   A1 {C1} banner+feed, vigente | A2 global banner | A3 {C1} banner+feed VENCIDO | A4 global só feed
--   A5 {C1} só banner            | A6 {C1} só feed, sem validade
-- Não há anúncio "futuro": sponsored_ads não tem data de início (só expires_at).
-- A concorrência real (várias conexões) fica em sponsored_ad_metrics_concurrency.sh.
begin;
select no_plan();

-- ---------------------------------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------------------------------
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('a1000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
       'adm' || n || '@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
  from generate_series(1, 9) n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'a1000000-%';
-- adultos (a medição ignora menores de 18 anos e contas sem data de nascimento; ver migration 20261019000001)
update public.users set data_nascimento = date '1990-01-01' where id::text like 'a1000000-%';
update public.users set role = 'superadmin', username = 'adsuperadmin01' where id = 'a1000000-0000-0000-0000-000000000001';
update public.users set account_status = 'disabled', disabled_reason = 'teste' where id = 'a1000000-0000-0000-0000-000000000005';

insert into public.communities (id, name, created_by) values
  ('a2000000-0000-0000-0000-000000000001', 'Comunidade C1', 'a1000000-0000-0000-0000-000000000001'),
  ('a2000000-0000-0000-0000-000000000002', 'Comunidade C2', 'a1000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) values
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000002'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000005'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000006'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000007'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000008'),
  ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000009');
insert into public.community_restrictions (community_id, user_id, reason)
  values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000004', 'teste de banimento');

insert into public.sponsored_ads (id, partner_name, title, community_ids, is_global, display_mode, expires_at, created_by) values
  ('a3000000-0000-0000-0000-000000000001', 'Parceiro A1', 'A1', '{a2000000-0000-0000-0000-000000000001}', false, '{banner,feed}', now() + interval '30 days', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000002', 'Parceiro A2', 'A2', '{}', true, '{banner}', now() + interval '30 days', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000003', 'Parceiro A3', 'A3', '{a2000000-0000-0000-0000-000000000001}', false, '{banner,feed}', now() - interval '1 minute', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000004', 'Parceiro A4', 'A4', '{}', true, '{feed}', now() + interval '30 days', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000005', 'Parceiro A5', 'A5', '{a2000000-0000-0000-0000-000000000001}', false, '{banner}', now() + interval '30 days', 'a1000000-0000-0000-0000-000000000001'),
  ('a3000000-0000-0000-0000-000000000006', 'Parceiro A6', 'A6', '{a2000000-0000-0000-0000-000000000001}', false, '{feed}', null, 'a1000000-0000-0000-0000-000000000001');

-- Helpers (rodam como o chamador; as leituras de verificação são SECURITY DEFINER do dono da sessão).
create function pg_temp.u(p integer) returns uuid language sql as
  $f$select ('e0000000-0000-4000-8000-' || lpad(p::text, 12, '0'))::uuid$f$;
create function pg_temp.ev(p_id integer, p_type text, p_ad integer, p_place text, p_comm integer default null) returns jsonb
  language sql as
  $f$select jsonb_strip_nulls(jsonb_build_object(
       'id', pg_temp.u(p_id), 'type', p_type,
       'ad', ('a3000000-0000-0000-0000-00000000000' || p_ad)::uuid, 'placement', p_place,
       'community', case when p_comm is null then null else ('a2000000-0000-0000-0000-00000000000' || p_comm)::uuid end))$f$;
create function pg_temp.as_user(p_n integer) returns void language sql as
  $f$select pg_temp.set_test_user( 'a1000000-0000-0000-0000-00000000000' || p_n, true)$f$;
-- [impressões, únicos, cliques] da linha do dia para a chave; null se a linha não existe.
create function pg_temp.stat(p_ad integer, p_place text, p_ctx uuid) returns bigint[]
  language sql security definer set search_path = '' as
  $f$select array[s.visible_impressions, s.unique_viewers, s.clicks]
       from public.sponsored_ad_daily_stats s
      where s.ad_id = ('a3000000-0000-0000-0000-00000000000' || p_ad)::uuid and s.placement = p_place
        and s.context_id = p_ctx and s.day = private.ad_metrics_day(now())$f$;
create function pg_temp.marks(p_n integer default null) returns bigint language sql security definer set search_path = '' as
  $f$select count(*) from public.sponsored_ad_event_marks m
      where p_n is null or m.user_id = ('a1000000-0000-0000-0000-00000000000' || p_n)::uuid$f$;
create function pg_temp.stats_rows() returns bigint language sql security definer set search_path = '' as
  $f$select count(*) from public.sponsored_ad_daily_stats where ad_id::text like 'a3000000-%'$f$;
create function pg_temp.unq(p_ad integer, p_place text, p_ctx uuid) returns bigint
  language sql security definer set search_path = '' as
  $f$select s.unqualified_clicks from public.sponsored_ad_daily_stats s
      where s.ad_id = ('a3000000-0000-0000-0000-00000000000' || p_ad)::uuid and s.placement = p_place
        and s.context_id = p_ctx and s.day = private.ad_metrics_day(now())$f$;
create function pg_temp.kind_marks(p_n integer, p_kind text) returns bigint language sql security definer set search_path = '' as
  $f$select count(*) from public.sponsored_ad_event_marks m
      where m.user_id = ('a1000000-0000-0000-0000-00000000000' || p_n)::uuid and m.kind = p_kind$f$;
-- linhas inseridas/atualizadas/apagadas NESTA transação nas tabelas de métricas
create function pg_temp.writes() returns bigint language sql security definer set search_path = '' as
  $f$select coalesce(sum(n_tup_ins + n_tup_upd + n_tup_del), 0) from pg_stat_xact_user_tables
      where relname in ('sponsored_ad_event_marks', 'sponsored_ad_daily_stats')$f$;
create function pg_temp.advisory_locks() returns bigint language sql as
  $f$select count(*) from pg_locks where locktype = 'advisory' and pid = pg_backend_pid()$f$;
create function pg_temp.accepted(p jsonb) returns integer language sql as $f$select (p ->> 'accepted')::integer$f$;

create temp table _c (c1 uuid, c2 uuid, nil uuid);
insert into _c values ('a2000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000');
grant all on _c to public;

-- ---------------------------------------------------------------------------------------------------
-- 1. Estrutura, privilégios, RLS e configuração da função
-- ---------------------------------------------------------------------------------------------------
select has_table('public', 'sponsored_ad_daily_stats', 'tabela de agregados existe');
select has_table('public', 'sponsored_ad_event_marks', 'tabela de marcadores existe');
select is((select collection_enabled from public.sponsored_ad_metrics_settings), false, 'coleta nasce DESLIGADA no servidor');
select is((select count(*) from public.sponsored_ad_metrics_settings), 1::bigint, 'configuração é singleton');
select ok((select relrowsecurity from pg_class where oid = 'public.sponsored_ad_daily_stats'::regclass), 'RLS ligada nos agregados');
select ok((select relrowsecurity from pg_class where oid = 'public.sponsored_ad_event_marks'::regclass), 'RLS ligada nos marcadores');
select ok((select relrowsecurity from pg_class where oid = 'public.sponsored_ad_metrics_settings'::regclass), 'RLS ligada na configuração');
select is((select count(*) from pg_policies where tablename = 'sponsored_ad_event_marks'), 0::bigint, 'marcadores sem nenhuma policy');
select ok(not has_table_privilege('authenticated', 'public.sponsored_ad_event_marks', 'select'), 'authenticated sem SELECT nos marcadores');
select ok(not has_table_privilege('authenticated', 'public.sponsored_ad_event_marks', 'insert'), 'authenticated sem INSERT nos marcadores');
select ok(not has_table_privilege('anon', 'public.sponsored_ad_event_marks', 'select'), 'anon sem SELECT nos marcadores');
select ok(not has_table_privilege('anon', 'public.sponsored_ad_daily_stats', 'select'), 'anon sem SELECT nos agregados');
select ok(has_table_privilege('authenticated', 'public.sponsored_ad_daily_stats', 'select'), 'authenticated tem SELECT (a RLS restringe ao superadmin)');
select ok(not has_table_privilege('authenticated', 'public.sponsored_ad_daily_stats', 'insert')
          and not has_table_privilege('authenticated', 'public.sponsored_ad_daily_stats', 'update')
          and not has_table_privilege('authenticated', 'public.sponsored_ad_daily_stats', 'delete'), 'authenticated não escreve nos agregados');
select ok(not has_table_privilege('authenticated', 'public.sponsored_ad_metrics_settings', 'select')
          and not has_table_privilege('authenticated', 'public.sponsored_ad_metrics_settings', 'update'), 'authenticated não lê nem altera a configuração');
select ok(not has_function_privilege('anon', 'public.record_ad_events(jsonb)', 'execute'), 'anon sem EXECUTE na RPC');
select ok(not has_function_privilege('public', 'public.record_ad_events(jsonb)', 'execute'), 'PUBLIC sem EXECUTE na RPC');
select ok(has_function_privilege('authenticated', 'public.record_ad_events(jsonb)', 'execute'), 'authenticated com EXECUTE na RPC');
select ok(not has_function_privilege('authenticated', 'private.cleanup_sponsored_ad_metrics()', 'execute'), 'limpeza não é executável por authenticated');
select ok(not has_function_privilege('authenticated', 'private.ad_metrics_day(timestamptz)', 'execute'), 'função de dia não é executável por authenticated');
select is((select prosecdef from pg_proc where oid = 'public.record_ad_events(jsonb)'::regprocedure), true, 'RPC é SECURITY DEFINER (justificada: tabelas sem escrita para clientes)');
select ok((select proconfig from pg_proc where oid = 'public.record_ad_events(jsonb)'::regprocedure) @> array['search_path=""'], 'RPC com search_path vazio');
select ok((select proconfig from pg_proc where oid = 'private.cleanup_sponsored_ad_metrics()'::regprocedure) @> array['search_path=""'], 'limpeza com search_path vazio');
select ok((select proconfig from pg_proc where oid = 'private.cleanup_sponsored_ad_stats()'::regprocedure) @> array['search_path=""'], 'limpeza de agregados com search_path vazio');
select ok(position('execute' in lower((select prosrc from pg_proc where oid = 'public.record_ad_events(jsonb)'::regprocedure))) = 0, 'RPC sem SQL dinâmico');

select has_column('public', 'sponsored_ad_daily_stats', 'unqualified_clicks', 'agregado separa os cliques sem impressão retida');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, clicks, unqualified_clicks)
  values (current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', 'x', 1, 2)$$, '23514', null, 'cliques não qualificados nunca passam dos cliques');
select lives_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, clicks, unqualified_clicks)
  values (current_date - 5, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', 'x', 1, 1)$$, 'clique sem nenhuma impressão é um estado válido do agregado');

-- constraints de forma
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name)
  values (current_date, gen_random_uuid(), 'home_banner', gen_random_uuid(), 'x')$$, '23514', null, 'home_banner exige contexto zero');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name)
  values (current_date, gen_random_uuid(), 'community_banner', '00000000-0000-0000-0000-000000000000', 'x')$$, '23514', null, 'comunidade não aceita contexto zero');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, visible_impressions)
  values (current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', 'x', -1)$$, '23514', null, 'contador negativo recusado');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, unique_viewers)
  values (current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', 'x', 1)$$, '23514', null, 'único > impressões recusado');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name)
  values (current_date, gen_random_uuid(), 'sidebar', gen_random_uuid(), 'x')$$, '23514', null, 'posicionamento desconhecido recusado');

-- dia de relatório em America/Sao_Paulo (fechamento às 03:00 UTC)
select is(private.ad_metrics_day('2026-10-10 02:59:59+00'), '2026-10-09'::date, '02:59:59Z ainda é o dia anterior em São Paulo');
select is(private.ad_metrics_day('2026-10-10 03:00:00+00'), '2026-10-10'::date, '03:00:00Z abre o dia seguinte em São Paulo');
select is(private.ad_metrics_day('2026-10-10 23:59:59-03'), '2026-10-10'::date, '23:59:59 BRT ainda é o mesmo dia');
select is(private.ad_metrics_day('2026-10-11 00:00:00-03'), '2026-10-11'::date, '00:00:00 BRT abre o dia seguinte');

-- ---------------------------------------------------------------------------------------------------
-- 2. Autenticação e chave do servidor
-- ---------------------------------------------------------------------------------------------------
set local role anon;
select throws_ok($$select public.record_ad_events('[]'::jsonb)$$, '42501', null, 'anon não executa a RPC');
set local role authenticated;
select pg_temp.set_test_user( '', true);
select throws_ok($$select public.record_ad_events('[]'::jsonb)$$, 'P0001', 'NOT_AUTHENTICATED', 'sem login: NOT_AUTHENTICATED');

select pg_temp.as_user(2);
select is(public.record_ad_events(jsonb_build_array(pg_temp.ev(1, 'impression', 1, 'community_banner', 1))),
  '{"enabled": false, "accepted": 0}'::jsonb, 'com a chave do servidor DESLIGADA nada é aceito e o ACK avisa');
select is(pg_temp.marks(), 0::bigint, 'chave desligada: nenhum marcador');
select is(pg_temp.stats_rows(), 0::bigint, 'chave desligada: nenhum agregado');

reset role;
update public.sponsored_ad_metrics_settings set collection_enabled = true, updated_at = now();
set local role authenticated;
select pg_temp.as_user(2);

-- ---------------------------------------------------------------------------------------------------
-- 3. Caminho feliz, idempotência, único x impressões, cliques
-- ---------------------------------------------------------------------------------------------------
select is(public.record_ad_events('[]'::jsonb), '{"enabled": true, "accepted": 0}'::jsonb, 'lote vazio é aceito e não grava');
select is(public.record_ad_events(jsonb_build_array(pg_temp.ev(1, 'impression', 1, 'community_banner', 1))),
  '{"enabled": true, "accepted": 1}'::jsonb, 'impressão de banner da comunidade aceita (ACK mínimo)');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[1, 1, 0]::bigint[], 'agregado: 1 impressão, 1 único, 0 cliques');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(1, 'impression', 1, 'community_banner', 1)))), 0,
  'reenvio do MESMO evento (retry após timeout) é idempotente');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[1, 1, 0]::bigint[], 'retry não dobrou contadores');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(2, 'impression', 1, 'community_banner', 1)))), 1,
  'nova impressão do mesmo usuário (outra sessão de exibição) é aceita');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[2, 1, 0]::bigint[], 'impressões 2, mas alcance único continua 1');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(3, 'click', 1, 'community_banner', 1)))), 1, 'clique após impressão aceito');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(3, 'click', 1, 'community_banner', 1)))), 0, 'reenvio do clique é idempotente');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[2, 1, 1]::bigint[], 'agregado: 1 clique');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(4, 'click', 1, 'community_feed', 1)))), 1,
  'clique SEM impressão prévia (clique rápido) é contabilizado');
select is(pg_temp.stat(1, 'community_feed', (select c1 from _c)), array[0, 0, 1]::bigint[], 'sem impressão fictícia: 0 impressões, 0 únicos, 1 clique');
select is(pg_temp.unq(1, 'community_feed', (select c1 from _c)), 1::bigint, 'e marcado como clique não qualificado');
select is(pg_temp.kind_marks(2, 'impression') >= 0, true, 'sanidade do helper');

-- mesmo anúncio em outro formato/posição: contadores separados
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(5, 'impression', 1, 'community_feed', 1)))), 1, 'card no feed do mesmo anúncio aceito');
select is(pg_temp.stat(1, 'community_feed', (select c1 from _c)), array[1, 1, 1]::bigint[], 'feed tem contador próprio');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[2, 1, 1]::bigint[], 'banner da comunidade não foi alterado');

-- Home (sem comunidade): contexto zero, não quebra chave única nem dedupe
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(6, 'impression', 2, 'home_banner')))), 1, 'banner global na Home aceito sem comunidade');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(7, 'impression', 2, 'home_banner')))), 1, 'segunda impressão na Home aceita (chave com contexto zero)');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(6, 'impression', 2, 'home_banner')))), 0, 'repetição do evento da Home é idempotente');
select is(pg_temp.stat(2, 'home_banner', (select nil from _c)), array[2, 1, 0]::bigint[], 'Home: linha única com contexto zero, 2 impressões e 1 único');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(8, 'click', 2, 'home_banner')))), 1, 'clique no banner da Home aceito');
select is((select count(*) from public.sponsored_ad_daily_stats where ad_id = 'a3000000-0000-0000-0000-000000000002'), 0::bigint,
  'usuário comum não lê agregados (RLS)') ;

-- segundo espectador: único = 2, impressões = 3
select pg_temp.as_user(6);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(9, 'impression', 1, 'community_banner', 1)))), 1, 'outro membro conta');
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[3, 2, 1]::bigint[], 'alcance único soma usuários distintos; impressões somam eventos');
-- mesma chave de evento de outro usuário não colide (a idempotência é por usuário)
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(9, 'impression', 1, 'community_banner', 1)))), 1,
  'o mesmo event id enviado por OUTRO usuário é um evento independente');
select pg_temp.as_user(6);
select is(pg_temp.stat(1, 'community_banner', (select c1 from _c)), array[4, 2, 1]::bigint[], 'agregado coerente após os dois usuários');

-- lote com várias chaves: tudo gravado, uma passada
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(
    pg_temp.ev(20, 'impression', 6, 'community_feed', 1),
    pg_temp.ev(21, 'impression', 1, 'community_banner', 1),
    pg_temp.ev(22, 'click', 6, 'community_feed', 1),
    pg_temp.ev(23, 'impression', 2, 'home_banner')))), 4, 'lote misto: impressão+clique do mesmo anúncio e chaves diferentes');
select is(pg_temp.stat(6, 'community_feed', (select c1 from _c)), array[1, 1, 1]::bigint[], 'anúncio sem validade (A6) conta; clique no mesmo lote após a impressão');

-- ---------------------------------------------------------------------------------------------------
-- 3b. Cliques sem impressão: contam, mas NUNCA criam impressão e ficam separados para o CTR
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(7);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(700, 'click', 5, 'community_banner', 1)))), 1,
  'clique antes de completar 1 s visível (impressão inexistente) é aceito');
select is(pg_temp.stat(5, 'community_banner', (select c1 from _c)), array[0, 0, 1]::bigint[], 'nenhuma impressão ou alcance único foi fabricado');
select is(pg_temp.unq(5, 'community_banner', (select c1 from _c)), 1::bigint, 'clique contado como não qualificado');
select is(pg_temp.kind_marks(7, 'impression'), 0::bigint, 'nenhum marcador de impressão foi criado para justificar o clique');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(700, 'click', 5, 'community_banner', 1)))), 0, 'reenvio do clique rápido é idempotente');
select is(pg_temp.stat(5, 'community_banner', (select c1 from _c)), array[0, 0, 1]::bigint[], 'retry não dobrou o clique');
-- clique enviado ANTES da impressão no mesmo lote (impressão qualificada ainda no buffer): o servidor ordena
-- impressão primeiro, então o clique é qualificado
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(
    pg_temp.ev(701, 'click', 5, 'community_banner', 1), pg_temp.ev(702, 'impression', 5, 'community_banner', 1)))), 2,
  'lote com clique listado antes da impressão aceita os dois');
select is(pg_temp.stat(5, 'community_banner', (select c1 from _c)), array[1, 1, 2]::bigint[], 'impressão real + 2 cliques');
select is(pg_temp.unq(5, 'community_banner', (select c1 from _c)), 1::bigint, 'o clique do mesmo lote da impressão é qualificado');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(703, 'click', 5, 'community_banner', 1)))), 1, 'clique em lote posterior à impressão');
select is(pg_temp.unq(5, 'community_banner', (select c1 from _c)), 1::bigint, 'continua 1 não qualificado');
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(pg_temp.ev(710 + n, 'click', 5, 'community_banner', 1)) from generate_series(1, 6) n))), 2,
  'teto de 5 cliques por conta/chave/dia vale também sem impressão (3 já contados + 2)');
select is(pg_temp.stat(5, 'community_banner', (select c1 from _c)), array[1, 1, 5]::bigint[], 'cliques param em 5; impressões intactas');
-- Home: clique sem impressão também
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(720, 'click', 2, 'home_banner')))), 1, 'clique no banner da Home sem impressão aceito');
select is(pg_temp.kind_marks(7, 'impression'), 1::bigint, 'a única impressão da conta é a real (702)');
-- cliques inelegíveis continuam recusados
reset role;
create temp table _b3 as select (select count(*) from public.sponsored_ad_event_marks) m; grant all on _b3 to public;
set local role authenticated;
select pg_temp.as_user(7);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(
    pg_temp.ev(730, 'click', 3, 'community_banner', 1),      -- vencido
    pg_temp.ev(731, 'click', 1, 'community_banner', 2),      -- comunidade falsificada (não é membro de C2)
    pg_temp.ev(732, 'click', 6, 'community_banner', 1),      -- formato não contratado
    pg_temp.ev(733, 'click', 1, 'home_banner')))), 0,        -- anúncio não global na Home
  'cliques de anúncio vencido, comunidade falsificada, formato errado ou fora da Home não contam');
select pg_temp.as_user(3);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(734, 'click', 1, 'community_banner', 1)))), 0, 'clique de não membro não conta');
select pg_temp.as_user(4);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(735, 'click', 1, 'community_banner', 1)))), 0, 'clique de banido não conta');
select pg_temp.as_user(5);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(736, 'click', 2, 'home_banner')))), 0, 'clique de conta desativada não conta');
select pg_temp.as_user(1);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(737, 'click', 2, 'home_banner')))), 0, 'clique de superadmin não conta');
reset role;
select is((select count(*) from public.sponsored_ad_event_marks), (select m from _b3), 'cliques inelegíveis não deixaram marcador');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3c. Chamadas rejeitadas/repetidas não escrevem nada e não tomam o lock do usuário
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(9);
create function pg_temp.bad0(p jsonb) returns text language plpgsql as $f$
begin perform public.record_ad_events(p); return 'aceito'; exception when others then return sqlerrm; end $f$;
create temp table _w (w bigint, l bigint); grant all on _w to public;
insert into _w select pg_temp.writes(), pg_temp.advisory_locks();
select is((select string_agg(pg_temp.bad0('[{"id":"x"}]'::jsonb), ',') from generate_series(1, 25)), (select string_agg('INVALID_EVENTS', ',') from generate_series(1, 25)), '25 lotes malformados repetidos são recusados');
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(jsonb_build_object('id', gen_random_uuid(), 'type', 'impression', 'ad', gen_random_uuid(), 'placement', 'community_banner', 'community', 'a2000000-0000-0000-0000-000000000001')) from generate_series(1, 20)))), 0, '20 eventos de anúncios inexistentes: nada aceito');
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(pg_temp.ev(800 + n, 'impression', 3, 'community_banner', 1)) from generate_series(1, 20) n))), 0, '20 eventos de anúncio vencido: nada aceito');
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(pg_temp.ev(820 + n, 'click', 1, 'community_banner', 2)) from generate_series(1, 20) n))), 0, '20 eventos de comunidade falsificada: nada aceito');
select is((select w from _w), pg_temp.writes(), 'rejeições (malformado, inexistente, vencido, falsificado) não escreveram NENHUMA linha');
select is((select l from _w), pg_temp.advisory_locks(), 'e não tomaram o lock por usuário');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(840, 'impression', 1, 'community_banner', 1)))), 1, 'evento elegível da mesma conta é aceito');
select is(pg_temp.advisory_locks(), (select l from _w) + 1, 'só o evento elegível tomou o lock');
update _w set w = pg_temp.writes();
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(840, 'impression', 1, 'community_banner', 1)))), 0, 'reenvio do lote já processado: nada aceito');
select is((select w from _w), pg_temp.writes(), 'reenvio não escreveu nenhuma linha (nem marcador, nem agregado)');

-- teto por hora (rajada): 99 marcadores recentes => só mais 1 passa; marcadores antigos (>1 h) não contam
reset role;
insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
select 'a1000000-0000-0000-0000-000000000008', gen_random_uuid(), 'impression', private.ad_metrics_day(now()), gen_random_uuid(), 'community_banner', gen_random_uuid()
  from generate_series(1, 99);
insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id, expires_at)
select 'a1000000-0000-0000-0000-000000000007', gen_random_uuid(), 'impression', private.ad_metrics_day(now()) - 1, gen_random_uuid(), 'community_banner', gen_random_uuid(), now() + interval '10 hours'
  from generate_series(1, 150);
set local role authenticated;
select pg_temp.as_user(8);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(
    pg_temp.ev(850, 'impression', 1, 'community_banner', 1), pg_temp.ev(851, 'impression', 2, 'home_banner'), pg_temp.ev(852, 'impression', 6, 'community_feed', 1)))), 1,
  'teto de 100 eventos/hora: com 99 recentes só 1 dos 3 eventos passa');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(853, 'impression', 1, 'community_feed', 1)))), 0, 'e a rajada seguinte é bloqueada');
select pg_temp.as_user(7);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(854, 'impression', 1, 'community_feed', 1)))), 1,
  '150 marcadores de ontem (criados há > 1 h) não contam para o teto horário');

-- ---------------------------------------------------------------------------------------------------
-- 4. Elegibilidade (nada disto pode contar)
-- ---------------------------------------------------------------------------------------------------
reset role;
create temp table _before as select (select count(*) from public.sponsored_ad_event_marks) m,
  (select coalesce(sum(visible_impressions + clicks), 0) from public.sponsored_ad_daily_stats) s;
grant all on _before to public;
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(30, 'impression', 3, 'community_banner', 1)))), 0, 'anúncio vencido (A3) não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(31, 'impression', 3, 'community_feed', 1)))), 0, 'anúncio vencido não conta no feed');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(32, 'impression', 5, 'community_feed', 1)))), 0, 'feed de anúncio só-banner (A5) não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(33, 'impression', 6, 'community_banner', 1)))), 0, 'banner de anúncio só-feed (A6) não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(34, 'impression', 1, 'home_banner')))), 0, 'anúncio não-global (A1) não conta na Home');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(35, 'impression', 4, 'home_banner')))), 0, 'global só-feed (A4) não conta no banner da Home');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(36, 'impression', 2, 'community_banner', 1)))), 0, 'anúncio só global não conta dentro da comunidade');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(37, 'impression', 1, 'community_banner', 2)))), 0,
  'comunidade FALSIFICADA (usuário é membro de C2, mas A1 só mira C1) não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(jsonb_build_object(
    'id', pg_temp.u(38), 'type', 'impression', 'ad', gen_random_uuid(), 'placement', 'community_banner',
    'community', 'a2000000-0000-0000-0000-000000000001')))), 0, 'anúncio inexistente é ignorado');
select pg_temp.as_user(3);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(40, 'impression', 1, 'community_banner', 1)))), 0, 'não membro não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(41, 'impression', 2, 'home_banner')))), 1, 'não membro conta na Home (anúncio global é de todos)');
select pg_temp.as_user(4);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(42, 'impression', 1, 'community_banner', 1)))), 0, 'usuário banido da comunidade não conta');
select pg_temp.as_user(5);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(43, 'impression', 1, 'community_banner', 1)))), 0, 'conta desativada não conta (comunidade)');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(44, 'impression', 2, 'home_banner')))), 0, 'conta desativada não conta (Home)');
select pg_temp.as_user(1);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(45, 'impression', 2, 'home_banner')))), 0, 'superadmin (prévia) não conta');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(46, 'impression', 1, 'community_banner', 1)))), 0, 'superadmin não conta na comunidade');
reset role;
select is((select count(*) from public.sponsored_ad_event_marks), (select m from _before) + 1,
  'só o não membro na Home gerou marcador: nenhum evento inelegível deixou rastro');
select is((select sum(visible_impressions + clicks) from public.sponsored_ad_daily_stats), (select s from _before) + 1,
  'agregados só subiram pela impressão válida da Home');
select is((select count(*) from public.sponsored_ad_event_marks where user_id = 'a1000000-0000-0000-0000-000000000003'), 1::bigint,
  'o marcador pertence ao usuário da sessão');
select is((select count(*) from public.sponsored_ad_event_marks where event_id::text like 'e0000000-%' and expires_at not between now() + interval '47 hours 59 minutes' and now() + interval '48 hours 1 minute'), 0::bigint,
  'marcadores nascem com validade de 48 h');
set local role authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 5. Formato do lote (tudo ou nada) e parâmetros falsificados
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(2);
create function pg_temp.bad(p jsonb) returns text language plpgsql as $f$
begin
  perform public.record_ad_events(p);
  return 'aceito';
exception when others then return sqlerrm;
end $f$;
select is(pg_temp.bad(null), 'INVALID_EVENTS', 'null recusado');
select is(pg_temp.bad('{"id": 1}'::jsonb), 'INVALID_EVENTS', 'objeto no lugar de array recusado');
select is(pg_temp.bad('"x"'::jsonb), 'INVALID_EVENTS', 'string recusada');
select is(pg_temp.bad('[null]'::jsonb), 'INVALID_EVENTS', 'elemento null recusado');
select is(pg_temp.bad('[1]'::jsonb), 'INVALID_EVENTS', 'elemento escalar recusado');
select is(pg_temp.bad((select jsonb_agg(pg_temp.ev(100 + n, 'impression', 1, 'community_banner', 1)) from generate_series(1, 21) n)), 'INVALID_EVENTS', '21 eventos recusados (máx. 20)');
select is(pg_temp.bad((select jsonb_agg(pg_temp.ev(100 + n, 'impression', 1, 'community_banner', 1) || jsonb_build_object('x', repeat('a', 500))) from generate_series(1, 20) n)), 'INVALID_EVENTS', 'JSON acima de 8 KiB recusado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(120, 'impression', 1, 'community_banner', 1) || '{"user_id": "a1000000-0000-0000-0000-000000000003"}')), 'INVALID_EVENTS', 'user_id enviado pelo cliente é campo inesperado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(121, 'impression', 1, 'community_banner', 1) || '{"count": 99}')), 'INVALID_EVENTS', 'campo de contador/extra recusado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(122, 'impression', 1, 'community_banner', 1) || '{"at": "2020-01-01"}')), 'INVALID_EVENTS', 'timestamp declarado pelo cliente recusado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(123, 'view', 1, 'community_banner', 1))), 'INVALID_EVENTS', 'tipo desconhecido recusado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(124, 'impression', 1, 'sidebar', 1))), 'INVALID_EVENTS', 'posicionamento desconhecido recusado');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', 5, 'type', 'impression', 'ad', 'a3000000-0000-0000-0000-000000000001', 'placement', 'home_banner'))), 'INVALID_EVENTS', 'id numérico recusado');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', 'nao-e-uuid', 'type', 'impression', 'ad', 'a3000000-0000-0000-0000-000000000001', 'placement', 'home_banner'))), 'INVALID_EVENTS', 'id que não é uuid recusado');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', pg_temp.u(125), 'type', 'impression', 'ad', null, 'placement', 'home_banner'))), 'INVALID_EVENTS', 'ad null recusado');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', pg_temp.u(126), 'type', 'impression', 'placement', 'home_banner'))), 'INVALID_EVENTS', 'ad ausente recusado');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(127, 'impression', 2, 'home_banner', 1))), 'INVALID_EVENTS', 'Home com comunidade informada recusada');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(128, 'impression', 1, 'community_banner'))), 'INVALID_EVENTS', 'posicionamento de comunidade sem comunidade recusado');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', pg_temp.u(129), 'type', 'impression', 'ad', 'a3000000-0000-0000-0000-000000000001', 'placement', 'community_banner', 'community', '00000000-0000-0000-0000-000000000000'))), 'INVALID_EVENTS', 'comunidade = uuid zero recusada');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('id', pg_temp.u(130), 'type', 'impression', 'ad', 'a3000000-0000-0000-0000-000000000001', 'placement', 'community_banner', 'community', 7))), 'INVALID_EVENTS', 'comunidade numérica recusada');
select is(pg_temp.bad(jsonb_build_array(pg_temp.ev(131, 'impression', 1, 'community_banner', 1), jsonb_build_object('id', 'x'))), 'INVALID_EVENTS', 'um evento inválido derruba o lote');
reset role;
select is((select count(*) from public.sponsored_ad_event_marks where event_id::text like 'e0000000-0000-4000-8000-0000000001%'), 0::bigint,
  'lote inválido não grava nada, nem os eventos válidos do mesmo lote');
set local role authenticated;
select pg_temp.as_user(2);
-- ids maiúsculos são uuids válidos
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(jsonb_build_object(
    'id', upper(pg_temp.u(140)::text), 'type', 'impression', 'ad', upper('a3000000-0000-0000-0000-000000000001'),
    'placement', 'community_banner', 'community', upper('a2000000-0000-0000-0000-000000000001'))))), 1, 'uuid em caixa alta é aceito e normalizado');

-- ---------------------------------------------------------------------------------------------------
-- 6. Limites razoáveis (cliques/impressões repetidos não inflam sem limite)
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(6);
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(pg_temp.ev(200 + n, 'impression', 6, 'community_feed', 1)) from generate_series(1, 20) n))), 10,
  '20 impressões na mesma chave no dia: só 10 contam (teto por usuário/anúncio/posição/dia)');
select is(pg_temp.stat(6, 'community_feed', (select c1 from _c)), array[11, 2, 1]::bigint[], 'agregado reflete o teto (11 = 1 anterior do usuário 2 + 10)');
select is(pg_temp.accepted(public.record_ad_events((select jsonb_agg(pg_temp.ev(300 + n, 'click', 6, 'community_feed', 1)) from generate_series(1, 20) n))), 5,
  '20 cliques: só 5 contam');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(400, 'click', 6, 'community_feed', 1)))), 0, 'clique além do teto no dia ignorado');
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(401, 'impression', 6, 'community_feed', 1)))), 0, 'impressão além do teto ignorada');
select is(pg_temp.stat(6, 'community_feed', (select c1 from _c)), array[11, 2, 6]::bigint[], 'contadores param no teto');

reset role;
-- Teto diário por usuário (todas as campanhas): 300 marcadores de hoje para o usuário 02.
insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
select 'a1000000-0000-0000-0000-000000000002', gen_random_uuid(), 'impression', private.ad_metrics_day(now()),
       'a3000000-0000-0000-0000-000000000099', 'community_banner', gen_random_uuid()
  from generate_series(1, 300 - (select count(*)::int from public.sponsored_ad_event_marks where user_id = 'a1000000-0000-0000-0000-000000000002' and day = private.ad_metrics_day(now())));
select is((select count(*) from public.sponsored_ad_event_marks where user_id = 'a1000000-0000-0000-0000-000000000002' and day = private.ad_metrics_day(now())), 300::bigint, 'usuário 02 no teto diário');
set local role authenticated;
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(jsonb_build_array(pg_temp.ev(500, 'impression', 2, 'home_banner')))), 0, 'teto diário por usuário (300 eventos) bloqueia novos eventos');

-- ---------------------------------------------------------------------------------------------------
-- 7. Isolamento de leitura/escrita
-- ---------------------------------------------------------------------------------------------------
select pg_temp.as_user(3);
select throws_ok($$select * from public.sponsored_ad_event_marks$$, '42501', null, 'usuário comum não lê marcadores');
select throws_ok($$insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id)
  values ('a1000000-0000-0000-0000-000000000003', gen_random_uuid(), 'impression', current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000')$$, '42501', null, 'usuário comum não escreve marcadores');
select throws_ok($$update public.sponsored_ad_daily_stats set clicks = 999$$, '42501', null, 'usuário comum não altera contadores');
select throws_ok($$delete from public.sponsored_ad_daily_stats$$, '42501', null, 'usuário comum não apaga agregados');
select throws_ok($$insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name)
  values (current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', 'x')$$, '42501', null, 'usuário comum não insere agregados');
select throws_ok($$select * from public.sponsored_ad_metrics_settings$$, '42501', null, 'usuário comum não lê a chave do servidor');
select throws_ok($$update public.sponsored_ad_metrics_settings set collection_enabled = false$$, '42501', null, 'usuário comum não altera a chave do servidor');
select throws_ok($$select private.cleanup_sponsored_ad_metrics()$$, '42501', null, 'usuário comum não roda a limpeza');
select is((select count(*) from public.sponsored_ad_daily_stats), 0::bigint, 'RLS: usuário comum enxerga 0 linhas de agregados');
select pg_temp.as_user(1);
select ok((select count(*) from public.sponsored_ad_daily_stats where ad_id::text like 'a3000000-%') > 0, 'superadmin lê os agregados');
select throws_ok($$update public.sponsored_ad_daily_stats set clicks = 999$$, '42501', null, 'nem o superadmin escreve pelo cliente');

-- ---------------------------------------------------------------------------------------------------
-- 8. Retenção
-- ---------------------------------------------------------------------------------------------------
reset role;
insert into public.sponsored_ad_event_marks (user_id, event_id, kind, day, ad_id, placement, context_id, expires_at) values
  ('a1000000-0000-0000-0000-000000000003', 'f0000000-0000-4000-8000-000000000001', 'impression', current_date - 3, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', now() - interval '1 second'),
  ('a1000000-0000-0000-0000-000000000003', 'f0000000-0000-4000-8000-000000000002', 'impression', current_date, gen_random_uuid(), 'home_banner', '00000000-0000-0000-0000-000000000000', now() + interval '1 hour');
select is(private.cleanup_sponsored_ad_metrics(), 1, 'limpeza remove só o marcador vencido');
select is((select count(*) from public.sponsored_ad_event_marks where event_id = 'f0000000-0000-4000-8000-000000000001'), 0::bigint, 'marcador vencido sumiu');
select is((select count(*) from public.sponsored_ad_event_marks where event_id = 'f0000000-0000-4000-8000-000000000002'), 1::bigint, 'marcador vigente permanece');
select is(private.cleanup_sponsored_ad_metrics(), 0, 'limpeza é idempotente');
insert into public.sponsored_ad_daily_stats (day, ad_id, placement, context_id, partner_name, visible_impressions) values
  (private.ad_metrics_day(now()) - 800, 'a3000000-0000-0000-0000-0000000000a1', 'home_banner', '00000000-0000-0000-0000-000000000000', 'antigo', 5),
  (private.ad_metrics_day(now()) - 100, 'a3000000-0000-0000-0000-0000000000a2', 'home_banner', '00000000-0000-0000-0000-000000000000', 'recente', 5);
select is(private.cleanup_sponsored_ad_stats(), 1, 'agregados com mais de 24 meses são removidos');
select is((select count(*) from public.sponsored_ad_daily_stats where ad_id = 'a3000000-0000-0000-0000-0000000000a2'), 1::bigint, 'agregado recente permanece');
select is((select command from cron.job where jobname = 'cleanup-sponsored-ad-marks'), 'select private.cleanup_sponsored_ad_metrics()', 'cron horário dos marcadores agendado');
select is((select command from cron.job where jobname = 'cleanup-sponsored-ad-stats'), 'select private.cleanup_sponsored_ad_stats()', 'cron mensal dos agregados agendado');
select is((select count(*) from cron.job where command like '%sponsored_ad%'), 2::bigint, 'exatamente 2 jobs (nenhum órfão ou duplicado)');

-- exclusão de conta apaga os marcadores em cascata
select ok(pg_temp.marks(6) > 0, 'usuário 06 tem marcadores antes de excluir');
delete from auth.users where id = 'a1000000-0000-0000-0000-000000000006';
select is(pg_temp.marks(6), 0::bigint, 'exclusão da conta apaga os marcadores do usuário');

-- ---------------------------------------------------------------------------------------------------
-- 9. Chave do servidor desligada de novo: nada novo é aceito
-- ---------------------------------------------------------------------------------------------------
update public.sponsored_ad_metrics_settings set collection_enabled = false;
set local role authenticated;
select pg_temp.as_user(3);
select is(public.record_ad_events(jsonb_build_array(pg_temp.ev(600, 'impression', 2, 'home_banner'))), '{"enabled": false, "accepted": 0}'::jsonb, 'desligar a chave interrompe a gravação');

select * from finish();
rollback;
