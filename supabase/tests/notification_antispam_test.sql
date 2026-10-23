\ir _helpers/auth_session.sql
-- Anti-spam e variação: agrupamento de rajadas, cooldown, teto por hora, variantes sem repetição
-- e alertas críticos (que a preferência por categoria não silencia).
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b3000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'spam-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05','06','07']) as n;
-- 01..04 = quem age; 05 = B (destinatária, 1 dispositivo); 06 = superadmin com dispositivo; 07 = C (2 dispositivos)
update public.users set role = 'superadmin' where id = 'b3000000-0000-0000-0000-000000000006';
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
from public.legal_policy p where p.id and p.published and u.id::text like 'b3000000-%';
insert into public.public_profiles (user_id, username) select id, 'spam' || right(id::text, 2) from public.users where id::text like 'b3000000-%';
insert into public.communities (id, name, created_by, owner_id) values ('b4000000-0000-0000-0000-000000000001', 'Spam', 'b3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000005');
insert into public.community_members (community_id, user_id) select 'b4000000-0000-0000-0000-000000000001', id from public.users where id::text like 'b3000000-%';
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
select ('b5000000-0000-0000-0000-00000000000' || n)::uuid, 'b4000000-0000-0000-0000-000000000001', 'b3000000-0000-0000-0000-000000000005', 'text', 'Post ' || n, now() + interval '2 days'
from unnest(array['1','2','3']) n;

create or replace function pg_temp.dev(p_user text, p_name text) returns void language plpgsql as $$
begin
  perform pg_temp.set_test_user( 'b3000000-0000-0000-0000-0000000000' || p_user, true);
  perform public.register_push_subscription('https://fcm.googleapis.com/fcm/send/' || p_name, repeat('p', 32), repeat('a', 16), 'ua', p_name, 'android');
  perform pg_temp.set_test_user( '', true);
end $$;
select pg_temp.dev('05', 'b-phone');
select pg_temp.dev('06', 's-desktop');
select pg_temp.dev('07', 'c-phone');
select pg_temp.dev('07', 'c-laptop');
create or replace function pg_temp.vote(p_actor text, p_post text, p_value smallint default 1) returns void language sql as $$
  insert into public.status_economy_votes (status_id, user_id, author_id, value)
  values (('b5000000-0000-0000-0000-00000000000' || p_post)::uuid, ('b3000000-0000-0000-0000-0000000000' || p_actor)::uuid, 'b3000000-0000-0000-0000-000000000005', p_value)
  on conflict (status_id, user_id) do update set value = excluded.value
$$;
create or replace function pg_temp.jobs(p_type text, p_user text default '05') returns int language sql as $$
  select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type::text = p_type and o.user_id = ('b3000000-0000-0000-0000-0000000000' || p_user)::uuid and o.status = 'pending'
$$;
create or replace function pg_temp.release() returns void language sql as $$
  update public.notification_push_outbox set next_attempt_at = now() where status = 'pending'
$$;

-- ===== Agrupamento de curtidas em rajada =====
select pg_temp.vote('01', '1');
select pg_temp.vote('02', '1');
select pg_temp.vote('03', '1');
select pg_temp.vote('04', '1');
select is((select count(*)::int from public.notifications where type = 'post_like'), 4, 'as 4 curtidas aparecem individualmente na Central');
select is(pg_temp.jobs('post_like'), 1, 'rajada de 4 curtidas na mesma publicação vira UM job de Push');
select is((select coalesced_count from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'post_like'), 4, 'o job sabe que agrupa 4');
select is((select n.actor_id::text from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'post_like'), 'b3000000-0000-0000-0000-000000000004', 'e aponta para a curtida mais recente');
select ok((select o.next_attempt_at between now() + interval '40 seconds' and now() + interval '50 seconds' from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'post_like'), 'o Push de curtida espera ~45s (janela de agrupamento)');
select is((select count(*)::int from public.claim_push_jobs('hold-worker', 100) where notification_type = 'post_like'), 0, 'dentro da janela o worker não recebe a curtida');
select pg_temp.vote('01', '2');
select is(pg_temp.jobs('post_like'), 2, 'publicações diferentes não se misturam');
select pg_temp.release();
create temp table liked as select * from public.claim_push_jobs('group-worker', 100) where notification_type = 'post_like';
select is((select count(*)::int from liked), 2, 'após a janela, 2 jobs x 1 dispositivo (nada de 5 Push)');
select is((select max(group_count) from liked), 4, 'o worker recebe o tamanho do grupo (4)');
select is((select actor_username from liked where group_count = 4), 'spam04', 'e o autor mais recente');
select is((select min(group_count) from liked), 1, 'a curtida isolada continua individual');

-- comentários/respostas NÃO são agrupados (cada um leva a um comentário diferente)
insert into public.notifications (recipient_id, actor_id, type, status_id, dedupe_key)
select 'b3000000-0000-0000-0000-000000000005', ('b3000000-0000-0000-0000-0000000000' || n)::uuid, 'comment_reply', 'b5000000-0000-0000-0000-000000000003', 'reply-' || n
from unnest(array['01','02','03']) n;
select is(pg_temp.jobs('comment_reply'), 3, 'respostas não são agrupadas: um Push por resposta, cada um com seu deep link');

-- alertas administrativos agrupam por tipo
insert into public.notifications (recipient_id, type, priority, metadata, dedupe_key)
select 'b3000000-0000-0000-0000-000000000006', 'admin_report', 'high', '{}', 'rep-' || n from generate_series(1, 3) n;
select is(pg_temp.jobs('admin_report', '06'), 1, '3 denúncias seguidas = 1 Push para o superadmin');
select is((select coalesced_count from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'admin_report'), 3, 'e o job sabe que são 3');
select is((select count(*)::int from public.notifications where type = 'admin_report'), 3, 'mas as 3 estão na fila administrativa da Central');

-- job já tentado (retry) não é reaproveitado: evitaria reenviar o que já saiu para outros aparelhos
update public.notification_push_outbox o set attempt_count = 1 where o.id = (select o2.id from public.notification_push_outbox o2 join public.notifications n on n.id = o2.notification_id where n.type = 'admin_report');
insert into public.notifications (recipient_id, type, priority, metadata, dedupe_key) values ('b3000000-0000-0000-0000-000000000006', 'admin_report', 'high', '{}', 'rep-4');
select is(pg_temp.jobs('admin_report', '06'), 2, 'job em retry não recebe novos itens (nenhum reenvio indevido)');

-- ===== Cooldown de curtir/descurtir =====
select pg_temp.vote('02', '3');
select pg_temp.vote('02', '3', null);                 -- descurtiu antes de o Push sair
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id
  where n.type = 'post_like' and n.status_id = 'b5000000-0000-0000-0000-000000000003'), 0, 'descurtir antes do Push remove o job (nada enviado)');
select pg_temp.vote('02', '3');                       -- curtiu de novo
select ok(exists (select 1 from public.notifications n join public.notification_push_outbox o on o.notification_id = n.id
  where n.type = 'post_like' and n.status_id = 'b5000000-0000-0000-0000-000000000003'), 'curtir de novo depois de descurtir SEM Push enviado ainda gera Push (cooldown liberado)');
-- Push realmente enviado -> o cooldown vale
select pg_temp.release();
create temp table sent_like as select * from public.claim_push_jobs('cool-worker', 100) where notification_type = 'post_like';
select public.finish_push_batch('cool-worker', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'sent', 'http_status', 201, 'error', null)) from sent_like));
select pg_temp.vote('02', '3', null);
select pg_temp.vote('02', '3');
select is((select count(*)::int from public.notifications where type = 'post_like' and status_id = 'b5000000-0000-0000-0000-000000000003' and actor_id = 'b3000000-0000-0000-0000-000000000002'), 1, 'toggling depois do Push: a notificação volta à Central');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.status_id = 'b5000000-0000-0000-0000-000000000003' and n.type = 'post_like'), 0, '…mas sem novo Push (cooldown de 6h do mesmo ator/publicação)');
-- tempestade: 20 ciclos curtir/descurtir de outro ator nunca produzem mais de 1 job
select pg_temp.vote('04', '3', null);
select pg_temp.vote(a, '3', case when i % 2 = 0 then null else 1::smallint end) from (select '04' as a, g as i from generate_series(1, 20) g) x;
select ok((select count(*) from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'post_like' and n.actor_id = 'b3000000-0000-0000-0000-000000000004' and n.status_id = 'b5000000-0000-0000-0000-000000000003') <= 1,
  '20 ciclos curtir/descurtir não geram tempestade (no máximo 1 job)');

-- ===== Teto por hora =====
update private.notification_catalog set hourly_cap = 3 where type = 'comment_mention';
insert into public.notifications (recipient_id, actor_id, type, status_id, dedupe_key)
select 'b3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000001', 'comment_mention', 'b5000000-0000-0000-0000-000000000002', 'mention-' || g from generate_series(1, 8) g;
select is((select count(*)::int from public.notifications where type = 'comment_mention'), 8, 'teto/hora: as 8 menções estão na Central');
select is(pg_temp.jobs('comment_mention'), 3, 'teto/hora: só 3 viram Push');
update private.notification_catalog set hourly_cap = 40 where type = 'comment_mention';

-- ===== Variantes: nunca repetem em sequência =====
insert into public.notifications (recipient_id, actor_id, type, status_id, dedupe_key)
select 'b3000000-0000-0000-0000-000000000007', 'b3000000-0000-0000-0000-000000000001', 'post_reply', 'b5000000-0000-0000-0000-000000000001', 'var-' || g from generate_series(1, 40) g;
create temp table seqs as select o.variant, row_number() over (order by o.notification_id) as n from public.notification_push_outbox o join public.notifications nn on nn.id = o.notification_id
  where nn.type = 'post_reply' and o.user_id = 'b3000000-0000-0000-0000-000000000007';
select is((select count(*)::int from seqs), 40, '40 notificações de comentário geraram 40 jobs (sem teto indevido)');
select ok(not exists (select 1 from seqs a join seqs b on b.n = a.n + 1 where (b.variant - a.variant) not in (1, 2)), 'a sequência de variantes avança sempre 1 ou 2 posições');
select ok(not exists (select 1 from seqs a join seqs b on b.n = a.n + 1, unnest(array[3, 4, 5, 6, 8, 10, 12, 20]) m where (a.variant % m) = (b.variant % m)),
  'para qualquer tamanho de catálogo >= 3 a mensagem nunca repete duas vezes seguidas');
select ok((select count(distinct variant % 8) from seqs) = 8, 'e percorre todas as variantes de um catálogo de 8');
select is((select count(*)::int from private.push_state where recipient_id = 'b3000000-0000-0000-0000-000000000007'), 1, 'o estado por destinatário é limitado: 1 linha por tipo, não um histórico');

-- ===== Variante estável em retry / reprocessamento =====
select pg_temp.release();
create temp table v1 as select * from public.claim_push_jobs('var-w1', 100) where notification_type = 'post_reply' and endpoint like '%c-phone' order by notification_id limit 3;
select public.finish_push_batch('var-w1', (select jsonb_agg(jsonb_build_object('delivery_id', delivery_id, 'outcome', 'transient', 'http_status', 503, 'error', 'down')) from v1));
update public.notification_push_deliveries set next_attempt_at = now() - interval '1 second' where status = 'pending';
update public.notification_push_outbox set next_attempt_at = now() - interval '1 second' where status = 'pending';
create temp table v2 as select * from public.claim_push_jobs('var-w2', 100) where notification_id in (select notification_id from v1) and endpoint like '%c-phone';
select ok((select count(*) from v2) >= 3 and not exists (select 1 from v1 a join v2 b on b.delivery_id = a.delivery_id where a.variant is distinct from b.variant), 'o retry usa a MESMA variante (mesma mensagem)');

-- ===== Alertas críticos x preferências =====
update public.push_notification_preferences set categories = '{"account": false, "administrative": false, "social": false}'::jsonb where user_id in ('b3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000006');
insert into public.notices (user_id, action, rule, reason) values ('b3000000-0000-0000-0000-000000000005', 'warning', 'r', 'motivo');
select is(pg_temp.jobs('moderation_notice'), 1, 'aviso de moderação (crítico) ignora a preferência por categoria');
insert into public.notifications (recipient_id, type, priority, metadata, dedupe_key) values ('b3000000-0000-0000-0000-000000000006', 'admin_restriction', 'high', '{}', 'crit-1');
select is(pg_temp.jobs('admin_restriction', '06'), 1, 'alerta administrativo crítico idem');
insert into public.notifications (recipient_id, actor_id, type, status_id, dedupe_key) values ('b3000000-0000-0000-0000-000000000005', 'b3000000-0000-0000-0000-000000000001', 'post_reply', 'b5000000-0000-0000-0000-000000000001', 'noncrit-1');
select is(pg_temp.jobs('post_reply'), 0, 'já um alerta social (não crítico) respeita a categoria desligada');
-- crítico continua valendo no claim; o interruptor GERAL ainda silencia tudo
select pg_temp.release();
select is((select count(*)::int from public.claim_push_jobs('crit-w', 100) where notification_type = 'moderation_notice'), 1, 'no envio, o crítico passa mesmo com a categoria desligada');
update public.push_notification_preferences set enabled = false where user_id = 'b3000000-0000-0000-0000-000000000005';
insert into public.notices (user_id, action, rule, reason) values ('b3000000-0000-0000-0000-000000000005', 'restore', 'r', 'motivo');
select is((select count(*)::int from public.notification_push_outbox o join public.notifications n on n.id = o.notification_id where n.type = 'moderation_notice' and o.status = 'pending'), 0, 'interruptor geral de Push desligado: nem o crítico gera job');

-- ===== Limpeza do estado efêmero =====
insert into private.push_state (recipient_id, key, last_at) values
  ('b3000000-0000-0000-0000-000000000001', 'c:antigo', now() - interval '3 days'),
  ('b3000000-0000-0000-0000-000000000001', 'c:recente', now() - interval '1 hour'),
  ('b3000000-0000-0000-0000-000000000001', 't:velho', now() - interval '40 days');
select private.cleanup_push_history();
select is((select string_agg(key, ',' order by key) from private.push_state where recipient_id = 'b3000000-0000-0000-0000-000000000001'), 'c:recente', 'limpeza remove cooldowns > 2 dias e estado > 30 dias');

select * from finish();
rollback;
