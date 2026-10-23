\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('95000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ph-1@example.invalid', 'x', now(), '{}', '{}', now(), now()),
  ('95000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'ph-2@example.invalid', 'x', now(), '{}', '{}', now(), now()),
  ('95000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'ph-admin@example.invalid', 'x', now(), '{}', '{}', now(), now());
update public.users set role = 'superadmin' where id = '95000000-0000-0000-0000-000000000003';

select ok(not has_function_privilege('anon', 'private.enqueue_notification_push()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.enqueue_notification_push()', 'EXECUTE'), 'função do trigger não é executável pelo cliente');
select ok(not has_function_privilege('authenticated', 'public.claim_push_jobs(text,integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.finish_push_batch(text,jsonb)', 'EXECUTE'), 'claim/finish são só do service_role');

-- Endpoint allowlist (SSRF) e targetUrl ---------------------------------------------------
select is(private.safe_push_target_url('/\evil.test'), '/', 'targetUrl com barra invertida é rejeitado');
select is(private.safe_push_target_url('/comunidades/1'), '/comunidades/1', 'targetUrl interno é preservado');
select ok(private.is_push_endpoint_allowed('https://fcm.googleapis.com/fcm/send/abc'), 'FCM permitido');
select ok(private.is_push_endpoint_allowed('https://updates.push.services.mozilla.com/wpush/v2/abc'), 'Mozilla permitido');
select ok(private.is_push_endpoint_allowed('https://web.push.apple.com/abc'), 'Apple permitido');
select ok(private.is_push_endpoint_allowed('https://wns2-par02p.notify.windows.com/w/?token=abc'), 'WNS permitido');
select ok(not private.is_push_endpoint_allowed('https://push.example/abc'), 'host desconhecido recusado');
select ok(not private.is_push_endpoint_allowed('https://fcm.googleapis.com.evil.test/abc'), 'sufixo malicioso recusado');
select ok(not private.is_push_endpoint_allowed('https://fcm.googleapis.com@evil.test/abc'), 'userinfo malicioso recusado');
select ok(not private.is_push_endpoint_allowed('http://fcm.googleapis.com/abc'), 'http recusado');
select ok(not private.is_push_endpoint_allowed('https://169.254.169.254/abc'), 'IP interno recusado');

set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select throws_ok(
  $$select public.register_push_subscription('https://push.example/x', repeat('p', 32), repeat('a', 16))$$,
  'INVALID_SUBSCRIPTION', 'registro recusa endpoint fora da allowlist'
);
select lives_ok(
  $$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/u1-a', repeat('p', 32), repeat('a', 16))$$,
  'registro aceita endpoint permitido'
);
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/u1-a')->>'thisDevice', 'true', 'status identifica este dispositivo');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/outro')->>'thisDevice', 'false', 'status não confunde outro dispositivo');
select is(public.get_my_push_status()->>'thisDevice', 'false', 'status sem endpoint não marca dispositivo');

-- Registro e revogação não mexem na preferência ---------------------------------------------
reset role;
update public.push_notification_preferences set enabled = false where user_id = '95000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/u1-a', repeat('p', 32), repeat('a', 16));
reset role;
select is((select enabled from public.push_notification_preferences where user_id = '95000000-0000-0000-0000-000000000001'),
  false, 'sync/registro não religa preferência desligada');
update public.push_notification_preferences set enabled = true where user_id = '95000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select is(public.unregister_push_subscription(), 1, 'logout global revoga os dispositivos da conta');
reset role;
select is((select enabled from public.push_notification_preferences where user_id = '95000000-0000-0000-0000-000000000001'),
  true, 'revogar dispositivos não desliga a preferência');

-- Troca de conta: entrega pendente da conta A não chega à conta B ---------------------------
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/shared', repeat('p', 32), repeat('a', 16));
reset role;
insert into public.notifications (recipient_id, type, metadata)
values ('95000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"reassign","body":"x"}');
create temporary table claim_reassign as select * from public.claim_push_jobs('hard-w1', 100);
select is((select count(*)::int from claim_reassign where endpoint like '%/shared'), 1, 'conta A recebe a entrega');
select public.finish_push_batch('hard-w1',
  (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'transient', 'http_status', 503, 'error', 'down')) from claim_reassign));
update public.notification_push_deliveries set next_attempt_at = now() - interval '1 second';
update public.notification_push_outbox set next_attempt_at = now() - interval '1 second' where status = 'pending';
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000002', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/shared', repeat('q', 32), repeat('b', 16));
reset role;
select is((select status from public.notification_push_deliveries where last_error = 'SUBSCRIPTION_REASSIGNED'), 'cancelled',
  'reassociação cancela entrega pendente da conta anterior');
create temporary table claim_after_reassign as select * from public.claim_push_jobs('hard-w2', 100);
select is((select count(*)::int from claim_after_reassign), 0, 'conta B não recebe notificação da conta A');
select is((select status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'reassign'), 'cancelled', 'job sem entrega possível termina (não fica em loop)');

-- Subscription revogada com entrega pendente não gera loop infinito ------------------------
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/loop-a', repeat('p', 32), repeat('a', 16));
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/loop-b', repeat('p', 32), repeat('a', 16));
reset role;
insert into public.notifications (recipient_id, type, metadata)
values ('95000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"loop","body":"x"}');
create temporary table claim_loop as select * from public.claim_push_jobs('hard-w3', 100);
select is((select count(*)::int from claim_loop where notification_id = (select id from public.notifications where metadata->>'title' = 'loop')), 2,
  'dois dispositivos recebem entrega');
select public.finish_push_batch('hard-w3',
  (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id,
    'outcome', case when endpoint like '%loop-a' then 'sent' else 'transient' end,
    'http_status', case when endpoint like '%loop-a' then 201 else 503 end, 'error', null))
   from claim_loop where notification_id = (select id from public.notifications where metadata->>'title' = 'loop')));
update public.push_subscriptions set revoked_at = now() where endpoint like '%/loop-b';
update public.notification_push_deliveries set next_attempt_at = now() - interval '1 second';
update public.notification_push_outbox set next_attempt_at = now() - interval '1 second' where status = 'pending';
create temporary table claim_loop2 as select * from public.claim_push_jobs('hard-w4', 100);
select is((select count(*)::int from claim_loop2), 0, 'subscription revogada não é reenviada');
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'loop'), 'sent', 'job com um dispositivo entregue e outro revogado conclui como sent');

-- Elegibilidade: conta bloqueada (gatilho da 02) e Push/categoria desligados (recheca no claim) --
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/elig', repeat('p', 32), repeat('a', 16));
reset role;
insert into public.notifications (recipient_id, type, metadata)
values ('95000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"elig","body":"x"}');
update public.users set account_status = 'disabled' where id = '95000000-0000-0000-0000-000000000001';
create temporary table claim_elig as select * from public.claim_push_jobs('hard-w5', 100);
select is((select count(*)::int from claim_elig), 0, 'conta desativada após o enfileiramento não recebe');
select ok((select o.last_error in ('ACCOUNT_UNAVAILABLE','RECIPIENT_NOT_ELIGIBLE') and o.status = 'cancelled'
  from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'elig'), 'job é cancelado com motivo');
select is((select count(*)::int from public.push_subscriptions where user_id = '95000000-0000-0000-0000-000000000001' and revoked_at is null), 0,
  'bloquear a conta revoga as subscriptions (gatilho)');
update public.users set account_status = 'active' where id = '95000000-0000-0000-0000-000000000001';

-- Push/categoria desligados DEPOIS do enfileiramento: o claim cancela (não depende do gatilho).
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000001', true);
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/elig2', repeat('p', 32), repeat('a', 16));
reset role;
insert into public.notifications (recipient_id, type, metadata)
values ('95000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"cat-off","body":"x"}');
update public.push_notification_preferences set categories = '{"administrative":false}'::jsonb
where user_id = '95000000-0000-0000-0000-000000000001';
create temporary table claim_cat as select * from public.claim_push_jobs('hard-w5b', 100);
select is((select count(*)::int from claim_cat), 0, 'categoria desligada após o enfileiramento não recebe');
select is((select o.last_error from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'cat-off'), 'RECIPIENT_NOT_ELIGIBLE', 'claim cancela com motivo');
update public.push_notification_preferences set categories = '{"administrative":true}'::jsonb
where user_id = '95000000-0000-0000-0000-000000000001';

-- Só retries futuros: devolve à fila sem esperar o lock expirar -----------------------------
insert into public.notifications (recipient_id, type, metadata)
values ('95000000-0000-0000-0000-000000000001', 'admin_broadcast', '{"title":"future","body":"x"}');
create temporary table claim_future as select * from public.claim_push_jobs('hard-w6', 100);
select public.finish_push_batch('hard-w6',
  (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'transient', 'http_status', 503, 'error', 'down'))
   from claim_future where notification_id = (select id from public.notifications where metadata->>'title' = 'future')));
update public.notification_push_outbox set next_attempt_at = now() - interval '1 second', status = 'pending'
where notification_id = (select id from public.notifications where metadata->>'title' = 'future');
create temporary table claim_future2 as select * from public.claim_push_jobs('hard-w7', 100);
select is((select count(*)::int from claim_future2), 0, 'entrega ainda não vencida não é reenviada');
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'future'), 'pending', 'job volta para a fila em vez de ficar processing');
select ok((select o.next_attempt_at > now() from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'future'), 'próxima tentativa respeita o backoff');

-- Resultado inválido não grava estado ---------------------------------------------------------
select throws_ok($$select public.finish_push_batch('x', '[{"delivery_id":"95000000-0000-0000-0000-0000000000aa"}]')$$,
  'INVALID_OUTCOME', 'resultado sem outcome é rejeitado');
select throws_ok($$select public.finish_push_batch('x', '[{"outcome":"sent"}]')$$,
  'INVALID_RESULTS', 'resultado sem delivery é rejeitado');

-- Teto de dispositivos ativos por conta -----------------------------------------------------
set local role authenticated;
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000002', true);
do $$ begin
  for i in 1..22 loop
    perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/cap-' || i, repeat('p', 32), repeat('a', 16));
  end loop;
end $$;
select is((public.get_my_push_status()->>'activeSubscriptions')::int, 20, 'conta mantém no máximo 20 dispositivos ativos');

-- Auditoria do broadcast sobrevive à exclusão do superadmin ----------------------------------
select pg_temp.set_test_user( '95000000-0000-0000-0000-000000000003', true);
select lives_ok($$select public.create_push_broadcast('96000000-0000-0000-0000-000000000001', 'Aviso', 'Mensagem', '/\evil.test', true)$$,
  'superadmin cria broadcast');
reset role;
select is((select target_url from public.push_broadcast_audit where idempotency_key = '96000000-0000-0000-0000-000000000001'), '/',
  'broadcast sanitiza targetUrl com barra invertida');
delete from auth.users where id = '95000000-0000-0000-0000-000000000003';
select is((select created_by from public.push_broadcast_audit where idempotency_key = '96000000-0000-0000-0000-000000000001'), null,
  'excluir o superadmin preserva a auditoria');

-- Cron do worker: único, autenticado por segredo do Vault e sem segredo literal -----------------
select is((select count(*)::int from cron.job where jobname = 'process-push-outbox'), 1, 'continua existindo um único cron do worker');
select ok((select command like '%X-Push-Worker-Secret%' and command like '%vault.decrypted_secrets%' and command like '%push_worker_secret%'
  from cron.job where jobname = 'process-push-outbox'), 'cron envia o segredo lido do Vault');

select * from finish();
rollback;
