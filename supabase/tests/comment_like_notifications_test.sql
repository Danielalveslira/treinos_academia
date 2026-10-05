-- Regra de negócio ATUAL das curtidas x notificações (travada por este teste):
--  * curtir um COMENTÁRIO de outra pessoa cria 1 notificação `comment_like` (dedupe por comentário+ator);
--  * repetir a curtida (retry) não duplica; descurtir remove a notificação; curtir de novo recria;
--  * curtir o próprio comentário não notifica;
--  * 👍/👎 em PUBLICAÇÕES (`cast_vote`) não geram notificação (não existe tipo para isso).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('86000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'like-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
from public.legal_policy p where p.id and p.published and u.id::text like '86000000-%';
insert into public.public_profiles (user_id, username)
select id, 'liker' || right(id::text, 2) from public.users where id::text like '86000000-%';
insert into public.communities (id, name, created_by, owner_id)
values ('87000000-0000-0000-0000-000000000001', 'Curtidas', '86000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id)
values ('87000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000001'),
       ('87000000-0000-0000-0000-000000000001', '86000000-0000-0000-0000-000000000002');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('88000000-0000-0000-0000-000000000001', '87000000-0000-0000-0000-000000000001',
        '86000000-0000-0000-0000-000000000001', 'text', 'Post', now() + interval '2 days');
update private.comment_rate_limits set min_interval = interval '0 seconds', burst_limit = 0 where singleton;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', '86000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.likes_for_author() returns int language sql as
  $$select count(*)::int from public.notifications where recipient_id = '86000000-0000-0000-0000-000000000001' and type = 'comment_like'$$;
create or replace function pg_temp.unread_for_author() returns int language sql as
  $$select count(*)::int from public.notifications where recipient_id = '86000000-0000-0000-0000-000000000001'
    and type = 'comment_like' and read_at is null and archived_at is null$$;

-- O autor (01) escreve um comentário; a pessoa 02 curte.
select pg_temp.as_user('01');
create temp table author_comment as select public.comment_create(
  '88000000-0000-0000-0000-000000000001', null, 'Meu comentário', '89000000-0000-0000-0000-000000000001') as row;

select pg_temp.as_user('02');
select is(pg_temp.likes_for_author(), 0, 'sem curtidas, sem notificação');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.likes_for_author(), 1, 'curtir cria 1 notificação para o autor');
select is(pg_temp.unread_for_author(), 1, 'a notificação entra como não lida');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.likes_for_author(), 1, 'retry da curtida não duplica a notificação');
select public.comment_set_like((select (row).id from author_comment), false);
select is(pg_temp.likes_for_author(), 0, 'remover a curtida remove a notificação');
select is(pg_temp.unread_for_author(), 0, 'e o contador de não lidas volta a zero');
select public.comment_set_like((select (row).id from author_comment), false);
select is(pg_temp.likes_for_author(), 0, 'retry da remoção continua sem notificação');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.likes_for_author(), 1, 'curtir novamente recria a notificação');
select is((select dedupe_key from public.notifications where type = 'comment_like' and recipient_id = '86000000-0000-0000-0000-000000000001'),
  'comment-like:' || (select (row).id::text from author_comment) || ':86000000-0000-0000-0000-000000000002',
  'dedupe_key = comentário + ator');

-- O autor curtindo o próprio comentário não gera notificação para si.
select pg_temp.as_user('01');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.likes_for_author(), 1, 'curtir o próprio comentário não notifica');

-- Votos 👍/👎 em publicações não notificam: não há tipo de notificação nem referência no cast_vote.
select ok(position('notification' in pg_get_functiondef('public.cast_vote(uuid,smallint)'::regprocedure)) = 0,
  'cast_vote não escreve em notifications');
select ok(not exists (
  select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
  where t.typname = 'notification_type' and e.enumlabel ilike '%vote%'),
  'não existe tipo de notificação para votos em publicações');

-- ===== Web Push: a curtida chega ao OUTBOX e ao claim do worker (não basta existir na tabela) =====
-- Estado limpo: o autor não tem curtidas pendentes e registra 1 dispositivo.
select pg_temp.as_user('02');
select public.comment_set_like((select (row).id from author_comment), false);
select pg_temp.as_user('01');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/author-phone', repeat('p', 32), repeat('a', 16), 'ua', 'phone', 'android');

select pg_temp.as_user('02');
select public.comment_set_like((select (row).id from author_comment), true);
create or replace function pg_temp.like_outbox() returns int language sql as
  $$select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
    where o.user_id = '86000000-0000-0000-0000-000000000001' and n.type = 'comment_like'$$;
select is(pg_temp.like_outbox(), 1, 'curtida de comentário entra na outbox de Push do autor');
select is((select o.category from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'comment_like' and o.user_id = '86000000-0000-0000-0000-000000000001'), 'social', 'categoria social');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.like_outbox(), 1, 'retry da curtida não cria outro job de Push');

create temp table like_claim as select * from public.claim_push_jobs('like-worker', 100);
select is((select count(*)::int from like_claim where notification_type = 'comment_like'), 1, 'o worker recebe a curtida para enviar (1 dispositivo)');
select is((select actor_username from like_claim where notification_type = 'comment_like'), 'liker02', 'worker recebe o autor da curtida');
select is((select action_url from like_claim where notification_type = 'comment_like'),
  '/comunidades/87000000-0000-0000-0000-000000000001/publicacoes/88000000-0000-0000-0000-000000000001/comentarios/' || (select (row).id::text from author_comment),
  'deep link aponta para o comentário curtido');
select public.finish_push_batch('like-worker', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'sent', 'http_status', 201, 'error', null)) from like_claim));
select is((select o.status from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'comment_like' and o.user_id = '86000000-0000-0000-0000-000000000001'), 'sent', 'entrega concluída como sent');

-- Descurtir remove a notificação (e a outbox/deliveries em cascata); curtir de novo gera NOVO push.
select public.comment_set_like((select (row).id from author_comment), false);
select is(pg_temp.like_outbox(), 0, 'descurtir remove também o job de Push');
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.like_outbox(), 1, 'curtir novamente gera um novo job de Push');

-- O autor sem dispositivo habilitado não recebe Push, mas continua recebendo a notificação.
select pg_temp.as_user('01');
select public.unregister_push_subscription();
select pg_temp.as_user('02');
select public.comment_set_like((select (row).id from author_comment), false);
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.likes_for_author(), 1, 'sem dispositivo: a notificação existe na Central');
select is(pg_temp.like_outbox(), 0, 'sem dispositivo: nenhum job de Push');

-- Curtir o próprio comentário não gera notificação nem Push.
select pg_temp.as_user('01');
select public.register_push_subscription('https://fcm.googleapis.com/fcm/send/author-phone', repeat('p', 32), repeat('a', 16), 'ua', 'phone', 'android');
select public.comment_set_like((select (row).id from author_comment), false);
select public.comment_set_like((select (row).id from author_comment), true);
select is(pg_temp.like_outbox(), 0, 'curtir o próprio comentário não enfileira Push');

select * from finish();
rollback;
