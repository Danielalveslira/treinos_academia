begin;
select no_plan();

-- ..01 autor  ..02..06 membros votantes  ..07 não-membro  ..08 superadmin
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('68000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-support@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05','06','07','08']) as n;
update public.users set role = 'superadmin' where id = '68000000-0000-0000-0000-000000000008';
insert into public.public_profiles (user_id, username)
select id, 'apoiador' || right(id::text, 2) from public.users where id::text like '68000000-%';

insert into public.communities (id, name, created_by)
values ('69000000-0000-0000-0000-000000000001', 'Comunidade de teste de apoio', '68000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id)
select '69000000-0000-0000-0000-000000000001', ('68000000-0000-0000-0000-0000000000' || n)::uuid
  from unnest(array['01','02','03','04','05','06']) as n;
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('6a000000-0000-0000-0000-000000000001', '69000000-0000-0000-0000-000000000001',
        '68000000-0000-0000-0000-000000000001', 'text', 'publicação de teste', now() + interval '2 days');
-- saldo de EvoCoins suficiente para votar (custo/dia vêm de economy_config; fallback 3 coins / 10 votos)
select public._wallet_credit_coins(('68000000-0000-0000-0000-0000000000' || n)::uuid, 100)
  from unnest(array['02','03','04','05','06']) as n;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select set_config('request.jwt.claim.sub', '68000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.counts() returns text language sql as
  $$select positive_vote_count || '/' || negative_vote_count from public.statuses where id = '6a000000-0000-0000-0000-000000000001'$$;
create or replace function pg_temp.myvote(p text) returns smallint language sql as
  $$select value from public.status_economy_votes where status_id = '6a000000-0000-0000-0000-000000000001' and user_id = ('68000000-0000-0000-0000-0000000000' || p)::uuid$$;

-- === apoiar / não apoiar / alternar / remover ===
select pg_temp.as_user('02');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint) ->> 'action'), 'create', 'apoiar cria a reação');
select is(pg_temp.counts(), '1/0', 'contador: 1 apoio');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint) ->> 'action'), 'noop', 'apoiar de novo (retry) não duplica');
select is(pg_temp.counts(), '1/0', 'retry não altera contador');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', (-1)::smallint) ->> 'action'), 'switch', 'trocar apoiar -> não apoiar');
select is(pg_temp.counts(), '0/1', 'contadores após trocar: 0 apoios / 1 não apoio');
select is(pg_temp.myvote('02'), (-1)::smallint, 'usuário tem UMA reação (não apoiar)');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint) ->> 'action'), 'switch', 'trocar não apoiar -> apoiar');
select is(pg_temp.counts(), '1/0', 'contadores após trocar de volta: 1/0');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', null::smallint) ->> 'action'), 'remove', 'remover reação');
select is(pg_temp.counts(), '0/0', 'contadores zerados após remover (nunca negativos)');
select is((public.cast_vote('6a000000-0000-0000-0000-000000000001', null::smallint) ->> 'action'), 'noop', 'remover de novo é noop');
select is(pg_temp.counts(), '0/0', 'remover duas vezes não deixa negativo');
select is((select count(*)::int from public.status_economy_votes where status_id = '6a000000-0000-0000-0000-000000000001' and user_id = '68000000-0000-0000-0000-000000000002'), 1, 'UNIQUE(status, user): continua uma única linha por usuário');
select is((select count(*)::int from public.economy_transactions where user_id = '68000000-0000-0000-0000-000000000002' and natural_key = 'vote:6a000000-0000-0000-0000-000000000001:charge'), 1, 'cobrança do voto registrada uma única vez apesar de trocas/retries');
select throws_ok($$insert into public.status_economy_votes (status_id, user_id, author_id, value) values ('6a000000-0000-0000-0000-000000000001', '68000000-0000-0000-0000-000000000002', '68000000-0000-0000-0000-000000000001', -1)$$, '23505', null, 'constraint impede segunda linha (apoiar e não apoiar simultâneos)');
select throws_ok($$update public.statuses set positive_vote_count = -1 where id = '6a000000-0000-0000-0000-000000000001'$$, '23514', null, 'CHECK: contador nunca negativo');
select pg_temp.as_user('01');
select throws_ok($$select public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint)$$, 'SELF_VOTE', 'autor não reage à própria publicação');

-- === votos: 02,03,04,05 apoiam (horários distintos); 06 não apoia ===
select pg_temp.as_user('02'); select public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint);
select pg_temp.as_user('03'); select public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint);
select pg_temp.as_user('04'); select public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint);
select pg_temp.as_user('05'); select public.cast_vote('6a000000-0000-0000-0000-000000000001', 1::smallint);
select pg_temp.as_user('06'); select public.cast_vote('6a000000-0000-0000-0000-000000000001', (-1)::smallint);
select is(pg_temp.counts(), '4/1', 'contadores: 4 apoios / 1 não apoio');
-- horários determinísticos (mais recente = 05)
update public.status_economy_votes set updated_at = now() - interval '4 hours' where user_id = '68000000-0000-0000-0000-000000000002' and status_id = '6a000000-0000-0000-0000-000000000001';
update public.status_economy_votes set updated_at = now() - interval '3 hours' where user_id = '68000000-0000-0000-0000-000000000003' and status_id = '6a000000-0000-0000-0000-000000000001';
update public.status_economy_votes set updated_at = now() - interval '2 hours' where user_id = '68000000-0000-0000-0000-000000000004' and status_id = '6a000000-0000-0000-0000-000000000001';
update public.status_economy_votes set updated_at = now() - interval '1 hours' where user_id = '68000000-0000-0000-0000-000000000005' and status_id = '6a000000-0000-0000-0000-000000000001';

-- === quem apoiou: só apoiadores ===
select pg_temp.as_user('03');
create temp table _p1 as select public.list_post_supporters('6a000000-0000-0000-0000-000000000001') r;
select is((select jsonb_array_length(r -> 'supporters') from _p1), 4, 'lista traz os 4 apoiadores');
select ok(not exists (select 1 from _p1, jsonb_array_elements(r -> 'supporters') e where e ->> 'userId' = '68000000-0000-0000-0000-000000000006'), 'quem NÃO apoiou nunca aparece na lista');
select is((select r -> 'supporters' -> 0 ->> 'userId' from _p1), '68000000-0000-0000-0000-000000000005', 'ordenação: mais recente primeiro');
select is((select r -> 'supporters' -> 3 ->> 'userId' from _p1), '68000000-0000-0000-0000-000000000002', 'ordenação: mais antigo por último');
select is((select (r -> 'supporters' -> 0) ?& array['userId','username','avatarPath'] from _p1), true, 'item traz userId, username e avatarPath');
select is((select count(*)::int from _p1, jsonb_object_keys(r -> 'supporters' -> 0) k where k not in ('userId','username','avatarPath')), 0, 'item não vaza value/charged/reward/timestamps');
select is((select r -> 'nextCursor' from _p1), 'null'::jsonb, 'sem próxima página quando tudo cabe');
select is((select r -> 'supporters' -> 0 ->> 'username' from _p1), 'apoiador05', 'username vem do perfil público (1 JOIN, sem N+1)');

-- paginação keyset
create temp table _pg1 as select public.list_post_supporters('6a000000-0000-0000-0000-000000000001', null, null, 2) r;
select is((select jsonb_array_length(r -> 'supporters') from _pg1), 2, 'página 1: 2 itens');
select ok((select r -> 'nextCursor' is not null from _pg1), 'página 1 devolve cursor');
create temp table _pg2 as select public.list_post_supporters('6a000000-0000-0000-0000-000000000001',
  (select (r -> 'nextCursor' ->> 'at')::timestamptz from _pg1), (select (r -> 'nextCursor' ->> 'userId')::uuid from _pg1), 2) r;
select is((select r -> 'supporters' -> 0 ->> 'userId' from _pg2), '68000000-0000-0000-0000-000000000003', 'página 2 continua sem repetir');
select is((select jsonb_array_length(r -> 'supporters') from _pg2), 2, 'página 2: 2 itens');
select is((select r -> 'nextCursor' from _pg2), 'null'::jsonb, 'última página sem cursor');
select is((select jsonb_array_length(public.list_post_supporters('6a000000-0000-0000-0000-000000000001', null, null, 1000) -> 'supporters')), 4, 'limite máximo é saneado (nunca estoura)');
select throws_ok($$select public.list_post_supporters('6a000000-0000-0000-0000-000000000001', now(), null, 5)$$, 'INVALID_CURSOR', 'cursor incompleto é recusado');

-- === não existe como listar não apoiadores ===
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'list_post_economy_voters'), 0, 'RPC antiga que aceitava direção -1 foi removida');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname ilike '%non_support%' or p.proname ilike '%nonsupport%' or p.proname ilike '%downvote%' or p.proname ilike '%negative_voters%')), 0, 'nenhuma RPC pública de não apoiadores');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'list_post_supporters' and p.proargnames @> array['p_direction']), 0, 'list_post_supporters não aceita "direção"');

-- RLS: nenhum usuário (nem superadmin) lê o voto alheio direto na tabela
set local role authenticated;
select pg_temp.as_user('03');
select is((select count(*)::int from public.status_economy_votes where user_id = '68000000-0000-0000-0000-000000000006'), 0, 'RLS: membro não lê o voto "não apoiar" de outro usuário');
select is((select count(*)::int from public.status_economy_votes), 1, 'RLS: usuário só enxerga o próprio voto');
select pg_temp.as_user('06');
select is((select count(*)::int from public.status_economy_votes where value = -1), 1, 'RLS: o dono vê o próprio "não apoiar"');
select pg_temp.as_user('08');
select is((select count(*)::int from public.status_economy_votes), 0, 'RLS: nem superadmin lê votos alheios direto (sem necessidade comprovada)');
select is((select count(*)::int from public.statuses where id = '6a000000-0000-0000-0000-000000000001'), 1, 'contadores seguem legíveis na publicação');
reset role;

-- acesso à lista de apoiadores
select pg_temp.as_user('07');
select throws_ok($$select public.list_post_supporters('6a000000-0000-0000-0000-000000000001')$$, 'PERMISSION_DENIED', 'não-membro não vê quem apoiou');
select pg_temp.as_user('08');
select is((select jsonb_array_length(public.list_post_supporters('6a000000-0000-0000-0000-000000000001') -> 'supporters')), 4, 'superadmin continua vendo a lista de apoiadores');
select throws_ok($$select public.list_post_supporters('6a000000-0000-0000-0000-0000000000ff')$$, 'STATUS_NOT_FOUND', 'publicação inexistente');
select ok(not has_function_privilege('anon', 'public.list_post_supporters(uuid, timestamptz, uuid, integer)', 'execute'), 'anon não executa a RPC');

-- === conta excluída: lista e contadores seguem corretos ===
select public._wallet_credit_cash('68000000-0000-0000-0000-000000000001', 0);
update public.users set role = 'superadmin' where id = '68000000-0000-0000-0000-000000000008';
select pg_temp.as_user('08');
select public.queue_deletion('account', '68000000-0000-0000-0000-000000000003');
select public.run_deletion_job(id) from public.deletion_jobs where target_id = '68000000-0000-0000-0000-000000000003';
select is(pg_temp.counts(), '3/1', 'contador acompanha a exclusão do votante (4 -> 3 apoios)');
select is((select count(*)::int from public.status_economy_votes where status_id = '6a000000-0000-0000-0000-000000000001' and value = 1), 3, 'voto do votante excluído removido');
select pg_temp.as_user('02');
select is((select jsonb_array_length(public.list_post_supporters('6a000000-0000-0000-0000-000000000001') -> 'supporters')), 3, 'lista não quebra e não mostra a conta excluída');
-- perfil público ausente de um apoiador vira username null (UI: "Membro"), sem erro
delete from public.public_profiles where user_id = '68000000-0000-0000-0000-000000000004';
select is((select e ->> 'username' from jsonb_array_elements(public.list_post_supporters('6a000000-0000-0000-0000-000000000001') -> 'supporters') e where e ->> 'userId' = '68000000-0000-0000-0000-000000000004'), null, 'perfil ausente: username null, lista intacta');
-- exclusão do votante que NÃO apoiou
select pg_temp.as_user('08');
select public.queue_deletion('account', '68000000-0000-0000-0000-000000000006');
select public.run_deletion_job(id) from public.deletion_jobs where target_id = '68000000-0000-0000-0000-000000000006';
select is(pg_temp.counts(), '3/0', 'exclusão de quem não apoiou ajusta o contador de não apoios (1 -> 0)');
-- apagar a publicação com votos não quebra (trigger no cascade)
select lives_ok($$delete from public.statuses where id = '6a000000-0000-0000-0000-000000000001'$$, 'apagar a publicação com votos não quebra o trigger');

select * from finish();
rollback;
