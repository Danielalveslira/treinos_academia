\ir _helpers/auth_session.sql
-- Telemetria da última milha do Web Push: token opaco, ACK do Service Worker, tempos do worker,
-- código HTTP real, idempotência, isolamento entre entregas e ausência de segredos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'tele-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02']) as n;

select pg_temp.set_test_user( 'c1000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/tele-a', repeat('p', 32), repeat('a', 16), 'ua', 'phone', 'android');
select pg_temp.set_test_user( 'c1000000-0000-0000-0000-000000000002', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/tele-b', repeat('q', 32), repeat('b', 16), 'ua', 'laptop', 'windows');

insert into public.notifications (recipient_id, type, metadata) values
  ('c1000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"para A","body":"x"}'),
  ('c1000000-0000-0000-0000-000000000002', 'admin_broadcast', '{"title":"para B","body":"y"}');

create temp table claimed as select * from public.claim_push_jobs('tele-w1', 100);
grant select on claimed to public;
select is((select count(*)::int from claimed), 2, 'o claim devolve uma entrega por aparelho');
select ok((select bool_and(ack_token ~ '^[0-9a-f]{64}$') from claimed), 'cada entrega recebe um token opaco de 256 bits (64 hex)');
select is((select count(distinct ack_token)::int from claimed), 2, 'tokens distintos por entrega');
select ok((select bool_and(d.ack_token_hash = sha256(convert_to(c.ack_token, 'utf8')) and d.claimed_at is not null)
  from claimed c join public.notification_push_deliveries d on d.id = c.delivery_id), 'o banco guarda só o hash SHA-256 e o claimed_at');
select ok(not exists (
  select 1 from claimed c, public.notification_push_deliveries d
  where d.id = c.delivery_id and (d::text like '%' || c.ack_token || '%' or d.ack_token_hash = decode(c.ack_token, 'hex'))),
  'o token em claro não aparece em nenhuma coluna da entrega');
select ok(not exists (
  select 1 from claimed c, public.notification_push_outbox o, public.notifications n
  where (o::text like '%' || c.ack_token || '%') or (n::text like '%' || c.ack_token || '%')),
  'nem na outbox nem na notificação');

-- ===== Worker: tempos e código HTTP real =====
select public.finish_push_batch('tele-w1', (
  select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'sent',
    'http_status', case when endpoint like '%tele-a' then 201 else 202 end, 'error', null,
    'worker_started_at', to_char(now() - interval '2 seconds', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'provider_accepted_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
  from claimed));
select is((select last_http_status from public.notification_push_deliveries d join claimed c on c.delivery_id = d.id where c.endpoint like '%tele-a'), 201, 'HTTP real 201 persistido');
select is((select last_http_status from public.notification_push_deliveries d join claimed c on c.delivery_id = d.id where c.endpoint like '%tele-b'), 202, 'HTTP real 202 persistido (não é fixo em 201)');
select ok((select bool_and(d.worker_started_at is not null and d.provider_accepted_at is not null and d.worker_started_at < d.provider_accepted_at)
  from public.notification_push_deliveries d join claimed c on c.delivery_id = d.id), 'worker_started_at e provider_accepted_at persistidos em ordem');

-- ===== Service Worker: ACK anônimo, relógio do servidor, idempotência =====
create temp table tok as select
  (select ack_token from claimed where endpoint like '%tele-a') as a,
  (select ack_token from claimed where endpoint like '%tele-b') as b,
  (select delivery_id from claimed where endpoint like '%tele-a') as a_id,
  (select delivery_id from claimed where endpoint like '%tele-b') as b_id;
grant select on tok to public;

set local role anon;
select throws_ok($$select * from public.notification_push_deliveries$$, '42501', null, 'anon não lê as entregas');
select throws_ok($$select * from private.push_delivery_timeline$$, '42501', null, 'anon não lê a linha do tempo');
select throws_ok($$select public.claim_push_jobs('x', 1)$$, '42501', null, 'anon não faz claim');
select throws_ok($$select public.finish_push_batch('x', '[]'::jsonb)$$, '42501', null, 'anon não finaliza lote');
select lives_ok($$select public.push_delivery_ack((select a from tok), 'received')$$, 'anon registra "received" com o token da entrega');
reset role;
select ok((select sw_received_at is not null and sw_received_at >= claimed_at and sw_received_at <= clock_timestamp()
  from public.notification_push_deliveries where id = (select a_id from tok)), 'sw_received_at vem do relógio do servidor');
select is((select sw_received_at is null from public.notification_push_deliveries where id = (select b_id from tok)), true, 'o token de A não alterou a entrega de B');

create temp table first_ts as select sw_received_at as ts from public.notification_push_deliveries where id = (select a_id from tok);
select pg_sleep(0.05);
set local role anon;
select public.push_delivery_ack((select a from tok), 'received');
reset role;
select is((select sw_received_at from public.notification_push_deliveries where id = (select a_id from tok)), (select ts from first_ts), 'retry do mesmo evento é idempotente (não sobrescreve o primeiro tempo)');

set local role authenticated;
select pg_temp.set_test_user( 'c1000000-0000-0000-0000-000000000001', true);
select public.push_delivery_ack((select a from tok), 'shown');
select public.push_delivery_ack((select a from tok), 'clicked');
reset role;
select ok((select show_resolved_at is not null and show_resolved_at >= sw_received_at and clicked_at >= show_resolved_at
  from public.notification_push_deliveries where id = (select a_id from tok)), 'shown e clicked gravados em ordem');

-- usuário A não consegue usar a própria sessão para mexer na entrega de B: só o token de B vale
select public.push_delivery_ack((select a from tok), 'show_failed', 'NotAllowedError');
select is((select show_failed_at is null from public.notification_push_deliveries where id = (select b_id from tok)), true, 'entrega de B intacta após ACKs de A');

-- falha ao exibir: nome do erro validado
set local role anon;
select public.push_delivery_ack((select b from tok), 'received');
select public.push_delivery_ack((select b from tok), 'show_failed', 'NotAllowedError');
reset role;
select is((select show_failure from public.notification_push_deliveries where id = (select b_id from tok)), 'NotAllowedError', 'showNotification rejeitado: show_failed_at/show_failure gravados');
select ok((select show_failed_at is not null and show_resolved_at is null from public.notification_push_deliveries where id = (select b_id from tok)), 'falha e sucesso não se misturam');
update public.notification_push_deliveries set show_failed_at = null, show_failure = null where id = (select b_id from tok);
set local role anon;
select public.push_delivery_ack((select b from tok), 'show_failed', 'x y; drop table users');
reset role;
select is((select show_failure from public.notification_push_deliveries where id = (select b_id from tok)), 'Error', 'nome de erro fora do formato é trocado por "Error" (nada de texto livre)');

-- ===== Entradas inválidas: sem erro, sem efeito, sem oráculo =====
create temp table before_state as select count(*)::int as n, count(sw_received_at)::int as r, count(show_resolved_at)::int as s, count(clicked_at)::int as c
  from public.notification_push_deliveries;
set local role anon;
select lives_ok($$select public.push_delivery_ack(repeat('0', 64), 'received')$$, 'token inexistente (formato válido): sem erro');
select lives_ok($$select public.push_delivery_ack('abc', 'received')$$, 'token curto: sem erro');
select lives_ok($$select public.push_delivery_ack(upper((select b from tok)), 'shown')$$, 'token com maiúsculas: sem erro');
select lives_ok($$select public.push_delivery_ack(null, 'shown')$$, 'token nulo: sem erro');
select lives_ok($$select public.push_delivery_ack((select b from tok), 'delete_everything')$$, 'evento desconhecido: sem erro');
select lives_ok($$select public.push_delivery_ack((select b from tok) || ' ', 'shown')$$, 'token com sufixo: sem erro');
select lives_ok($$select public.push_delivery_ack('; update x', 'shown')$$, 'token com SQL: sem erro');
reset role;
select is((select (count(*)::int, count(sw_received_at)::int, count(show_resolved_at)::int, count(clicked_at)::int)::text
  from public.notification_push_deliveries), (select (n, r, s, c)::text from before_state), 'entradas inválidas não alteraram nenhuma entrega');

-- token vencido (>30 dias) deixa de valer
update public.notification_push_deliveries set clicked_at = null, claimed_at = now() - interval '31 days' where id = (select b_id from tok);
set local role anon;
select public.push_delivery_ack((select b from tok), 'clicked');
reset role;
select is((select clicked_at is null from public.notification_push_deliveries where id = (select b_id from tok)), true, 'token com mais de 30 dias é ignorado');
update public.notification_push_deliveries set claimed_at = now() where id = (select b_id from tok);

-- ===== Worker: dados inválidos não derrubam o lote =====
insert into public.notifications (recipient_id, type, metadata) values
  ('c1000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"2","body":"x"}');
create temp table claimed2 as select * from public.claim_push_jobs('tele-w2', 100);
select lives_ok($$select public.finish_push_batch('tele-w2', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'sent',
  'http_status', 999, 'worker_started_at', 'lixo', 'provider_accepted_at', '2999-01-01T00:00:00Z')) from claimed2))$$,
  'tempo ilegível/absurdo e HTTP fora de 100-599 não derrubam o lote');
select ok((select last_http_status is null and worker_started_at is null and provider_accepted_at is null
  from public.notification_push_deliveries where id = (select delivery_id from claimed2)), 'valores inválidos viram nulo (nada é inventado)');

-- ===== Nova tentativa: token novo, tempos zerados, token antigo morto =====
insert into public.notifications (recipient_id, type, metadata) values
  ('c1000000-0000-0000-0000-000000000002', 'admin_broadcast', '{"title":"3","body":"x"}');
create temp table claimed3 as select * from public.claim_push_jobs('tele-w3', 100);
grant select on claimed3 to public;
select public.finish_push_batch('tele-w3', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'transient', 'http_status', 503, 'error', 'indisponivel',
  'worker_started_at', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) from claimed3));
set local role anon;
select public.push_delivery_ack((select ack_token from claimed3), 'received');
reset role;
select is((select last_http_status from public.notification_push_deliveries where id = (select delivery_id from claimed3)), 503, 'falha do Push Service também guarda o HTTP real');
update public.notification_push_deliveries set next_attempt_at = now() where id = (select delivery_id from claimed3);
update public.notification_push_outbox set next_attempt_at = now() where id = (select job_id from claimed3);
create temp table reclaimed as select * from public.claim_push_jobs('tele-w4', 100);
grant select on reclaimed to public;
select is((select count(*)::int from reclaimed), 1, 'a entrega com falha transitória volta no ciclo seguinte');
select isnt((select ack_token from reclaimed), (select ack_token from claimed3), 'cada tentativa recebe um token novo');
select ok((select sw_received_at is null and worker_started_at is null and provider_accepted_at is null
  from public.notification_push_deliveries where id = (select delivery_id from reclaimed)), 'os tempos da tentativa anterior são zerados');
set local role anon;
select public.push_delivery_ack((select ack_token from claimed3), 'shown');
reset role;
select is((select show_resolved_at is null from public.notification_push_deliveries where id = (select delivery_id from reclaimed)), true, 'o token da tentativa antiga não vale mais');

-- ===== Linha do tempo e higiene =====
select ok((select total_to_show_ms >= 0 and provider_to_sw_ms >= 0 and sw_to_show_ms >= 0 and claim_to_provider_ms is not null
  from private.push_delivery_timeline where delivery_id = (select a_id from tok)), 'a view calcula as etapas em milissegundos');
select is((select count(*)::int from information_schema.columns where table_schema = 'private' and table_name = 'push_delivery_timeline'
  and column_name ~* '(^endpoint$|p256dh|auth|token|key|body|title|metadata)'), 0, 'a linha do tempo não expõe endpoint, chaves, token nem conteúdo');
select is((select count(*)::int from information_schema.columns where table_schema = 'public' and table_name = 'notification_push_deliveries'
  and column_name in ('endpoint', 'p256dh', 'auth', 'ack_token', 'token', 'payload', 'title', 'body')), 0, 'a tabela de entregas não tem colunas para segredo ou conteúdo');
select ok(not has_function_privilege('anon', 'private.push_clock(text)', 'execute') and not has_function_privilege('authenticated', 'private.push_clock(text)', 'execute'), 'o auxiliar de relógio não é chamável por clientes');
select ok(has_function_privilege('anon', 'public.push_delivery_ack(text,text,text)', 'execute') and not has_function_privilege('anon', 'public.finish_push_batch(text,jsonb)', 'execute'), 'anon executa somente o ACK');

select * from finish();
rollback;
