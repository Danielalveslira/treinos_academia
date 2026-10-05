-- Auditoria de segurança das notificações: isolamento entre contas, impossibilidade de forjar alertas,
-- privilégios mínimos, vazamento de segredos e recuperação de jobs presos.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'sec-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users set role = 'superadmin' where id = 'b1000000-0000-0000-0000-000000000003';
-- A = 01 (atacante), B = 02 (vítima), S = 03 (superadmin)

insert into public.notifications (recipient_id, type, metadata)
values ('b1000000-0000-0000-0000-000000000002', 'admin_broadcast', '{"title":"so da B","body":"privado"}');
insert into public.notifications (recipient_id, type, metadata)
values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"da A","body":"x"}');
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/victim-device', repeat('p', 32), repeat('a', 16), 'ua', 'phone', 'android');

create temp table ids as select
  (select id from public.notifications where recipient_id = 'b1000000-0000-0000-0000-000000000002') as b_notif,
  (select id from public.notifications where recipient_id = 'b1000000-0000-0000-0000-000000000001') as a_notif;
grant select on ids to public;

-- ===== Atacante A (usuário comum autenticado) =====
set local role authenticated;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is((select count(*)::int from public.notifications), 1, 'A só enxerga as próprias notificações (RLS)');
select is((select count(*)::int from public.notifications where recipient_id = 'b1000000-0000-0000-0000-000000000002'), 0, 'A não lê notificações de B');
select is((select count(*)::int from public.notification_items), 1, 'a view da Central também isola por dono');
select is(public.notifications_mark_read(array[(select b_notif from ids)], null), 0, 'A não marca como lida a notificação de B');
select is(public.notifications_archive(array[(select b_notif from ids)], null), 0, 'A não arquiva a notificação de B');
select is(public.notifications_archive(null, now() + interval '1 day'), 1, 'arquivar "tudo" só alcança as próprias (1 linha)');
select throws_ok($$select public.notifications_mark_read(array(select generate_series(1, 201)::bigint), null)$$, 'INVALID_ARGUMENT', 'lista de ids gigante é recusada');
select throws_ok($$select public.notifications_mark_read(null, null)$$, 'INVALID_ARGUMENT', 'sem filtro nenhum é recusado');

-- forja de alertas / destinatário falsificado
select throws_ok($$insert into public.notifications (recipient_id, type) values ('b1000000-0000-0000-0000-000000000002', 'admin_broadcast')$$, '42501', null, 'A não cria notificação para B');
select throws_ok($$insert into public.notifications (recipient_id, type, metadata) values ('b1000000-0000-0000-0000-000000000001', 'admin_report', '{}')$$, '42501', null, 'A não cria alerta administrativo nem para si');
select throws_ok($$update public.notifications set recipient_id = 'b1000000-0000-0000-0000-000000000001' where id = (select b_notif from ids)$$, '42501', null, 'A não reatribui o destinatário de uma notificação');
select throws_ok($$delete from public.notifications$$, '42501', null, 'A não apaga notificações direto');
select throws_ok($$select public.create_push_broadcast('b2000000-0000-0000-0000-000000000001', 'Aviso', 'Mensagem', '/', true)$$, 'PERMISSION_DENIED', 'usuário comum não faz broadcast');
select throws_ok($$select public.admin_push_job_trace()$$, 'PERMISSION_DENIED', 'usuário comum não acessa o rastreio de Push');
select throws_ok($$select private.notify_superadmins('admin_report', 'high', 'x', null, '/admin/moderacao', '{}', 'forja', null, now())$$, '42501', null, 'A não chama a função que cria alertas administrativos');

-- forja de economia, moderação e votos
select throws_ok($$insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id) values ('b1000000-0000-0000-0000-000000000001', 'forja', 'coin', 'credit', 999, 'admin_bonus', 'x', 'y')$$, '42501', null, 'A não forja EvoCoins na ledger');
select throws_ok($$insert into public.notices (user_id, action, rule, reason) values ('b1000000-0000-0000-0000-000000000002', 'warning', 'r', 'forjado')$$, '42501', null, 'A não forja aviso de moderação para B');
select throws_ok($$insert into public.status_economy_votes (status_id, user_id, author_id, value) values (gen_random_uuid(), 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002', 1)$$, '42501', null, 'A não insere voto direto (forjaria curtida para B)');
select throws_ok($$update public.wallets set coin_balance = 1000000$$, '42501', null, 'A não altera a carteira');
select throws_ok($$insert into public.moderation_decisions (request_id, admin_id, target_user_id, action, rule, reason, evidence) values (gen_random_uuid(), gen_random_uuid(), null, 'warning', 'r', 'r', 'e')$$, '42501', null, 'A não forja decisão de moderação');
select throws_ok($$insert into public.workout_reminder_jobs (user_id, planned_date, kind, scheduled_at, timezone) values ('b1000000-0000-0000-0000-000000000002', current_date, 'start', now(), 'UTC')$$, '42501', null, 'A não cria lembrete de treino para B');
select throws_ok($$select private.dispatch_due_workout_reminders(10)$$, '42501', null, 'A não dispara o despachante de lembretes');
select throws_ok($$update public.users set training_preferences = '{}'::jsonb where id = 'b1000000-0000-0000-0000-000000000002'$$, '42501', null, 'A não altera o plano de treino de B (nem o próprio, fora da RPC)');

-- subscriptions: sempre da sessão autenticada
select throws_ok($$select * from public.push_subscriptions$$, '42501', null, 'A não lista subscriptions');
select throws_ok($$insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ('b1000000-0000-0000-0000-000000000002', 'https://fcm.googleapis.com/fcm/send/forjado', repeat('p', 32), repeat('a', 16))$$, '42501', null, 'A não grava subscription direto, nem em nome de B');
select lives_ok($$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/attacker-device', repeat('p', 32), repeat('a', 16), 'ua', 'x', 'y')$$, 'A registra o próprio dispositivo pela RPC');
select throws_ok($$select * from public.notification_push_outbox$$, '42501', null, 'A não lê a outbox');
select throws_ok($$select * from public.notification_push_deliveries$$, '42501', null, 'A não lê as entregas');
select throws_ok($$select * from public.push_notification_preferences$$, '42501', null, 'A não lê preferências de Push');
select throws_ok($$select * from public.workout_reminder_jobs$$, '42501', null, 'A não lê a agenda de lembretes');
select throws_ok($$select * from private.notification_catalog$$, '42501', null, 'A não lê o catálogo privado');
select is(public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/victim-device'), 0, 'A não revoga o dispositivo de B (mesmo sabendo o endpoint)');
select is((select (public.get_my_push_status('https://fcm.googleapis.com/fcm/send/victim-device'))->>'thisDevice'), 'false', 'A não descobre se um endpoint de B está ativo');

-- DML na view e oráculo de e-mail
select ok(not has_table_privilege('authenticated', 'public.notification_items', 'INSERT') and not has_table_privilege('authenticated', 'public.notification_items', 'UPDATE') and not has_table_privilege('authenticated', 'public.notification_items', 'DELETE'), 'a view da Central é só leitura (sem privilégio de escrita)');
select throws_ok($$select public.email_verified_ok('b1000000-0000-0000-0000-000000000002')$$, '42501', null, 'o oráculo email_verified_ok não é mais chamável');
-- action_url do banco
reset role;
select throws_ok($$insert into public.notifications (recipient_id, type, action_url) values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', E'/\\evil.test')$$, '23514', null, 'banco rejeita action_url com barra invertida');
select throws_ok($$insert into public.notifications (recipient_id, type, action_url) values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', E'/\t/evil.test')$$, '23514', null, 'banco rejeita action_url com tab (vira // no navegador)');
select throws_ok($$insert into public.notifications (recipient_id, type, action_url) values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', 'https://evil.test')$$, '23514', null, 'banco rejeita URL absoluta');
select throws_ok($$insert into public.notifications (recipient_id, type, action_url) values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', '/com espaco')$$, '23514', null, 'banco rejeita espaço no action_url');
select throws_ok($$insert into public.notifications (recipient_id, type, action_url) values ('b1000000-0000-0000-0000-000000000001', 'admin_broadcast', E'/\u2028/evil.test')$$, '23514', null, 'banco rejeita separador de linha Unicode');
select is(private.safe_push_target_url(E'/a\tb'), '/', 'sanitizador do claim recusa controle');
select is(private.safe_push_target_url('/comunidades/c#publicacao-p'), '/comunidades/c#publicacao-p', 'sanitizador do claim preserva a âncora do deep link');

-- ===== Visitante (anon) =====
set local role anon;
select throws_ok($$select * from public.notifications$$, '42501', null, 'anon não lê notificações');
select throws_ok($$select * from public.notices$$, '42501', null, 'anon não lê avisos de moderação');
select throws_ok($$select * from public.support_requests$$, '42501', null, 'anon não lê denúncias');
select throws_ok($$select public.notifications_archive(array[1], null)$$, '42501', null, 'anon não chama RPCs de notificação');
select throws_ok($$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/x', repeat('p', 32), repeat('a', 16))$$, '42501', null, 'anon não registra subscription');
select throws_ok($$select public.decide_support_request('{}'::jsonb)$$, '42501', null, 'anon não chama funções administrativas');
select throws_ok($$select public.refresh_public_statistics()$$, '42501', null, 'anon não dispara recálculo de estatísticas');
select lives_ok($$select public.is_superadmin()$$, 'auxiliares de RLS continuam acessíveis (as políticas dependem deles)');
reset role;

-- ===== Contrato de privilégios (estado, não comportamento) =====
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('list_published_professional_listings', 'is_superadmin', 'has_app_access', 'is_community_member', 'is_community_owner', 'can_post_in_community', 'community_access_allowed', 'push_delivery_ack')),
  0, 'anon só executa a listagem pública, os auxiliares de RLS e o ACK de telemetria do Push');
select is((select count(*)::int from pg_proc p where p.prosecdef and p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=' and c <> 'search_path=""' and c !~ 'pg_temp')),
  0, 'todo SECURITY DEFINER tem search_path vazio ou com pg_temp por último');
select is((select count(*)::int from pg_proc p where p.prosecdef and p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and not exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=')), 0, 'nenhum SECURITY DEFINER sem search_path fixo');
select is((select count(*)::int from pg_proc p where p.prorettype = 'trigger'::regtype and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and p.prosecdef and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
  and p.proname <> 'ensure_user_profile'), 0, 'funções de gatilho DEFINER não são chamáveis por clientes');
select ok(not has_function_privilege('authenticated', 'private.dispatch_due_workout_reminders(integer)', 'execute'), 'despachante de lembretes é interno');
select ok(not has_function_privilege('authenticated', 'public.claim_push_jobs(text,integer)', 'execute') and not has_function_privilege('authenticated', 'public.finish_push_batch(text,jsonb)', 'execute'), 'claim/finish só do service_role');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'INSERT') and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE') and not has_table_privilege('authenticated', 'public.notifications', 'DELETE'), 'ninguém escreve em notifications fora de RPC/trigger');

-- ===== Segredos: o rastreio e as mensagens de erro nunca carregam endpoint/chaves =====
insert into public.notification_push_outbox (notification_id, user_id, category, status) values ((select b_notif from ids), 'b1000000-0000-0000-0000-000000000002', 'administrative', 'processing');
update public.notification_push_outbox set locked_by = 'sec-worker', locked_at = now() where notification_id = (select b_notif from ids);
insert into public.notification_push_deliveries (outbox_id, notification_id, subscription_id, status, last_error)
select o.id, o.notification_id, s.id, 'failed', 'push service 500' from public.notification_push_outbox o, public.push_subscriptions s
where o.notification_id = (select b_notif from ids) and s.endpoint like '%victim-device';
select set_config('request.jwt.claim.role', 'service_role', true);
select ok(position('victim-device' in public.admin_push_job_trace(null, 50)::text) = 0 and position('fcm/send' in public.admin_push_job_trace(null, 50)::text) = 0
  and position('p256dh' in public.admin_push_job_trace(null, 50)::text) = 0, 'rastreio administrativo não expõe endpoint nem chaves');
select set_config('request.jwt.claim.role', '', true);

-- ===== Robustez: job preso em "processing" é recuperado =====
update public.notification_push_outbox set status = 'processing', locked_by = 'dead-worker', locked_at = now() - interval '11 minutes', attempt_count = 1
where notification_id = (select b_notif from ids);
delete from public.notification_push_deliveries where notification_id = (select b_notif from ids);
create temp table stuck as select * from public.claim_push_jobs('rescue-worker', 100) where notification_id = (select b_notif from ids);
select is((select count(*)::int from stuck), 1, 'job preso há >10 min em processing é reassumido por outro worker');
select is((select locked_by from public.notification_push_outbox where notification_id = (select b_notif from ids)), 'rescue-worker', 'e passa para o novo dono');
update public.notification_push_outbox set status = 'processing', locked_by = 'live-worker', locked_at = now() - interval '2 minutes' where notification_id = (select b_notif from ids);
select is((select count(*)::int from public.claim_push_jobs('other-worker', 100) where notification_id = (select b_notif from ids)), 0, 'job em processing recente NÃO é tomado por outro worker (sem duplicar o envio)');

select * from finish();
rollback;
