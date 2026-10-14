begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions,pg_temp;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('d2000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','push-direct-'||n||'@example.invalid','x',now(),'{}','{}',now(),now()
from generate_series(1,3) n;
insert into public.legal_policy(id,published,version,digest) values(true,true,'push-direct-test',repeat('d',64))
  on conflict(id) do update set published=true,version=excluded.version,digest=excluded.digest;
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and u.id::text like 'd2000000-%';

select ok(not has_function_privilege('anon','public.activate_push_subscription(text,text,text,text,text,text)','execute'),'anon não ativa');
select ok(has_function_privilege('authenticated','public.activate_push_subscription(text,text,text,text,text,text)','execute'),'authenticated ativa');
select ok(not has_function_privilege('authenticated','private.push_activation_access(uuid)','execute'),'gate não é API pública');
select ok(not has_table_privilege('authenticated','public.push_subscriptions','update'),'sem update direto de subscriptions');
select ok(not has_table_privilege('authenticated','public.push_notification_preferences','update'),'sem update direto de preferências');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.activate_push_subscription(text,text,text,text,text,text)'::regprocedure),'RPC tem SECURITY DEFINER e search_path vazio');
select throws_ok($$select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/a',repeat('p',32),repeat('a',16))$$,'NOT_AUTHENTICATED','sessão ausente rejeitada');

set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.get_my_push_status()->>'preferenceExists','false','ausência de preferência é explícita');
select throws_ok($$select public.activate_push_subscription('https://169.254.169.254/x',repeat('p',32),repeat('a',16))$$,'INVALID_SUBSCRIPTION','SSRF rejeitado');
select throws_ok($$select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/a','x','y')$$,'INVALID_SUBSCRIPTION','chaves inválidas rejeitadas');
create temp table activation as select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a',repeat('p',32),repeat('a',16)) as value;
select is((select value->'status'->>'thisDevice' from activation),'true','confirma este dispositivo');
select is((select value->'status'->>'enabled' from activation),'true','preferência habilitada');
select is((select value->>'welcome' from activation),'queued','boas-vindas solicitada');
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a',repeat('p',32),repeat('a',16))->>'welcome','already_requested','retry não reenvia');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/direct-other',repeat('q',32),repeat('b',16));
reset role;
select is((select count(*)::int from public.notifications where type='push_welcome'),1,'uma linha idempotente');
select ok((select bool_and(read_at is not null and archived_at is not null and action_url='/') from public.notifications where type='push_welcome'),'recibo arquivado não polui sino e destino é Home');
select is(public.notifications_unread_count(),0,'boas-vindas não incrementa badge');
select is((select ttl_seconds from private.notification_catalog where type='push_welcome'),600,'TTL de dez minutos');
select ok((select bool_and(target_subscription_id is not null and target_activation_at is not null and expires_at>created_at) from public.notification_push_outbox),'outbox segmentada e datada');
create temp table claim_welcome as select * from public.claim_push_jobs('direct-w1',100);
select is((select count(*)::int from claim_welcome),1,'somente um destino no claim');
select is((select endpoint from claim_welcome),'https://fcm.googleapis.com/fcm/send/direct-a','dispositivo ativado é o único destino');
select is((select notification_type from claim_welcome),'push_welcome','tipo específico');
select is((select urgency from claim_welcome),'high','urgência adequada');
select public.finish_push_batch('direct-w1',(select jsonb_agg(jsonb_build_object('delivery_id',delivery_id,'outcome','sent','http_status',201)) from claim_welcome));
select is((select count(*)::int from public.claim_push_jobs('direct-w2',100)),0,'worker repetido não reenvia');

-- Desligamento global: o clique ativa A sem despertar outro aparelho ou alterar categorias.
update public.push_notification_preferences set enabled=false,categories='{"social":false,"account":true}' where user_id='d2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.get_my_push_status()->>'preferenceExists','true','desligado difere de ausente');
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a',repeat('p',32),repeat('a',16))->>'welcome','cooldown','reativação não burla limite de 24h');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/direct-a')->>'enabled','true','clique religa conta');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/direct-other')->>'thisDevice','false','outro dispositivo continua desativado');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/direct-other')->>'registrationAllowed','false','outro dispositivo exige ação explícita');
select throws_ok($$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/direct-other',repeat('q',32),repeat('b',16))$$,'PUSH_ACTIVATION_REQUIRED','sync não ressuscita o outro dispositivo');
select is(public.get_my_push_status()->>'registrationAllowed','false','dispositivo sem endpoint não contorna a escolha anterior');
select throws_ok($$select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/new-after-global-off',repeat('q',32),repeat('b',16))$$,'PUSH_ACTIVATION_REQUIRED','trocar endpoint não ressuscita dispositivo via sync');
select ok(not has_function_privilege('authenticated','private.write_push_subscription(text,text,text,text,text,text,boolean)','execute'),'bypass explícito privado não é executável por clientes');
reset role;
select is((select categories from public.push_notification_preferences where user_id='d2000000-0000-0000-0000-000000000001'),'{"social":false,"account":true}'::jsonb,'categorias preservadas');
select ok((select activation_required and revoked_at is not null from public.push_subscriptions where endpoint like '%/direct-other'),'hold persistido no servidor');
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-other',repeat('q',32),repeat('b',16))->>'welcome','queued','outro dispositivo só reativa voluntariamente');
reset role;
select is((select count(*)::int from public.push_subscriptions where activation_required),0,'hold limpo apenas após ação própria');

-- Categoria respeitada, sucesso de ativação independente de boas-vindas.
update public.push_notification_preferences set categories='{"account":false}' where user_id='d2000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/no-category',repeat('p',32),repeat('a',16))->>'welcome','category_disabled','categoria não é religada pelo teste');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/no-category')->>'thisDevice','true','ativação continua válida');
reset role;
update public.push_notification_preferences set categories='{"account":true}' where user_id='d2000000-0000-0000-0000-000000000001';

-- Erro de enfileiramento: savepoint preserva preferência + inscrição, sem recibo órfão.
create function pg_temp.reject_push_test() returns trigger language plpgsql as $$begin raise exception 'TEST_QUEUE_FAILURE'; end$$;
create trigger reject_push_test before insert on public.notification_push_outbox for each row execute function pg_temp.reject_push_test();
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/queue-fail',repeat('p',32),repeat('a',16))->>'welcome','unavailable','erro recuperável de fila');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/queue-fail')->>'thisDevice','true','erro de fila não desfaz inscrição');
reset role;
drop trigger reject_push_test on public.notification_push_outbox;
select ok((select welcome_requested_at is null from public.push_subscriptions where endpoint like '%/queue-fail'),'falha não consome idempotência');
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/queue-fail',repeat('p',32),repeat('a',16))->>'welcome','queued','retry de fila recupera sem duplicar episódio');
reset role;

-- Sem client-selected recipient/body; endpoint de outra conta não pode ser apropriado.
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a',repeat('x',32),repeat('z',16))$$,'PUSH_ENDPOINT_IN_USE','não apropria endpoint ativo alheio');
reset role;
select is((select user_id::text from public.push_subscriptions where endpoint like '%/direct-a'),'d2000000-0000-0000-0000-000000000001','dono intacto');
select is((select count(*)::int from public.push_notification_preferences where user_id='d2000000-0000-0000-0000-000000000002'),0,'falha não cria preferência parcial');
update public.users set account_status='disabled' where id='d2000000-0000-0000-0000-000000000003';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/blocked',repeat('p',32),repeat('a',16))$$,'ACCOUNT_UNAVAILABLE','conta bloqueada não ativa');
reset role;
update public.users set legal_acceptance_version=null where id='d2000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000002',true);
select throws_ok($$select public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/legal',repeat('p',32),repeat('a',16))$$,'ACCOUNT_UNAVAILABLE','gate legal pendente não ativa');
reset role;

-- Revalidação de entrega: expiração, revogação, categorias e gate.
update public.notification_push_outbox set expires_at=now()-interval '1 second' where status='pending';
select is((select count(*)::int from public.claim_push_jobs('direct-expired',100)),0,'mensagens antigas nunca saem');
select ok(not exists(select 1 from public.notification_push_outbox where status='processing'),'nenhum job vencido preso');
update public.push_subscriptions set welcome_requested_at=now()-interval '25 hours' where endpoint like '%/direct-a';
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
select public.unregister_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a');
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/direct-a',repeat('p',32),repeat('a',16))->>'welcome','queued','novo episódio após 24h pode receber teste');
update public.users set legal_acceptance_version=null where id='d2000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.claim_push_jobs('direct-legal',100)),0,'gate revalidado no claim');
select ok(not exists(select 1 from public.notification_push_deliveries d join public.notification_push_outbox o on o.id=d.outbox_id where o.last_error='RECIPIENT_NOT_ELIGIBLE' and d.status='pending'),'entregas inelegíveis canceladas');
-- Per-account caps cannot be bypassed by rotating endpoints.
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest from public.legal_policy p where p.id and u.id='d2000000-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000002',true);
create temp table rate_results as select n, public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/rate-'||n,repeat('p',32),repeat('a',16)) as result from generate_series(1,6) n;
select is((select count(*)::int from rate_results where result->>'welcome'='queued'),5,'máximo de cinco solicitações por conta/hora');
select is((select result->>'welcome' from rate_results where n=6),'rate_limited','rotacionar endpoint não burla limite');
select is(public.get_my_push_status('https://fcm.googleapis.com/fcm/send/rate-6')->>'thisDevice','true','rate limit do teste não impede ativação');
update private.push_state set window_start=date_trunc('hour',now())-interval '1 hour' where recipient_id='d2000000-0000-0000-0000-000000000002' and key='wa:hour';
update private.push_state set hits=10 where recipient_id='d2000000-0000-0000-0000-000000000002' and key='wa:day';
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/daily-cap',repeat('p',32),repeat('a',16))->>'welcome','rate_limited','limite diário de dez independe da hora');
-- An explicit new device is still allowed when unknown endpoints require voluntary activation.
select set_config('request.jwt.claim.sub','d2000000-0000-0000-0000-000000000001',true);
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest from public.legal_policy p where p.id and u.id='d2000000-0000-0000-0000-000000000001';
select is(public.activate_push_subscription('https://fcm.googleapis.com/fcm/send/explicit-new',repeat('p',32),repeat('a',16))->'status'->>'thisDevice','true','novo endpoint ativa apenas no caminho explícito');
select * from finish();
rollback;
