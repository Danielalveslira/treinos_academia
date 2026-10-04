begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('91000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'push-1@example.invalid', 'x', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'push-2@example.invalid', 'x', now(), '{}', '{}', now(), now()),
  ('91000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'push-admin@example.invalid', 'x', now(), '{}', '{}', now(), now());
update public.users set role = 'superadmin' where id = '91000000-0000-0000-0000-000000000003';

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select lives_ok(
  $$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/device', repeat('p', 32), repeat('a', 16), 'test', 'phone', 'android')$$,
  'usuário registra subscription para a própria sessão'
);
select is((public.get_my_push_status()->>'activeSubscriptions')::int, 1, 'status não expõe segredos e conta a subscription');

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000002', true);
select lives_ok(
  $$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/device', repeat('q', 32), repeat('b', 16), 'test', 'shared', 'desktop')$$,
  'mesmo endpoint é reassociado na troca de conta'
);
reset role;
select is((select user_id from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/device'),
  '91000000-0000-0000-0000-000000000002'::uuid, 'endpoint pertence somente à conta atual');
select is((select count(*)::int from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/device'), 1, 'endpoint é único');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000001', true);
select is(public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/device'), 0, 'usuário anterior não revoga endpoint reassociado');
select throws_ok($$select * from public.notification_push_outbox$$, '42501', null, 'cliente não lê a outbox');
select throws_ok($$select * from public.notification_push_deliveries$$, '42501', null, 'cliente não lê deliveries');
select ok(not has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT'), 'authenticated não lista subscriptions');
select ok(not has_table_privilege('anon', 'public.push_subscriptions', 'SELECT'), 'anon não lê subscriptions');
select ok(not has_function_privilege('anon', 'public.register_push_subscription(text,text,text,text,text,text)', 'EXECUTE'), 'anon não executa registro');
select throws_ok(
  $$select public.create_push_broadcast('92000000-0000-0000-0000-000000000001', 'Teste', 'Mensagem', '/', true)$$,
  'PERMISSION_DENIED', 'usuário comum não cria broadcast'
);

select set_config('request.jwt.claim.sub', '91000000-0000-0000-0000-000000000003', true);
select lives_ok(
  $$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/admin', repeat('r', 32), repeat('c', 16), 'test', 'admin', 'desktop')$$,
  'admin registra subscription própria'
);
select lives_ok(
  $$select public.create_push_broadcast('92000000-0000-0000-0000-000000000001', 'Aviso', 'Mensagem segura', '/perfil', true)$$,
  'superadmin cria broadcast confirmado'
);
reset role;
select is((select count(*)::int from public.push_broadcast_audit where idempotency_key = '92000000-0000-0000-0000-000000000001'), 1, 'broadcast é auditado');
select is((select count(*)::int from public.notification_push_outbox where user_id in (
  '91000000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003')), 2,
  'broadcast reutiliza notifications e gera uma outbox por destinatário com subscription');

-- Resultado 410 revoga a subscription; 404 segue o mesmo outcome `expired` do worker.
insert into public.push_subscriptions (id, user_id, endpoint, p256dh, auth)
values ('93500000-0000-0000-0000-000000000002', '91000000-0000-0000-0000-000000000003',
  'https://fcm.googleapis.com/fcm/send/admin-2', repeat('s', 32), repeat('d', 16));
insert into public.notification_push_outbox (id, notification_id, user_id, category, status, locked_by, locked_at)
select '93000000-0000-0000-0000-000000000001', n.id, n.recipient_id, 'administrative', 'processing', 'expired-worker', now()
from public.notifications n where n.recipient_id = '91000000-0000-0000-0000-000000000003' limit 1
on conflict (notification_id, user_id) do update set status = 'processing', locked_by = 'expired-worker', locked_at = now();
insert into public.notification_push_deliveries (id, outbox_id, notification_id, subscription_id)
select '94000000-0000-0000-0000-000000000001', o.id, o.notification_id, s.id
from public.notification_push_outbox o join public.push_subscriptions s on s.user_id = o.user_id
where o.locked_by = 'expired-worker' limit 1
on conflict (notification_id, subscription_id) do update set status = 'pending', attempt_count = 0;
insert into public.notification_push_deliveries (id, outbox_id, notification_id, subscription_id)
select '94000000-0000-0000-0000-000000000003', o.id, o.notification_id, '93500000-0000-0000-0000-000000000002'
from public.notification_push_outbox o where o.locked_by = 'expired-worker' limit 1;
select lives_ok(
  $$select public.finish_push_batch('expired-worker', '[{"delivery_id":"94000000-0000-0000-0000-000000000001","outcome":"expired","http_status":410,"error":"gone"},{"delivery_id":"94000000-0000-0000-0000-000000000003","outcome":"expired","http_status":404,"error":"not found"}]')$$,
  'worker registra 404/410 como subscription expirada'
);
select is((select count(*)::int from public.push_subscriptions where user_id = '91000000-0000-0000-0000-000000000003' and revoked_at is not null), 2, '404 e 410 revogam subscriptions');

-- Retry reutiliza a mesma delivery e termina após seis tentativas.
update public.push_subscriptions set revoked_at = null where user_id = '91000000-0000-0000-0000-000000000003';
insert into public.notifications (recipient_id, type, metadata)
values ('91000000-0000-0000-0000-000000000003', 'admin_broadcast', '{"title":"retry","body":"retry"}');
update public.notification_push_outbox set status = 'processing', locked_by = 'retry-worker', locked_at = now()
where notification_id = (select id from public.notifications where metadata->>'title' = 'retry');
insert into public.notification_push_deliveries (id, outbox_id, notification_id, subscription_id)
select '94000000-0000-0000-0000-000000000002', o.id, o.notification_id, s.id
from public.notification_push_outbox o join public.push_subscriptions s on s.user_id = o.user_id
where o.notification_id = (select id from public.notifications where metadata->>'title' = 'retry') limit 1;
select public.finish_push_batch('retry-worker', '[{"delivery_id":"94000000-0000-0000-0000-000000000002","outcome":"transient","http_status":429,"error":"rate limited"}]');
select is((select status from public.notification_push_deliveries where id = '94000000-0000-0000-0000-000000000002'), 'pending', '429 agenda retry');
select is((select count(*)::int from public.notification_push_deliveries where id = '94000000-0000-0000-0000-000000000002'), 1, 'retry não duplica delivery');
do $$
begin
  for i in 2..6 loop
    update public.notification_push_outbox set status = 'processing', locked_by = 'retry-worker', locked_at = now()
    where id = (select outbox_id from public.notification_push_deliveries where id = '94000000-0000-0000-0000-000000000002');
    perform public.finish_push_batch('retry-worker', '[{"delivery_id":"94000000-0000-0000-0000-000000000002","outcome":"transient","http_status":500,"error":"temporary"}]');
  end loop;
end $$;
select is((select status from public.notification_push_deliveries where id = '94000000-0000-0000-0000-000000000002'), 'failed', 'sexta falha encerra retries');
select is((select attempt_count from public.notification_push_deliveries where id = '94000000-0000-0000-0000-000000000002'), 6, 'limite de tentativas é seis');

insert into public.notifications (recipient_id, type, metadata) values
  ('91000000-0000-0000-0000-000000000003', 'admin_broadcast', '{"title":"claim-a","body":"x"}'),
  ('91000000-0000-0000-0000-000000000003', 'admin_broadcast', '{"title":"claim-b","body":"x"}');
create temporary table push_claim_a as select * from public.claim_push_jobs('claim-worker-a', 1);
create temporary table push_claim_b as select * from public.claim_push_jobs('claim-worker-b', 1);
select is((select count(distinct job_id)::int from push_claim_a), 1, 'primeiro worker recebe exatamente um job');
select is((select count(distinct job_id)::int from push_claim_b), 1, 'segundo worker recebe outro job');
select ok(not exists (
  select 1 from push_claim_a a join push_claim_b b on b.job_id = a.job_id
), 'dois workers não recebem o mesmo job');

select throws_ok(
  $$insert into public.notification_push_outbox (notification_id, user_id, category)
    select notification_id, user_id, category from public.notification_push_outbox limit 1$$,
  '23505', null, 'job equivalente é idempotente'
);

update public.users set account_status = 'disabled' where id = '91000000-0000-0000-0000-000000000002';
insert into public.notifications (recipient_id, type, metadata)
values ('91000000-0000-0000-0000-000000000002', 'admin_broadcast', '{"title":"x","body":"y"}');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.recipient_id = '91000000-0000-0000-0000-000000000002' and n.metadata->>'title' = 'x'), 0,
  'conta desativada não entra na outbox');

update public.users set account_status = 'deleting' where id = '91000000-0000-0000-0000-000000000002';
insert into public.notifications (recipient_id, type, metadata)
values ('91000000-0000-0000-0000-000000000002', 'admin_broadcast', '{"title":"z","body":"y"}');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.recipient_id = '91000000-0000-0000-0000-000000000002' and n.metadata->>'title' = 'z'), 0,
  'conta em exclusão não entra na outbox');

update public.push_subscriptions set revoked_at = now() where user_id = '91000000-0000-0000-0000-000000000003';
insert into public.notifications (recipient_id, type, metadata)
values ('91000000-0000-0000-0000-000000000003', 'admin_broadcast', '{"title":"revoked","body":"y"}');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.metadata->>'title' = 'revoked'), 0, 'subscription revogada não entra na outbox');

delete from auth.users where id = '91000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.push_subscriptions
  where user_id = '91000000-0000-0000-0000-000000000002'), 0,
  'exclusão da conta remove subscriptions');
select is((select count(*)::int from public.notification_push_outbox
  where user_id = '91000000-0000-0000-0000-000000000002'), 0,
  'conta excluída não mantém jobs de Push');

set local role service_role;
select ok((select count(*) > 0 from public.notification_push_outbox), 'service role acessa a outbox');
reset role;
select is((select count(*)::int from cron.job where jobname = 'process-push-outbox'), 1, 'existe um único scheduler da fila Push');

select * from finish();
rollback;
