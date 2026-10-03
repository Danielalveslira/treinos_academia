begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Usuários (prefixo e1): ..01 autor/moderador  ..02 e ..03 comentaristas  ..04..08 apoiadores
-- ..09 atividade/treino  ..0a suspenso  ..0b desativado  ..0c em exclusão  ..0d teto/cenários
-- ..0e concessão parcial  ..0f teto por ação  ..10 atividade com teto cheio  ..11 cardio  ..12 termos não aceitos
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('e1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'evc-' || n || '@example.invalid', 'x', now(), '{}', '{}', now(), now()
from unnest(array['01','02','03','04','05','06','07','08','09','0a','0b','0c','0d','0e','0f','10','11','12']) as n;

-- política legal publicada: só quem aceitou tem acesso (testa o ramo de termos de user_app_access)
insert into public.legal_policy (id, version, published, digest, published_at)
  values (true, 'evc-v1', true, 'evc-digest', now())
  on conflict (id) do update set version = 'evc-v1', published = true, digest = 'evc-digest', published_at = now();
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and u.id::text like 'e1000000-%' and u.id <> 'e1000000-0000-0000-0000-000000000012'::uuid;
update public.users set account_status = 'disabled' where id = 'e1000000-0000-0000-0000-00000000000b';
update public.users set account_status = 'deleting' where id = 'e1000000-0000-0000-0000-00000000000c';
insert into public.account_restrictions (user_id, action, until)
  values ('e1000000-0000-0000-0000-00000000000a', 'temporary_suspension', now() + interval '7 days');
insert into public.public_profiles (user_id, username)
select id, 'evc' || right(id::text, 2) from public.users where id::text like 'e1000000-%';

insert into public.communities (id, name, created_by, owner_id)
values ('e2000000-0000-0000-0000-000000000001', 'EvoCoins', 'e1000000-0000-0000-0000-000000000001', 'e1000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id)
select 'e2000000-0000-0000-0000-000000000001', id from public.users
  where id::text like 'e1000000-%' and id::text not like '%000000000012';

-- limites de comentário não atrapalham o teste (now() é fixo na transação)
update private.comment_rate_limits set min_interval = interval '0 seconds', burst_limit = 0;

create or replace function pg_temp.u(p text) returns uuid language sql as
  $$select ('e1000000-0000-0000-0000-0000000000' || p)::uuid$$;
create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', ('e1000000-0000-0000-0000-0000000000' || p), true)$$;
create or replace function pg_temp.no_user() returns void language sql as
  $$select set_config('request.jwt.claim.sub', '', true)$$;
create or replace function pg_temp.coins(p text) returns int language sql as
  $$select coalesce((select coin_balance from public.wallets where user_id = pg_temp.u(p)), 0)$$;
create or replace function pg_temp.earned(p text) returns int language sql as
  $$select coalesce((select earned_total from public.economy_daily where user_id = pg_temp.u(p) and day = private.sp_today()), 0)$$;
create or replace function pg_temp.by_action(p text, a text) returns int language sql as
  $$select coalesce((select (earned_by_action ->> a)::int from public.economy_daily where user_id = pg_temp.u(p) and day = private.sp_today()), 0)$$;
create or replace function pg_temp.ledger_n(p text, k text) returns int language sql as
  $$select count(*)::int from public.economy_transactions where user_id = pg_temp.u(p) and natural_key like k$$;
create or replace function pg_temp.pending_n(p text) returns int language sql as
  $$select count(*)::int from public.economy_pending_awards where user_id = pg_temp.u(p)$$;
create or replace function pg_temp.award(p text, a text, k text) returns jsonb language sql as
  $$select private.award_evocoins(pg_temp.u(p), a, k, 'test', k)$$;
-- fixture de saldo COM ledger (wallet = ledger vale para todos os usuários do teste)
create or replace function pg_temp.seed_coins(p text, n int) returns void language plpgsql as $$
begin
  perform public._wallet_credit_coins(pg_temp.u(p), n);
  perform public._ledger_record(pg_temp.u(p), 'seed:' || p, 'coin', 'credit', n, 'test_seed', 'test', p);
end $$;
create or replace function pg_temp.make_due() returns void language sql as
  $$update public.economy_pending_awards set due_at = now() - interval '1 second'$$;
create or replace function pg_temp.settle() returns jsonb language sql as
  $$select private.settle_pending_awards()$$;

-- ============================================================ MOTOR: teto, parcial, retry
select is(pg_temp.award('0d', 'daily_activity', 'k:act') ->> 'awardedCoins', '3', 'atividade paga 3');
select is((pg_temp.award('0d', 'daily_activity', 'k:act') ->> 'awardedCoins'), '0', 'retry da mesma natural_key paga 0');
select is(pg_temp.coins('0d'), 3, 'retry não altera a carteira');
select is(pg_temp.ledger_n('0d', 'k:act'), 1, 'retry não duplica o ledger');
select is(pg_temp.award('0d', 'workout_completed', 'k:w') ->> 'awardedCoins', '2', 'treino paga 2');
select pg_temp.award('0d', 'post_published', 'k:p1');
select is((pg_temp.award('0d', 'post_published', 'k:p1') ->> 'awardedCoins') || '/' || (pg_temp.award('0d', 'post_published', 'k:p1') ->> 'reason'), '0/already_awarded', 'mesma natural_key com folga no dia: já processada, paga 0');
select is(pg_temp.ledger_n('0d', 'k:p1'), 1, 'e não duplica o ledger');
select pg_temp.award('0d', 'post_published', 'k:p2');
select is(pg_temp.award('0d', 'post_published', 'k:p3') ->> 'reason', 'action_cap_reached', 'publicação: teto de 2/dia por ação');
select pg_temp.award('0d', 'comment_posted', 'k:c1');
select pg_temp.award('0d', 'comment_posted', 'k:c2');
select is(pg_temp.award('0d', 'comment_posted', 'k:c3') ->> 'dailyEarned', '10', 'soma das cotas das ações = 10');
select is(pg_temp.award('0d', 'support_received', 'k:s1') ->> 'reason', 'daily_cap_reached', 'teto global: 10 atingido, nada mais é pago');
select is(pg_temp.earned('0d'), 10, 'dia fechado em exatamente 10');
select is(pg_temp.award('0d', 'support_received', 'k:s1'), jsonb_build_object('awardedCoins', 0, 'dailyEarned', 10, 'dailyLimit', 10, 'dailyRemaining', 0, 'reason', 'daily_cap_reached'),
          'retorno traz awardedCoins/dailyEarned/dailyLimit/dailyRemaining');

-- retorno rápido no teto: nenhuma escrita em ledger, carteira ou agregado
create temp table snap as select
  (select count(*) from public.economy_transactions where user_id = pg_temp.u('0d')) ledger_n,
  (select updated_at from public.wallets where user_id = pg_temp.u('0d')) wallet_at,
  (select updated_at from public.economy_daily where user_id = pg_temp.u('0d') and day = private.sp_today()) daily_at;
select pg_temp.award('0d', 'comment_posted', 'k:c-late');
select is((select count(*) from public.economy_transactions where user_id = pg_temp.u('0d')), (select ledger_n from snap), 'no teto: nada novo no ledger');
select is((select updated_at from public.wallets where user_id = pg_temp.u('0d')), (select wallet_at from snap), 'no teto: carteira intocada');
select is((select updated_at from public.economy_daily where user_id = pg_temp.u('0d') and day = private.sp_today()), (select daily_at from snap), 'no teto: agregado intocado');

-- gastar não devolve cota (o teto é de crédito bruto)
select public._wallet_debit_coins(pg_temp.u('0d'), 8);
select public._ledger_record(pg_temp.u('0d'), 'k:spend', 'coin', 'debit', 8, 'test_spend', 'test', 'k:spend');
select is(pg_temp.award('0d', 'support_received', 'k:s2') ->> 'awardedCoins', '0', 'depois de gastar, o teto continua cheio');
select is(pg_temp.earned('0d'), 10, 'gasto não reduz o ganho bruto do dia');

-- concessão parcial: 9 ganhos + recompensa de 3 -> concede 1
insert into public.economy_daily (user_id, day, earned_total, earned_by_action)
  values (pg_temp.u('0e'), private.sp_today(), 9, '{"post_published": 2, "comment_posted": 3, "workout_completed": 2, "support_received": 2}');
select is(pg_temp.award('0e', 'daily_activity', 'k:part') ->> 'awardedCoins', '1', '9 + recompensa de 3 concede só 1');
select is((select amount::int from public.economy_transactions where user_id = pg_temp.u('0e') and natural_key = 'k:part'), 1, 'ledger registra o valor concedido (1), não o da regra');
select is(pg_temp.earned('0e'), 10, 'parcial fecha o dia em 10');
select is(pg_temp.coins('0e'), 1, 'carteira recebe o valor concedido');

-- teto por ação (apoio recebido = 3/dia)
select pg_temp.award('0f', 'support_received', 'k:a1');
select pg_temp.award('0f', 'support_received', 'k:a2');
select pg_temp.award('0f', 'support_received', 'k:a3');
select is(pg_temp.award('0f', 'support_received', 'k:a4') ->> 'reason', 'action_cap_reached', 'apoio recebido: máximo 3/dia');
select is(pg_temp.earned('0f') || '/' || pg_temp.by_action('0f', 'support_received'), '3/3', 'agregado por ação');

-- virada do dia: o teto é por dia (SP); ontem cheio não afeta hoje
insert into public.economy_daily (user_id, day, earned_total, earned_by_action)
  values (pg_temp.u('0f'), private.sp_today() - 1, 10, '{"support_received": 3}')
  on conflict (user_id, day) do nothing;
select is(pg_temp.earned('0f'), 3, 'o agregado de hoje é independente do de ontem');
select is(pg_temp.award('09', 'daily_activity', 'k:roll') ->> 'awardedCoins', '3', 'novo dia começa do zero');
update public.economy_daily set day = private.sp_today() - 1 where user_id = pg_temp.u('09') and day = private.sp_today();
select is(pg_temp.award('09', 'daily_activity', 'k:roll2') ->> 'awardedCoins', '3', 'depois da virada, o ganho de ontem não consome a cota de hoje');
select is((select count(*)::int from public.economy_daily where user_id = pg_temp.u('09') and earned_total = 3), 2, 'uma linha por dia');
delete from public.economy_daily where user_id = pg_temp.u('09');
delete from public.economy_transactions where user_id = pg_temp.u('09');
update public.wallets set coin_balance = 0, lifetime_coins_earned = 0 where user_id = pg_temp.u('09');

-- regra desligada / conta indisponível / argumentos inválidos
update public.economy_reward_rules set enabled = false where action = 'post_published';
select is(pg_temp.award('0f', 'post_published', 'k:off') ->> 'reason', 'rule_disabled', 'regra desligada não paga');
update public.economy_reward_rules set enabled = true where action = 'post_published';
select is(pg_temp.award('0c', 'daily_activity', 'k:del') ->> 'reason', 'account_unavailable', 'conta em exclusão não recebe');
select throws_ok($$select private.award_evocoins('e1000000-0000-0000-0000-000000000001', 'inventada', 'k', 't', 't')$$, 'UNKNOWN_ACTION', 'ação desconhecida é erro de programação, não dado');
select throws_ok($$select private.award_evocoins('e1000000-0000-0000-0000-000000000001', 'daily_activity', '', 't', 't')$$, 'INVALID_ARGUMENT', 'natural_key obrigatória');

-- ============================================================ ATIVIDADE UNIFICADA
create or replace function pg_temp.ping(p text) returns jsonb language plpgsql as $$
begin
  perform pg_temp.as_user(p);
  update public.community_creation_activity_days set last_checkpoint_at = now() - interval '3 minutes'
    where user_id = pg_temp.u(p) and activity_date = private.sp_today();
  return public.register_qualified_activity();
end $$;

select pg_temp.ping('09') from generate_series(1, 5);
select is((select qualified::text || '/' || checkpoints_count from public.community_creation_activity_days where user_id = pg_temp.u('09') and activity_date = private.sp_today()),
          'true/5', '10 min válidos qualificam o dia de criação de comunidade');
select is(pg_temp.coins('09'), 0, 'a 12 min ainda não há recompensa de atividade');
select pg_temp.ping('09') from generate_series(1, 5);
select is(pg_temp.coins('09'), 0, 'com 27 min (9 intervalos de 3 min) ainda não paga');
select is((pg_temp.ping('09') ->> 'granted')::boolean, true, '30 min válidos pagam a atividade');
select is(pg_temp.coins('09'), 3, '+3 EvoCoins');
select is((select checkpoints_count from public.community_creation_activity_days where user_id = pg_temp.u('09') and activity_date = private.sp_today()), 11,
          'BUG corrigido: pings a cada 3 min não esgotam mais o teto (11 pings, antes parava em 6)');
select is(pg_temp.ping('09') ->> 'reason', 'already_granted', 'depois de paga, a atividade não paga de novo');
select is(pg_temp.coins('09'), 3, 'sem pagamento duplicado');
select ok(public.register_qualified_activity() ?& array['awardedCoins', 'dailyEarned', 'dailyLimit', 'dailyRemaining', 'dayQualified'], 'resposta traz os números do dia (o cliente não calcula)');
select is(pg_temp.by_action('09', 'daily_activity'), 3, 'atividade conta no agregado diário');
select is((select count(*)::int from public.economy_daily where user_id = pg_temp.u('09') and active_minutes <> 0), 0, 'sem segunda lógica: economy_daily não acumula minutos');

-- teto global cheio: a atividade do dia é resolvida sem pagar e sem nova tentativa
insert into public.economy_daily (user_id, day, earned_total, earned_by_action)
  values (pg_temp.u('10'), private.sp_today(), 10, '{"workout_completed": 2, "post_published": 2, "comment_posted": 3, "support_received": 3}');
insert into public.community_creation_activity_days (user_id, activity_date, qualified_seconds, qualified, checkpoints_count, last_checkpoint_at)
  values (pg_temp.u('10'), private.sp_today(), 1790, true, 9, now() - interval '3 minutes');
select pg_temp.as_user('10');
select is(public.register_qualified_activity() ->> 'reason', 'daily_cap_reached', 'teto cheio: atividade resolvida como daily_cap_reached');
select is(pg_temp.coins('10'), 0, 'nada creditado');
select is((select activity_reward_granted from public.economy_daily where user_id = pg_temp.u('10') and day = private.sp_today()), true, 'dia de atividade resolvido');

-- acesso ao app é exigido
select pg_temp.as_user('0a');
select throws_ok($$select public.register_qualified_activity()$$, 'APP_ACCESS_DENIED', 'conta suspensa não ganha atividade');
select pg_temp.as_user('0b');
select throws_ok($$select public.register_qualified_activity()$$, 'APP_ACCESS_DENIED', 'conta desativada não ganha atividade');
select pg_temp.as_user('12');
select throws_ok($$select public.register_qualified_activity()$$, 'APP_ACCESS_DENIED', 'sem aceite dos termos não ganha atividade');
select pg_temp.as_user('0c');
select throws_ok($$select public.register_qualified_activity()$$, 'A conta está em exclusão.', 'conta em exclusão recusada');
select is((select count(*)::int from public.community_creation_activity_days where user_id in (pg_temp.u('0a'), pg_temp.u('0b'), pg_temp.u('12'))), 0, 'sem acesso: nem checkpoint é gravado');

-- user_app_access (usada em cron/triggers) == has_app_access (usada com sessão)
create or replace function pg_temp.access_matches(p text) returns boolean language plpgsql as $$
begin
  perform pg_temp.as_user(p);
  return coalesce(public.has_app_access(), false) = private.user_app_access(pg_temp.u(p));
end $$;
select ok(pg_temp.access_matches('01') and pg_temp.access_matches('0a') and pg_temp.access_matches('0b')
          and pg_temp.access_matches('0c') and pg_temp.access_matches('12'), 'private.user_app_access espelha has_app_access (normal, suspenso, desativado, exclusão, sem termos)');
select is(private.user_app_access(pg_temp.u('01')), true, 'usuário normal tem acesso');
select is(private.user_app_access(pg_temp.u('12')), false, 'sem termos: sem acesso');

-- ============================================================ PUBLICAÇÕES (pendente 15 min)
select pg_temp.as_user('02');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('02'), 'text', 'Hoje treinei pernas e foi ótimo', now() + interval '1 day'),
       ('e3000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('02'), 'text', 'oi', now() + interval '1 day');
select is(pg_temp.pending_n('02'), 1, 'só a publicação válida entra na fila (curta demais não)');
select is(pg_temp.coins('02'), 0, 'nada é pago na hora');
select is((select settle->>'paid' from (select pg_temp.settle() settle) s), '0', 'antes dos 15 min nada é pago');
select pg_temp.make_due();
select is((select settle->>'paid' from (select pg_temp.settle() settle) s), '1', 'depois de 15 min a publicação válida é paga');
select is(pg_temp.coins('02'), 1, '+1 EvoCoin pela publicação');
select is(pg_temp.pending_n('02'), 0, 'pendência consumida');
select is(pg_temp.ledger_n('02', 'post:e3000000-0000-0000-0000-000000000001'), 1, 'ledger com a chave da publicação');

-- apagar antes de pagar: nada; recriar não paga o que já foi pago (mesma chave)
select pg_temp.as_user('02');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('02'), 'text', 'Publicação que será apagada antes', now() + interval '1 day');
delete from public.statuses where id = 'e3000000-0000-0000-0000-000000000003';
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('02'), 1, 'publicação apagada antes dos 15 min não paga');
select is(pg_temp.pending_n('02'), 0, 'pendência da publicação apagada descartada');
insert into public.economy_pending_awards (user_id, action, natural_key, ref_type, ref_id, due_at)
  values (pg_temp.u('02'), 'post_published', 'post:e3000000-0000-0000-0000-000000000001', 'status', 'e3000000-0000-0000-0000-000000000001', now() - interval '1 second');
select pg_temp.settle();
select is(pg_temp.coins('02'), 1, 'mesma publicação reprocessada não paga de novo');
-- 2ª e 3ª publicações válidas: teto da ação (2/dia) vale; a 3ª nem entra na fila
select pg_temp.as_user('02');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('02'), 'text', 'Segunda publicação do dia com conteúdo', now() + interval '1 day');
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('02'), 2, '2ª publicação paga');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000005', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('02'), 'text', 'Terceira publicação do dia com conteúdo', now() + interval '1 day');
select is(pg_temp.pending_n('02'), 0, 'sem folga na ação: a 3ª publicação nem é enfileirada');

-- seed/serviço (sem sessão do autor) e inserção em nome de outro não geram recompensa
select pg_temp.no_user();
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000006', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('03'), 'text', 'Publicação criada por seed sem sessão', now() + interval '1 day');
select pg_temp.as_user('01');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000007', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('03'), 'text', 'Publicação em nome de outra pessoa', now() + interval '1 day');
select is(pg_temp.pending_n('03') + pg_temp.pending_n('01'), 0, 'só escrita do próprio autor logado gera recompensa');

-- usuário perde o acesso antes dos 15 min: não paga
select pg_temp.as_user('04');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000008', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('04'), 'text', 'Publicação de quem será suspenso', now() + interval '1 day');
select is(pg_temp.pending_n('04'), 1, 'publicação de 04 enfileirada');
insert into public.account_restrictions (user_id, action, until) values (pg_temp.u('04'), 'temporary_suspension', now() + interval '3 days');
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('04'), 0, 'conta que perdeu o acesso antes dos 15 min não recebe');
delete from public.account_restrictions where user_id = pg_temp.u('04');
-- comunidade desativada antes dos 15 min
select pg_temp.as_user('05');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-000000000009', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('05'), 'text', 'Publicação em comunidade que será desativada', now() + interval '1 day');
update public.communities set is_active = false where id = 'e2000000-0000-0000-0000-000000000001';
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('05'), 0, 'comunidade indisponível: sem recompensa');
update public.communities set is_active = true where id = 'e2000000-0000-0000-0000-000000000001';

-- o gatilho também funciona com a role real do cliente (RLS de statuses + gatilho security definer)
set local role authenticated;
select pg_temp.as_user('07');
insert into public.statuses (id, community_id, author_id, type, text)
values ('e3000000-0000-0000-0000-00000000000b', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('07'), 'text', 'Publicação criada com a role do cliente');
reset role;
select is(pg_temp.pending_n('07'), 1, 'insert real de cliente (role authenticated) enfileira a recompensa');
select is((select retention_mode || '|' || (expires_at is not null) from public.statuses where id = 'e3000000-0000-0000-0000-00000000000b'), '24h|true', 'e o gatilho de retenção continua convivendo com o de recompensa');

-- virada do dia: pendência criada ontem e liquidada hoje conta no dia do CRÉDITO (hoje)
select pg_temp.as_user('06');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e3000000-0000-0000-0000-00000000000a', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('06'), 'text', 'Publicação criada ontem e paga hoje', now() + interval '1 day');
update public.economy_pending_awards set created_at = now() - interval '1 day', due_at = now() - interval '23 hours' where user_id = pg_temp.u('06');
select pg_temp.settle();
select is(pg_temp.by_action('06', 'post_published'), 1, 'pendência de ontem paga hoje entra no agregado de HOJE');
select is((select count(*)::int from public.economy_daily where user_id = pg_temp.u('06') and day = private.sp_today() - 1), 0, 'nada gravado no dia anterior');

-- ============================================================ COMENTÁRIOS (pendente 15 min)
select pg_temp.as_user('01');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e4000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('01'), 'text', 'Publicação do autor um para receber comentários', now() + interval '1 day'),
       ('e4000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('01'), 'text', 'Outra publicação do autor um para comentários', now() + interval '1 day'),
       ('e4000000-0000-0000-0000-000000000003', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('01'), 'text', 'Terceira publicação do autor um para comentários', now() + interval '1 day');
delete from public.economy_pending_awards where user_id = pg_temp.u('01');

select pg_temp.as_user('03');
select public.comment_create('e4000000-0000-0000-0000-000000000001', null, 'Comentário válido e com bastante conteúdo', 'e5000000-0000-0000-0000-000000000001');
select is(pg_temp.pending_n('03'), 1, 'comentário válido em publicação de outra pessoa entra na fila');
select is(pg_temp.coins('03'), 0, 'comentário não paga na hora');
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('03'), 1, 'comentário válido paga depois dos 15 min');
select is(pg_temp.ledger_n('03', 'comment:e4000000-0000-0000-0000-000000000001'), 1, 'chave por usuário+publicação');

-- excluir e recriar na mesma publicação: não paga de novo
select pg_temp.as_user('03');
select public.comment_delete((select id from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000001'));
select public.comment_create('e4000000-0000-0000-0000-000000000001', null, 'Comentário recriado depois de apagar o outro', 'e5000000-0000-0000-0000-000000000002');
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('03'), 1, 'excluir e recriar o comentário na mesma publicação não paga de novo');
select is(pg_temp.ledger_n('03', 'comment:e4000000-0000-0000-0000-000000000001'), 1, 'continua uma única linha no ledger');

-- excluído antes dos 15 min (autor): nada
select public.comment_create('e4000000-0000-0000-0000-000000000002', null, 'Comentário que será apagado antes dos quinze minutos', 'e5000000-0000-0000-0000-000000000003');
select public.comment_delete((select id from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000003'));
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('03'), 1, 'comentário apagado antes dos 15 min não paga');

-- removido pela moderação antes dos 15 min: nada
select public.comment_create('e4000000-0000-0000-0000-000000000003', null, 'Comentário que a moderação vai remover logo', 'e5000000-0000-0000-0000-000000000004');
select pg_temp.as_user('01');
select public.comment_delete((select id from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000004'));
select is((select status::text from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000004'), 'removed_by_moderation', 'moderador removeu');
select pg_temp.make_due();
select pg_temp.settle();
select is(pg_temp.coins('03'), 1, 'conteúdo removido antes dos 15 min não paga');

-- auto-interação: comentário em publicação própria e resposta a si mesmo
select pg_temp.as_user('03');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e4000000-0000-0000-0000-000000000004', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('03'), 'text', 'Publicação do terceiro usuário para teste', now() + interval '1 day');
delete from public.economy_pending_awards where user_id = pg_temp.u('03');
select public.comment_create('e4000000-0000-0000-0000-000000000004', null, 'Comentando na minha própria publicação aqui', 'e5000000-0000-0000-0000-000000000005');
select is(pg_temp.pending_n('03'), 0, 'comentário na própria publicação não é elegível');
select pg_temp.as_user('02');
select public.comment_create('e4000000-0000-0000-0000-000000000004', null, 'Comentário de outra pessoa na publicação do terceiro', 'e5000000-0000-0000-0000-000000000006');
select pg_temp.as_user('03');
-- resposta a si mesmo (em publicação de terceiro): 03 já tem comentário em e4..01 (apagado/recriado) -> usa publicação 02
select public.comment_create('e4000000-0000-0000-0000-000000000002', null, 'Comentário raiz do terceiro usuário na publicação dois', 'e5000000-0000-0000-0000-000000000007');
delete from public.economy_pending_awards where user_id = pg_temp.u('03');
select public.comment_create('e4000000-0000-0000-0000-000000000002',
  (select id from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000007'),
  'Respondendo ao meu próprio comentário aqui mesmo', 'e5000000-0000-0000-0000-000000000008');
select is(pg_temp.pending_n('03'), 0, 'resposta a si mesmo não é elegível');
-- resposta a comentário de outra pessoa (mesmo na publicação própria) é elegível
select public.comment_create('e4000000-0000-0000-0000-000000000004',
  (select id from public.post_comments where client_request_id = 'e5000000-0000-0000-0000-000000000006'),
  'Respondendo o comentário de outra pessoa com conteúdo', 'e5000000-0000-0000-0000-000000000009');
select is(pg_temp.pending_n('03'), 1, 'resposta a comentário de outra pessoa é elegível');
delete from public.economy_pending_awards where user_id = pg_temp.u('03');

-- conteúdo mínimo e edição
select pg_temp.as_user('02');
delete from public.economy_pending_awards where user_id = pg_temp.u('02');
select public.comment_create('e4000000-0000-0000-0000-000000000001', null, 'oi tudo bem', 'e5000000-0000-0000-0000-00000000000a');
select is(pg_temp.pending_n('02'), 0, 'comentário curto demais não é elegível');
select public.comment_edit(c.id, 'Agora o comentário ficou longo e cheio de conteúdo', c.updated_at)
  from public.post_comments c where c.client_request_id = 'e5000000-0000-0000-0000-00000000000a';
select is(pg_temp.pending_n('02'), 0, 'editar não enfileira recompensa (curto -> longo não paga)');
select pg_temp.make_due(); select pg_temp.settle();
select is(pg_temp.ledger_n('02', 'comment:%'), 0, 'comentário editado para ficar válido não é pago');
-- válido -> editado para curto antes dos 15 min
select public.comment_create('e4000000-0000-0000-0000-000000000002', null, 'Comentário válido que será esvaziado depois', 'e5000000-0000-0000-0000-00000000000b');
select is(pg_temp.pending_n('02'), 1, 'comentário válido enfileirado');
select public.comment_edit(c.id, 'ok', c.updated_at) from public.post_comments c where c.client_request_id = 'e5000000-0000-0000-0000-00000000000b';
select pg_temp.make_due(); select pg_temp.settle();
select is(pg_temp.ledger_n('02', 'comment:%'), 0, 'editado para curto antes dos 15 min: não paga');
-- válido -> editado (continua válido): paga uma vez, o conteúdo atual é o que vale
select public.comment_create('e4000000-0000-0000-0000-000000000003', null, 'Primeira versão do comentário com conteúdo', 'e5000000-0000-0000-0000-00000000000c');
select public.comment_edit(c.id, 'Segunda versão do comentário também com conteúdo', c.updated_at) from public.post_comments c where c.client_request_id = 'e5000000-0000-0000-0000-00000000000c';
select pg_temp.make_due(); select pg_temp.settle();
select is(pg_temp.ledger_n('02', 'comment:e4000000-0000-0000-0000-000000000003'), 1, 'edição não duplica: uma única recompensa');
-- teto de comentários 3/dia
select public.comment_create('e4000000-0000-0000-0000-000000000004', null, 'Comentário numero dois do teto diário aqui', 'e5000000-0000-0000-0000-00000000000d');
select public.comment_create('e4000000-0000-0000-0000-000000000001', null, 'Comentário numero tres do teto diário aqui', 'e5000000-0000-0000-0000-00000000000e');
select pg_temp.make_due(); select pg_temp.settle();
select is(pg_temp.by_action('02', 'comment_posted'), 3, 'comentários: máximo 3 por dia');
select public.comment_create('e4000000-0000-0000-0000-000000000002', null, 'Quarto comentário não gera mais recompensa', 'e5000000-0000-0000-0000-00000000000f');
select is(pg_temp.pending_n('02'), 0, 'sem folga: o 4º comentário não é enfileirado');

-- ============================================================ APOIO RECEBIDO (<= 3/dia, dia do crédito)
select pg_temp.seed_coins(n, 50) from unnest(array['04','05','06','07','08','03']) n;
select pg_temp.as_user('01');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e6000000-0000-0000-0000-000000000001', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('01'), 'text', 'Publicação que vai receber vários apoios', now() + interval '1 day');
select pg_temp.as_user(n) || public.cast_vote('e6000000-0000-0000-0000-000000000001', 1::smallint)::text from unnest(array['04','05','06','07','08']) n;
update public.status_economy_votes set reward_day_key = private.sp_today() - 1 where status_id = 'e6000000-0000-0000-0000-000000000001';
select is(public.settle_vote_rewards() ->> 'processed', '3', 'apoio recebido: só 3 dos 5 apoios pagam por dia');
select is(pg_temp.by_action('01', 'support_received'), 3, 'agregado: 3 de apoio recebido');
select is((select count(*)::int from public.status_economy_votes where status_id = 'e6000000-0000-0000-0000-000000000001' and reward_state = 'processed'), 3, '3 votos processados');
select is((select count(*)::int from public.status_economy_votes where status_id = 'e6000000-0000-0000-0000-000000000001' and reward_state = 'capped'), 2, '2 votos barrados (estado final)');
select is((select count(*)::int from public.status_economy_reward_daily where status_id = 'e6000000-0000-0000-0000-000000000001' and day = private.sp_today()), 1,
          'o dia dos limites é o do CRÉDITO (hoje), não o do voto (ontem)');
select is((select count(*)::int from public.status_economy_reward_daily where status_id = 'e6000000-0000-0000-0000-000000000001' and day = private.sp_today() - 1), 0, 'nada contado no dia do voto');
select is(public.settle_vote_rewards() ->> 'processed', '0', 'rodar de novo não paga de novo');
select is(pg_temp.coins('01'), 3, 'autor recebeu exatamente 3');
-- autor com o dia cheio: apoio vira capped sem crédito (o votante já pagou o custo do apoio)
select pg_temp.as_user('0d');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('e6000000-0000-0000-0000-000000000002', 'e2000000-0000-0000-0000-000000000001', pg_temp.u('0d'), 'text', 'Publicação de quem já está no teto', now() + interval '1 day');
select pg_temp.as_user('04'); select public.cast_vote('e6000000-0000-0000-0000-000000000002', 1::smallint);
select public.settle_vote_rewards();
select is((select reward_state from public.status_economy_votes where status_id = 'e6000000-0000-0000-0000-000000000002' and user_id = pg_temp.u('04')), 'capped', 'autor no teto: apoio capped');
select is(pg_temp.earned('0d'), 10, 'teto do autor intacto');


-- ============================================================ TREINO (marcador server-side)
insert into public.exercises (id, user_id, name, muscle_group)
select ('e7000000-0000-0000-0000-0000000000' || n)::uuid, pg_temp.u(u), 'Exercício ' || n, 'Peito'
from (values ('01','09'),('02','09'),('03','09'),('04','09'),('05','09'),('06','11'),('07','11'),('08','0a')) v(n, u);
create or replace function pg_temp.sp_today_sql() returns date language sql as
  $$select (now() at time zone 'America/Sao_Paulo')::date$$;
create or replace function pg_temp.lift(p text, ex text, d date, ts timestamptz default now()) returns void language plpgsql as $$
begin
  perform pg_temp.as_user(p);
  insert into public.workouts (user_id, exercise_id, set_details, sets, date, created_at)
  values (pg_temp.u(p), ('e7000000-0000-0000-0000-0000000000' || ex)::uuid, '[{"weight":10,"reps":10}]'::jsonb, 1, d, ts);
end $$;

-- created_at é do servidor mesmo que o cliente envie outro valor (RLS de cliente)
set local role authenticated;
select pg_temp.lift('09', '01', pg_temp.sp_today_sql(), now() - interval '10 days');
reset role;
select is((select created_at = now() from public.workouts where user_id = pg_temp.u('09')), true, 'created_at enviado pelo cliente é ignorado: vale o relógio do servidor');
-- sem sessão de usuário (import/seed) o carimbo informado é preservado
select pg_temp.no_user();
insert into public.workouts (user_id, exercise_id, set_details, sets, date, created_at)
values (pg_temp.u('09'), 'e7000000-0000-0000-0000-000000000005', '[{"weight":5,"reps":5}]', 1, pg_temp.sp_today_sql() - 40, now() - interval '40 days');
select is((select count(*)::int from public.workouts where user_id = pg_temp.u('09') and created_at < now() - interval '30 days'), 1, 'import/seed sem sessão mantém o próprio created_at');
delete from public.workouts where user_id = pg_temp.u('09') and created_at < now() - interval '30 days';

-- 1 exercício hoje: esforço insuficiente; 2: ainda; 3: paga
select pg_temp.as_user('09');
select is(public.complete_workout_session() ->> 'reason', 'not_enough_activity', '1 exercício: treino não concluído');
select pg_temp.lift('09', '02', pg_temp.sp_today_sql());
select is((public.complete_workout_session() ->> 'awardedCoins')::int, 0, '2 exercícios: ainda não');
select pg_temp.lift('09', '03', pg_temp.sp_today_sql());
select is((public.complete_workout_session() ->> 'awardedCoins')::int, 2, '3 exercícios hoje: treino concluído, +2');
select is(pg_temp.coins('09'), 5, 'carteira: 3 da atividade + 2 do treino');
select is(public.complete_workout_session() ->> 'reason', 'action_cap_reached', 'segunda conclusão no mesmo dia não paga');
select is(pg_temp.coins('09'), 5, 'sem pagamento duplicado');
select ok(public.complete_workout_session() ?& array['awardedCoins', 'dailyEarned', 'dailyLimit', 'dailyRemaining'], 'resposta traz os números do dia');
select is(pg_temp.ledger_n('09', 'workout:%'), 1, 'uma linha de ledger por dia');

-- data do cliente não é prova: registrar treinos de dias passados hoje não conta
select pg_temp.lift('11', '06', pg_temp.sp_today_sql() - 3);
select pg_temp.lift('11', '06', pg_temp.sp_today_sql() - 4);
select pg_temp.lift('11', '07', pg_temp.sp_today_sql() - 5);
select pg_temp.as_user('11');
select is(public.complete_workout_session() ->> 'reason', 'not_enough_activity', 'treinos retroativos (data de outro dia) não pagam');
-- data futura também não
select pg_temp.lift('11', '07', pg_temp.sp_today_sql() + 2);
select is(public.complete_workout_session() ->> 'reason', 'not_enough_activity', 'treino com data futura não conta');
-- cardio curto vale pouco; cardio >= 15 min vale por si
insert into public.workouts (user_id, exercise_id, type, duration_minutes, date)
values (pg_temp.u('11'), 'e7000000-0000-0000-0000-000000000006', 'cardio', 10, pg_temp.sp_today_sql());
select is(public.complete_workout_session() ->> 'reason', 'not_enough_activity', 'cardio de 10 min sozinho não conclui');
insert into public.workouts (user_id, exercise_id, type, duration_minutes, date)
values (pg_temp.u('11'), 'e7000000-0000-0000-0000-000000000007', 'cardio', 20, pg_temp.sp_today_sql());
select is((public.complete_workout_session() ->> 'awardedCoins')::int, 2, 'cardio de 20 min conclui o treino');
-- sem acesso / sem sessão
select pg_temp.lift('0a', '08', pg_temp.sp_today_sql());
select pg_temp.as_user('0a');
select throws_ok($$select public.complete_workout_session()$$, 'APP_ACCESS_DENIED', 'conta suspensa não conclui treino');
select pg_temp.no_user();
select throws_ok($$select public.complete_workout_session()$$, 'NOT_AUTHENTICATED', 'sem sessão: recusado');

-- ============================================================ SEGURANÇA (cliente)
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'private' and p.proname in ('award_evocoins', 'evocoins_headroom', 'evocoins_day_snapshot', 'enqueue_pending_award',
                  'settle_pending_awards', 'pending_award_is_valid', 'comment_is_rewardable', 'community_usable_by', 'user_app_access', 'post_is_rewardable',
                  'is_meaningful_text', 'sp_today', '_award_result', 'statuses_enqueue_award', 'post_comments_enqueue_award', 'workouts_server_created_at')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0,
          'nenhuma função interna da economia é executável pelo cliente');
select ok(not has_function_privilege('authenticated', 'private.award_evocoins(uuid,text,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'private.award_evocoins(uuid,text,text,text,text)', 'execute'), 'award_evocoins sem EXECUTE para o cliente');
select ok(not has_function_privilege('authenticated', 'private.settle_pending_awards()', 'execute')
      and not has_function_privilege('authenticated', 'private.enqueue_pending_award(uuid,text,text,text,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.evocoins_headroom(uuid,text)', 'execute')
      and not has_function_privilege('authenticated', 'private.pending_award_is_valid(uuid,text,uuid)', 'execute'), 'demais funções internas sem EXECUTE');
select ok(not has_function_privilege('authenticated', 'public.settle_vote_rewards()', 'execute')
      and not has_function_privilege('authenticated', 'public._wallet_credit_coins(uuid,numeric)', 'execute')
      and not has_function_privilege('authenticated', 'public._ledger_record(uuid,text,text,text,numeric,text,text,text)', 'execute'), 'crédito e settle antigos seguem fechados');
select ok(has_function_privilege('authenticated', 'public.complete_workout_session()', 'execute')
      and has_function_privilege('authenticated', 'public.get_my_evocoin_day()', 'execute')
      and not has_function_privilege('anon', 'public.complete_workout_session()', 'execute')
      and not has_function_privilege('anon', 'public.get_my_evocoin_day()', 'execute')
      and not has_function_privilege('anon', 'public.register_qualified_activity()', 'execute')
      and not has_function_privilege('anon', 'public.cast_vote(uuid,smallint)', 'execute')
      and not has_function_privilege('anon', 'public.get_my_wallet()', 'execute'), 'RPCs públicas: só authenticated');
set local role authenticated;
select pg_temp.as_user('01');
select throws_ok($$update public.wallets set coin_balance = 999 where user_id = 'e1000000-0000-0000-0000-000000000001'$$, '42501', null, 'cliente não escreve na carteira');
select throws_ok($$insert into public.wallets (user_id, coin_balance) values ('e1000000-0000-0000-0000-000000000001', 5)$$, '42501', null, 'cliente não cria carteira');
select throws_ok($$insert into public.economy_transactions (user_id, natural_key, asset, direction, amount, reason) values ('e1000000-0000-0000-0000-000000000001', 'hack', 'coin', 'credit', 99, 'x')$$, '42501', null, 'cliente não escreve no ledger');
select throws_ok($$update public.economy_daily set earned_total = 0 where user_id = 'e1000000-0000-0000-0000-000000000001'$$, '42501', null, 'cliente não zera o agregado diário');
select throws_ok($$insert into public.economy_pending_awards (user_id, action, natural_key, ref_type, ref_id, due_at) values ('e1000000-0000-0000-0000-000000000001', 'post_published', 'hack', 'status', gen_random_uuid(), now())$$, '42501', null, 'cliente não cria recompensa pendente');
select throws_ok($$select * from public.economy_pending_awards$$, '42501', null, 'cliente não lê pendências');
select throws_ok($$select * from public.economy_reward_rules$$, '42501', null, 'cliente não lê as regras (valores/tetos por ação)');
select throws_ok($$select * from public.economy_reward_settings$$, '42501', null, 'cliente não lê as configurações');
select throws_ok($$select private.award_evocoins('e1000000-0000-0000-0000-000000000001', 'daily_activity', 'hack', 't', 't')$$, '42501', null, 'cliente não chama o motor de crédito');
select ok((select count(*) from public.wallets where user_id = 'e1000000-0000-0000-0000-000000000001') = 1, 'cliente lê a própria carteira');
select is((select array_agg(k order by k) from jsonb_object_keys(public.get_my_evocoin_day()) k), array['dailyEarned', 'dailyLimit', 'dailyRemaining', 'day'], 'get_my_evocoin_day expõe só os números do dia (nenhuma regra interna)');
reset role;
select throws_ok($$update public.economy_reward_settings set daily_cap = 11$$, '23514', null, 'o teto global não pode passar de 10');
select throws_ok($$update public.economy_reward_rules set daily_max = 11 where action = 'daily_activity'$$, '23514', null, 'teto por ação limitado a 10');
select throws_ok($$update public.economy_daily set earned_total = 11 where user_id = 'e1000000-0000-0000-0000-000000000001'$$, '23514', null, 'o agregado nunca passa de 10');
select throws_ok($$update public.wallets set coin_balance = -1 where user_id = 'e1000000-0000-0000-0000-000000000001'$$, '23514', null, 'CHECK: saldo de EvoCoins nunca negativo');
select throws_ok($$select public._wallet_credit_coins('e1000000-0000-0000-0000-0000000000ff', 1)$$, 'ACCOUNT_NOT_FOUND', 'crédito para conta inexistente falha explicitamente');

-- ============================================================ wallet = ledger (todos os usuários do teste)
select is((select count(*)::int from public.wallets w
            where w.user_id::text like 'e1000000-%'
              and w.coin_balance <> coalesce((select sum(case t.direction when 'credit' then t.amount else -t.amount end)
                                                from public.economy_transactions t where t.user_id = w.user_id and t.asset = 'coin'), 0)),
          0, 'saldo da carteira == soma do ledger para todos');
select is((select count(*)::int from public.wallets w
            where w.user_id::text like 'e1000000-%'
              and w.lifetime_coins_earned <> coalesce((select sum(t.amount) from public.economy_transactions t
                                                        where t.user_id = w.user_id and t.asset = 'coin' and t.direction = 'credit'), 0)),
          0, 'reputação (lifetime) == soma dos créditos do ledger');
select is((select count(*)::int from public.economy_daily d
            where d.user_id::text like 'e1000000-%' and d.day = private.sp_today()
              and d.earned_total > 10), 0, 'ninguém passou de 10 no dia');
select is((select count(*)::int from public.economy_daily d
            where d.user_id::text like 'e1000000-%' and d.day = private.sp_today()
              and d.user_id not in (pg_temp.u('0e'), pg_temp.u('10'))  -- fixtures com agregado pré-carregado sem ledger
              and d.earned_total <> (select coalesce(sum(t.amount), 0) from public.economy_transactions t
                                      where t.user_id = d.user_id and t.asset = 'coin' and t.direction = 'credit'
                                        and t.reason <> 'test_seed'
                                        and (t.created_at at time zone 'America/Sao_Paulo')::date = d.day)), 0,
          'agregado do dia == créditos promocionais do ledger do dia');

select * from finish();
rollback;
