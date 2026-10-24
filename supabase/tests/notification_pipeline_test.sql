\ir _helpers/auth_session.sql
-- Pipeline único: evento -> notifications -> outbox -> claim do worker (payload/URL/urgência).
-- Cobre todos os eventos que hoje geram notificação e valida os casos de borda do pipeline.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('96000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'pipe-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03']) as n;
update public.users set role = 'superadmin' where id = '96000000-0000-0000-0000-000000000003';
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
from public.legal_policy p where p.id and p.published and u.id::text like '96000000-%';
insert into public.public_profiles (user_id, username)
select id, 'pipe' || right(id::text, 2) from public.users where id::text like '96000000-%';
insert into public.communities (id, name, created_by, owner_id)
values ('97000000-0000-0000-0000-000000000001', 'Pipeline', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000002');
insert into public.community_members (community_id, user_id)
select '97000000-0000-0000-0000-000000000001', id from public.users where id::text like '96000000-%';
-- A = 01 (quem age), B = 02 (dono do conteúdo), S = 03 (superadmin)
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('98000000-0000-0000-0000-000000000001', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'text', 'Post de B', now() + interval '2 days');
insert into public.statuses (id, community_id, author_id, type, workout_title, workout_date, workout_location, expires_at)
values ('98000000-0000-0000-0000-000000000002', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'workout', 'Treino de B', now() + interval '1 day', 'Academia', now() + interval '2 days');
insert into public.statuses (id, community_id, author_id, type, achievement_day, achievement_text, expires_at)
values ('98000000-0000-0000-0000-000000000003', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'achievement', '2026-10-04', 'Conquista de B', now() + interval '2 days');
insert into public.statuses (id, community_id, author_id, type, photo_path, expires_at)
values ('98000000-0000-0000-0000-000000000004', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'photo',
  'statusPhotos/97000000-0000-0000-0000-000000000001/98000000-0000-0000-0000-000000000004.webp', now() + interval '2 days');
insert into public.statuses (id, community_id, author_id, type, poll_question, poll_options, expires_at)
values ('98000000-0000-0000-0000-000000000005', '97000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 'poll', 'Pergunta?', '["a","b"]'::jsonb, now() + interval '2 days');
update private.comment_rate_limits set min_interval = interval '0 seconds', burst_limit = 0 where singleton;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( '96000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.notes(p_type text, p_user text) returns int language sql as
  $$select count(*)::int from public.notifications where type::text = p_type and recipient_id = ('96000000-0000-0000-0000-0000000000' || p_user)::uuid$$;
create or replace function pg_temp.jobs(p_type text, p_user text) returns int language sql as
  $$select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
    where n.type::text = p_type and o.user_id = ('96000000-0000-0000-0000-0000000000' || p_user)::uuid$$;

-- Dispositivos: B tem 2 (celular + notebook), S tem 1, A nenhum.
select pg_temp.as_user('02');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/b-phone', repeat('p', 32), repeat('a', 16), 'ua', 'phone', 'android');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/b-laptop', repeat('p', 32), repeat('a', 16), 'ua', 'laptop', 'windows');
select pg_temp.as_user('03');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/s-desktop', repeat('p', 32), repeat('a', 16), 'ua', 'desktop', 'windows');

-- ===== Curtida em PUBLICAÇÃO (post_like) =====
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('98000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 1);
select is(pg_temp.notes('post_like', '02'), 1, 'A curte post de B: B recebe notification');
select is((select action_url from public.notifications where type = 'post_like'),
  '/comunidades/97000000-0000-0000-0000-000000000001#publicacao-98000000-0000-0000-0000-000000000001', 'deep link da publicação');
select is(pg_temp.jobs('post_like', '02'), 1, 'curtida entra na outbox de Push de B');
update public.status_economy_votes set value = 1 where status_id = '98000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('post_like', '02'), 1, 'retry da curtida não duplica a notification');
select is(pg_temp.jobs('post_like', '02'), 1, 'retry da curtida não duplica o job');
update public.status_economy_votes set value = -1 where status_id = '98000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('post_like', '02'), 0, 'trocar 👍 por 👎 cancela o alerta de curtida');
select is(pg_temp.jobs('post_like', '02'), 0, '…e o job de Push');
update public.status_economy_votes set value = 1 where status_id = '98000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('post_like', '02'), 1, 'voltar para 👍 recria o alerta');
update public.status_economy_votes set value = null where status_id = '98000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('post_like', '02'), 0, 'remover o voto remove o alerta');
update public.status_economy_votes set value = 1 where status_id = '98000000-0000-0000-0000-000000000001';
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('98000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000002', 1);
select is(pg_temp.notes('post_like', '02'), 1, 'curtida do próprio autor não notifica');
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('98000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 1);
select is((select action_url from public.notifications where type = 'post_like' and status_id = '98000000-0000-0000-0000-000000000002'),
  '/comunidades/97000000-0000-0000-0000-000000000001#treino-98000000-0000-0000-0000-000000000002', 'Treino Marcado usa a âncora #treino-');

-- ===== Curtida em COMENTÁRIO, comentário no post, resposta e resposta de resposta =====
select pg_temp.as_user('02');
create temp table b_comment as select public.comment_create('98000000-0000-0000-0000-000000000001', null, 'Comentário de B', '99000000-0000-0000-0000-000000000001') as row;
select is(pg_temp.notes('post_reply', '02'), 0, 'B comentando no próprio post não notifica a si');
select pg_temp.as_user('01');
select public.comment_set_like((select (row).id from b_comment), true);
select is(pg_temp.notes('comment_like', '02'), 1, 'A curte comentário de B: B recebe notification');
select is(pg_temp.jobs('comment_like', '02'), 1, 'curtida de comentário entra na outbox');
select public.comment_set_like((select (row).id from b_comment), true);
select is(pg_temp.notes('comment_like', '02'), 1, 'retry não duplica');
create temp table a_comment as select public.comment_create('98000000-0000-0000-0000-000000000001', null, 'Comentário de A', '99000000-0000-0000-0000-000000000002') as row;
select is(pg_temp.notes('post_reply', '02'), 1, 'A comenta o post de B: B recebe post_reply');
select is(pg_temp.jobs('post_reply', '02'), 1, 'post_reply entra na outbox de B');
select pg_temp.as_user('02');
create temp table b_reply as select public.comment_create('98000000-0000-0000-0000-000000000001', (select (row).id from a_comment), 'Resposta de B', '99000000-0000-0000-0000-000000000003') as row;
select is(pg_temp.notes('comment_reply', '01'), 1, 'B responde A: A recebe comment_reply');
select is(pg_temp.jobs('comment_reply', '01'), 0, 'A não tem dispositivo: notificação existe, nenhum job de Push');
select pg_temp.as_user('01');
create temp table a_reply2 as select public.comment_create('98000000-0000-0000-0000-000000000001', (select (row).id from b_reply), 'Resposta à resposta', '99000000-0000-0000-0000-000000000004') as row;
select is(pg_temp.notes('comment_reply', '02'), 1, 'A responde a resposta de B: B recebe comment_reply');
select is(pg_temp.jobs('comment_reply', '02'), 1, 'resposta de resposta entra na outbox de B');
select public.comment_create('98000000-0000-0000-0000-000000000001', (select (row).id from a_comment), 'Auto-resposta', '99000000-0000-0000-0000-000000000005');
select is(pg_temp.notes('comment_reply', '01'), 1, 'A respondendo o próprio comentário não gera alerta novo para si');

-- Qualquer tipo válido de publicação (Treino Marcado, conquista, foto, enquete) entra no mesmo pipeline.
select pg_temp.as_user('01');
select public.comment_create(('98000000-0000-0000-0000-00000000000' || n)::uuid, null, 'Comentário no tipo ' || n, ('99100000-0000-0000-0000-00000000000' || n)::uuid)
from unnest(array['2','3','4','5']) as n;
select is((select count(*)::int from public.notifications where type = 'post_reply' and recipient_id = '96000000-0000-0000-0000-000000000002'), 5,
  'comentário em post, treino, conquista, foto e enquete notifica o autor');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'post_reply'), 5,
  '…e todos entram na outbox de Push');
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('98000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 1),
       ('98000000-0000-0000-0000-000000000004', '96000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000002', 1);
select is((select count(*)::int from public.notifications where type = 'post_like' and action_url like '%#publicacao-%'), 3, 'curtida em post, conquista e foto: âncora #publicacao-');

-- ===== Economia =====
insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
values ('96000000-0000-0000-0000-000000000002', 'pipe-cash-1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'p1');
select is(pg_temp.notes('economy_credit', '02'), 1, 'pagamento confirmado gera notification econômica');
select is(pg_temp.jobs('economy_credit', '02'), 1, '…e Push');
select is((select metadata->>'amount' from public.notifications where type = 'economy_credit' and recipient_id = '96000000-0000-0000-0000-000000000002'), '25', 'valor vem da ledger confirmada');
insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
values ('96000000-0000-0000-0000-000000000002', 'pipe-vote-1', 'coin', 'credit', 1, 'vote_reward', 'status_economy_vote', 'v1'),
       ('96000000-0000-0000-0000-000000000002', 'pipe-daily-1', 'coin', 'credit', 3, 'daily_activity', 'economy_daily', 'd1'),
       ('96000000-0000-0000-0000-000000000002', 'pipe-charge-1', 'coin', 'debit', 3, 'vote_charge', 'status_economy_vote', 'v2');
select is(pg_temp.notes('economy_credit', '02'), 1, 'rotinas automáticas (recompensa de voto, diária) não geram notification');
select is(pg_temp.notes('economy_debit', '02'), 0, 'débito rotineiro (voto) não notifica');
insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
values ('96000000-0000-0000-0000-000000000002', 'pipe-admin-1', 'coin', 'credit', 10, 'admin_bonus', 'admin', 'a1'),
       ('96000000-0000-0000-0000-000000000002', 'pipe-chargeback-1', 'cash', 'debit', 5, 'chargeback', 'cash_purchase', 'c1');
select is(pg_temp.notes('economy_credit', '02'), 2, 'bônus administrativo gera notification');
select is(pg_temp.notes('economy_debit', '02'), 1, 'estorno/ajuste (débito não rotineiro) gera notification');
select throws_ok($$insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
  values ('96000000-0000-0000-0000-000000000002', 'pipe-cash-1', 'cash', 'credit', 25, 'cash_purchase_confirmed', 'cash_purchase', 'p1')$$,
  '23505', null, 'a ledger já impede replay do mesmo evento (natural_key)');
select is(pg_temp.notes('economy_credit', '02'), 2, 'sem notificação duplicada');

-- ===== Moderação =====
insert into public.notices (user_id, action, rule, reason)
values ('96000000-0000-0000-0000-000000000002', 'remove_content', 'Regra interna 4', 'MOTIVO-SECRETO-DA-MODERACAO');
select is(pg_temp.notes('moderation_notice', '02'), 1, 'aviso de moderação gera notification para o afetado');
select is(pg_temp.jobs('moderation_notice', '02'), 1, '…e Push');
select ok(position('MOTIVO-SECRETO' in (select metadata::text from public.notifications where type = 'moderation_notice')) = 0
  and position('Regra interna' in (select metadata::text from public.notifications where type = 'moderation_notice')) = 0,
  'a notification não carrega regra nem motivo');
select is((select metadata->>'action' from public.notifications where type = 'moderation_notice'), 'remove_content', 'carrega só a ação');

-- ===== Administradores (restritos a superadmin) e fechamento de denúncia =====
insert into public.support_requests (id, user_id, kind, message, category, community_id)
values ('9a000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000001', 'report', 'Conteúdo impróprio', 'fraud_or_scam', '97000000-0000-0000-0000-000000000001');
select is(pg_temp.notes('admin_report', '03'), 1, 'denúncia gera alerta administrativo para o superadmin');
select is(pg_temp.jobs('admin_report', '03'), 1, '…e Push para o superadmin');
select is(pg_temp.notes('admin_report', '01') + pg_temp.notes('admin_report', '02'), 0, 'usuários comuns não recebem alertas administrativos');
update public.support_requests set state = 'closed' where id = '9a000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('report_resolved', '01'), 1, 'quem denunciou é avisado do encerramento');
select is((select metadata::text from public.notifications where type = 'report_resolved'), '{"kind": "report"}', 'sem expor a decisão');
update public.support_requests set state = 'closed' where id = '9a000000-0000-0000-0000-000000000001';
select is(pg_temp.notes('report_resolved', '01'), 1, 'reencerrar não duplica');

-- ===== Worker: claim com payload/URL/urgência e múltiplos dispositivos =====
-- curtidas e alertas administrativos esperam uma janela de agrupamento; aqui o tempo passa
update public.notification_push_outbox set next_attempt_at = now() where status = 'pending';
create temp table claimed as select * from public.claim_push_jobs('pipe-worker', 100);
select is((select count(distinct notification_id)::int from claimed where notification_type = 'post_like'), 4, 'o claim devolve as curtidas de publicação de B (post, treino, conquista, foto)');
select is((select count(*)::int from claimed where notification_type = 'post_like' and action_url like '%#publicacao-%'), 6, 'post/conquista/foto: 3 jobs x 2 dispositivos');
select is((select count(*)::int from claimed where notification_type = 'post_reply'), 10, 'post_reply: 5 publicações entregues aos DOIS dispositivos de B');
select is((select count(distinct endpoint)::int from claimed where notification_type = 'post_reply'), 2, 'dispositivos distintos');
select is((select min(urgency) from claimed where notification_type = 'post_reply'), 'high', 'comentário/resposta usam urgência alta (acorda Android em Doze)');
select is((select min(urgency) from claimed where notification_type in ('post_like', 'comment_like')), 'normal', 'curtidas usam urgência normal');
select is((select min(ttl_seconds) from claimed), 86400, 'TTL padrão de 24h');
select is((select action_url from claimed where notification_type = 'comment_reply' limit 1),
  '/comunidades/97000000-0000-0000-0000-000000000001/publicacoes/98000000-0000-0000-0000-000000000001/comentarios/' || (select (row).id::text from a_reply2),
  'resposta: deep link exato do comentário');
select is((select count(*)::int from claimed where notification_type = 'economy_credit'), 4, 'economia: 2 notificações x 2 dispositivos');
select is((select action_url from claimed where notification_type = 'moderation_notice' limit 1), '/atendimento', 'moderação abre o Atendimento');
select is((select count(*)::int from claimed where notification_type = 'admin_report' and endpoint like '%s-desktop'), 1, 'superadmin de teste: 1 dispositivo (superadmins reais não entram na conta)');
select ok(not exists (select 1 from claimed where notification_type = 'comment_reply' and subscription_id is not null
  and endpoint like '%a-%'), 'nenhum job para quem não tem dispositivo');

-- falha em um aparelho não impede o outro; 410 revoga só o aparelho expirado
select public.finish_push_batch('pipe-worker', (
  select jsonb_agg(jsonb_build_object('delivery_id', delivery_id,
    'outcome', case when endpoint like '%b-laptop' then 'expired' else 'sent' end,
    'http_status', case when endpoint like '%b-laptop' then 410 else 201 end, 'error', null))
  from claimed));
select is((select count(*)::int from public.push_subscriptions where endpoint like '%b-laptop' and revoked_at is not null), 1, '410 revoga somente o aparelho expirado');
select is((select count(*)::int from public.push_subscriptions where endpoint like '%b-phone' and revoked_at is null), 1, 'o outro aparelho de B segue ativo');
select ok((select bool_and(o.status = 'sent') from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'post_reply' and o.user_id = '96000000-0000-0000-0000-000000000002'), 'jobs concluem como sent mesmo com um aparelho expirado');
select is((select count(*)::int from public.notification_push_outbox where status = 'processing'), 0, 'nenhum job fica em processing');

-- ===== Catálogo, isolamento de falhas, preferências e rastreio =====
update private.notification_catalog set push = false where type = 'post_like';
insert into public.status_economy_votes (status_id, user_id, author_id, value)
values ('98000000-0000-0000-0000-000000000001', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', 1);
select is((select count(*)::int from public.notifications where type = 'post_like' and actor_id = '96000000-0000-0000-0000-000000000003'), 1, 'push=false no catálogo: a notification continua existindo (Central/Realtime)');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'post_like' and n.actor_id = '96000000-0000-0000-0000-000000000003'), 0, '…mas não gera Push');
update private.notification_catalog set push = true where type = 'post_like';

update public.push_notification_preferences set categories = '{"economy": false}'::jsonb where user_id = '96000000-0000-0000-0000-000000000002';
insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason, reference_type, reference_id)
values ('96000000-0000-0000-0000-000000000002', 'pipe-pref-1', 'coin', 'credit', 7, 'admin_bonus', 'admin', 'pref');
select is((select count(*)::int from public.notifications where metadata->>'amount' = '7'), 1, 'categoria economia desligada: notification existe');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.metadata->>'amount' = '7'), 0, '…sem Push (preferência por categoria respeitada)');
update public.push_notification_preferences set categories = '{}'::jsonb where user_id = '96000000-0000-0000-0000-000000000002';

alter table public.notifications add constraint zz_force_fail check (type::text <> 'post_like') not valid;
select lives_ok($$insert into public.status_economy_votes (status_id, user_id, author_id, value)
  values ('98000000-0000-0000-0000-000000000002', '96000000-0000-0000-0000-000000000003', '96000000-0000-0000-0000-000000000002', 1)$$,
  'falha ao gerar a notification NUNCA derruba a ação principal (voto)');
alter table public.notifications drop constraint zz_force_fail;

select pg_temp.as_user('03');
set local role authenticated;
select pg_temp.set_test_user('96000000-0000-0000-0000-000000000003');
create temp table trace as select jsonb_array_elements(public.admin_push_job_trace(null, 100)) as job;
reset role;
select ok((select count(*) from trace) >= 12, 'rastreio devolve os jobs');
select ok((select bool_and(job ? 'job_id' and job ? 'notification_id' and job ? 'recipient_id' and job ? 'job_status' and job ? 'attempt_count'
  and job ? 'created_at' and job ? 'next_attempt_at' and job ? 'sent_at' and job ? 'deliveries') from trace), 'cada job traz id, notification, destinatário, status, tentativas e horários');
select ok((select bool_and(d ? 'subscription' and d ? 'provider' and d ? 'http_status' and d ? 'error' and d ? 'status')
  from trace, jsonb_array_elements(job->'deliveries') d), 'cada delivery traz dispositivo, provedor, HTTP e erro');
select ok(position('fcm/send' in (select jsonb_agg(job)::text from trace)) = 0 and position('p256dh' in (select jsonb_agg(job)::text from trace)) = 0,
  'o rastreio não expõe endpoint nem chaves');
select pg_temp.as_user('02');
set local role authenticated;
select pg_temp.set_test_user('96000000-0000-0000-0000-000000000002');
select throws_ok($$select public.admin_push_job_trace()$$, 'PERMISSION_DENIED', 'usuário comum não acessa o rastreio');
reset role;

select * from finish();
rollback;
