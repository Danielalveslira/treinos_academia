\ir _helpers/auth_session.sql
-- pgTAP: controles de privacidade da coleta (migration 20261019000001): menores de 18 anos e oposição.
-- Fixtures (prefixo b6...): 01 superadmin | 02 adulto membro | 03 adolescente (15) membro | 04 sem data de nascimento, membro |
-- 05 adulto membro (oposição) | 06 adolescente que vira 18 amanhã.
begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b6000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated', 'authenticated', 'priv' || n || '@example.invalid', 'x', now(), '{}', '{}', now(), now() from generate_series(1, 6) n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'b6000000-%';
update public.users set role = 'superadmin', username = 'privsuper01', data_nascimento = date '1980-01-01' where id = 'b6000000-0000-0000-0000-000000000001';
update public.users set data_nascimento = date '1990-05-05' where id in ('b6000000-0000-0000-0000-000000000002', 'b6000000-0000-0000-0000-000000000005');
update public.users set data_nascimento = (now() - interval '15 years')::date where id = 'b6000000-0000-0000-0000-000000000003';
update public.users set data_nascimento = (now() - interval '18 years' + interval '1 day')::date where id = 'b6000000-0000-0000-0000-000000000006';
insert into public.communities (id, name, created_by) values ('b7000000-0000-0000-0000-000000000001', 'C priv', 'b6000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) select 'b7000000-0000-0000-0000-000000000001', ('b6000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(2, 6) n;
insert into public.sponsored_ads (id, partner_name, title, community_ids, is_global, display_mode, created_by)
  values ('b8000000-0000-0000-0000-000000000001', 'Parceiro P', 'P', '{b7000000-0000-0000-0000-000000000001}', false, '{banner,feed}', 'b6000000-0000-0000-0000-000000000001');
update public.sponsored_ad_metrics_settings set collection_enabled = true;

create function pg_temp.ev(p_id integer) returns jsonb language sql as
  $f$select jsonb_build_array(jsonb_build_object('id', ('e6000000-0000-4000-8000-' || lpad(p_id::text, 12, '0'))::uuid, 'type', 'impression',
     'ad', 'b8000000-0000-0000-0000-000000000001', 'placement', 'community_banner', 'community', 'b7000000-0000-0000-0000-000000000001'))$f$;
create function pg_temp.as_user(p_n integer) returns void language sql as
  $f$select pg_temp.set_test_user( 'b6000000-0000-0000-0000-00000000000' || p_n, true)$f$;
create function pg_temp.accepted(p jsonb) returns integer language sql as $f$select (p ->> 'accepted')::integer$f$;
create function pg_temp.marks(p_n integer) returns bigint language sql security definer set search_path = '' as
  $f$select count(*) from public.sponsored_ad_event_marks where user_id = ('b6000000-0000-0000-0000-00000000000' || p_n)::uuid$f$;
create function pg_temp.impressions() returns bigint language sql security definer set search_path = '' as
  $f$select coalesce(sum(visible_impressions), 0) from public.sponsored_ad_daily_stats where ad_id = 'b8000000-0000-0000-0000-000000000001'$f$;

-- estrutura e privilégios
select ok((select exclude_minors from public.sponsored_ad_metrics_settings), 'padrão: menores de 18 anos FORA da medição');
select ok((select relrowsecurity from pg_class where oid = 'public.sponsored_ad_metrics_opt_outs'::regclass), 'RLS ligada nas oposições');
select ok(not has_table_privilege('authenticated', 'public.sponsored_ad_metrics_opt_outs', 'select') and not has_table_privilege('anon', 'public.sponsored_ad_metrics_opt_outs', 'select'), 'oposições não são legíveis por clientes');
select ok(not has_function_privilege('anon', 'public.admin_set_ad_metrics_opt_out(uuid,boolean)', 'execute'), 'anon sem EXECUTE na RPC de oposição');
select ok((select proconfig from pg_proc where oid = 'public.admin_set_ad_metrics_opt_out(uuid,boolean)'::regprocedure) @> array['search_path=""'], 'RPC de oposição com search_path vazio');
select ok((select proconfig from pg_proc where oid = 'public.record_ad_events(jsonb)'::regprocedure) @> array['search_path=""'], 'record_ad_events mantém search_path vazio');

set local role authenticated;
-- adulto conta
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(1))), 1, 'adulto é medido');
-- adolescente e sem data de nascimento: ignorados em silêncio, sem rastro
select pg_temp.as_user(3);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(2))), 0, 'adolescente (15) não é medido');
select is(pg_temp.marks(3), 0::bigint, 'e não deixa marcador');
select pg_temp.as_user(4);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(3))), 0, 'conta sem data de nascimento não é medida');
select pg_temp.as_user(6);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(4))), 0, 'quem completa 18 anos amanhã ainda não é medido');
select is(pg_temp.impressions(), 1::bigint, 'só a impressão do adulto entrou nos agregados');

-- ligar a medição de adolescentes é um UPDATE (decisão futura), sem deploy
reset role;
update public.sponsored_ad_metrics_settings set exclude_minors = false;
set local role authenticated;
select pg_temp.as_user(3);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(5))), 1, 'com exclude_minors=false o adolescente passa a ser medido');
select pg_temp.as_user(4);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(6))), 1, 'e a conta sem data de nascimento também (decisão explícita do operador)');
reset role;
update public.sponsored_ad_metrics_settings set exclude_minors = true;
set local role authenticated;

-- oposição: permissões da RPC administrativa
select pg_temp.as_user(2);
select throws_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', true)$$, 'P0001', 'PERMISSION_DENIED', 'usuário comum não registra oposição de ninguém');
select throws_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000002', false)$$, 'P0001', 'PERMISSION_DENIED', 'nem desfaz a própria (só o atendimento)');
set local role anon;
select throws_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', true)$$, '42501', null, 'anon não executa');
set local role authenticated;
select pg_temp.as_user(1);
select throws_ok($$select public.admin_set_ad_metrics_opt_out(gen_random_uuid(), true)$$, 'P0001', 'INVALID_REQUEST', 'conta inexistente é recusada');
select throws_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', null)$$, 'P0001', 'INVALID_REQUEST', 'parâmetro nulo é recusado');

-- oposição: antes mede, depois ignora e apaga o marcador temporário
select pg_temp.as_user(5);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(7))), 1, 'antes da oposição a conta é medida');
select is(pg_temp.marks(5), 1::bigint, 'e tem 1 marcador temporário');
select pg_temp.as_user(1);
select lives_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', true)$$, 'superadmin registra a oposição');
select is(pg_temp.marks(5), 0::bigint, 'os marcadores temporários da conta são apagados na hora');
select pg_temp.as_user(5);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(8))), 0, 'depois da oposição a conta não é medida');
select is(pg_temp.marks(5), 0::bigint, 'e não deixa rastro');
select is(pg_temp.impressions(), 4::bigint, 'agregados não mudaram (a oposição não apaga totais anônimos)');
select pg_temp.as_user(1);
select lives_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', true)$$, 'registrar duas vezes é idempotente');
select lives_ok($$select public.admin_set_ad_metrics_opt_out('b6000000-0000-0000-0000-000000000005', false)$$, 'superadmin desfaz a oposição');
select pg_temp.as_user(5);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(9))), 1, 'desfeita a oposição, a conta volta a ser medida');

-- a oposição de uma conta não afeta outra
select pg_temp.as_user(2);
select is(pg_temp.accepted(public.record_ad_events(pg_temp.ev(10))), 1, 'outras contas seguem medidas');

-- exclusão da conta apaga a oposição em cascata
reset role;
insert into public.sponsored_ad_metrics_opt_outs (user_id) values ('b6000000-0000-0000-0000-000000000002');
delete from auth.users where id = 'b6000000-0000-0000-0000-000000000002';
select is((select count(*) from public.sponsored_ad_metrics_opt_outs where user_id = 'b6000000-0000-0000-0000-000000000002'), 0::bigint, 'exclusão da conta apaga a oposição em cascata');

select * from finish();
rollback;
