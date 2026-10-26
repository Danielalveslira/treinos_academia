\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 elegível rico  ..02 29 dias de conta  ..03 exatamente 30 dias  ..04 19 dias ativos
-- ..05 e-mail não confirmado  ..06 conta restrita  ..07 limite atingido  ..08 sem saldo
-- ..09 dono com 3 ativas + 1 inativa  ..0a membro comum  ..0b superadmin
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'cc' || n || '-create@example.invalid', 'x',
       case when n = '05' then null else now() end, '{}', '{}', now(), now()
from unnest(array['01','02','03','04','05','06','07','08','09','0a','0b']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'c1000000-%';
update public.users set role = 'superadmin' where id = 'c1000000-0000-0000-0000-00000000000b';
update public.users set created_at = now() - interval '90 days' where id::text like 'c1000000-%';
update public.users set created_at = now() - interval '29 days' where id = 'c1000000-0000-0000-0000-000000000002';
update public.users set created_at = now() - interval '30 days' where id = 'c1000000-0000-0000-0000-000000000003';
insert into public.public_profiles (user_id, username)
select id, 'criador' || right(id::text, 2) from public.users where id::text like 'c1000000-%';

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( 'c1000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.uid(p text) returns uuid language sql as
  $$select ('c1000000-0000-0000-0000-0000000000' || p)::uuid$$;
-- n dias ativos qualificados consecutivos terminando ontem (fuso America/Sao_Paulo)
create or replace function pg_temp.mk_days(p text, n integer) returns void language sql as $$
  insert into public.community_creation_activity_days (user_id, activity_date, qualified_seconds, qualified)
  select pg_temp.uid(p), (now() at time zone 'America/Sao_Paulo')::date - g, 900, true from generate_series(1, n) g
  on conflict do nothing
$$;
create or replace function pg_temp.coins(p text) returns int language sql as
  $$select coalesce((select coin_balance from public.wallets where user_id = pg_temp.uid(p)), 0)$$;
create or replace function pg_temp.cash(p text) returns int language sql as
  $$select coalesce((select cash_balance from public.wallets where user_id = pg_temp.uid(p)), 0)$$;
create or replace function pg_temp.owned(p text) returns int language sql as
  $$select count(*)::int from public.communities where owner_id = pg_temp.uid(p)$$;

select pg_temp.mk_days('01', 20);
select pg_temp.mk_days('02', 25);
select pg_temp.mk_days('03', 20);
select pg_temp.mk_days('04', 19);
select pg_temp.mk_days('05', 25);
select pg_temp.mk_days('06', 25);
select pg_temp.mk_days('07', 25);
select pg_temp.mk_days('08', 25);
select pg_temp.mk_days('09', 25);
select pg_temp.mk_days('0a', 25);
insert into public.account_restrictions (user_id, action, until)
  values (pg_temp.uid('06'), 'temporary_suspension', now() + interval '7 days');

select public._wallet_credit_coins(pg_temp.uid(n), 5000) from unnest(array['01','02','03','04','05','06','07','09']) as n;
select public._wallet_credit_cash(pg_temp.uid(n), 5000) from unnest(array['01','02','09']) as n;
select public._wallet_credit_coins(pg_temp.uid('08'), 100);
select public._wallet_credit_coins(pg_temp.uid('0a'), 10);
-- EvoCash ainda sem valor definido na migration: o teste fixa preços só para exercitar o caminho
update public.community_creation_products set evocash_price = case tier when 'essential' then 50 when 'plus' then 120 else 500 end;

-- limite: 07 já tem 3 ativas; 09 tem 3 ativas + 1 inativa
insert into public.communities (id, name, created_by, owner_id, is_active)
select ('c2000000-0000-0000-0000-0000000000' || lpad(i::text, 2, '0'))::uuid, 'Existente ' || i, pg_temp.uid(u), pg_temp.uid(u), act
from (values (1,'07',true),(2,'07',true),(3,'07',true),(4,'09',true),(5,'09',true),(6,'09',true),(7,'09',false)) v(i,u,act);

-- ============================================================ ELEGIBILIDADE
select pg_temp.as_user('01');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, true, '01: 90 dias, 20 dias ativos, e-mail ok -> elegível');
select is((public.get_my_community_creation_eligibility() ->> 'evoCoinsBalance')::int, 5000, 'saldo vem da carteira no servidor');
select is(
  (select array_agg(k order by k) from jsonb_object_keys(public.get_my_community_creation_eligibility()) k),
  array['accountDays','accountStanding','activeOwnedCommunities','activeWindowDays','communityLimit','eligible','emailVerified',
        'evoCashBalance','evoCoinsBalance','qualifiedDays','qualifiedToday','requiredAccountDays','requiredQualifiedDays'],
  'a RPC devolve apenas os campos públicos (nenhum sinal interno)');
select pg_temp.as_user('02');
select is((public.get_my_community_creation_eligibility() ->> 'accountDays')::int, 29, '02: 29 dias de conta');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, false, '29 dias -> bloqueado');
select pg_temp.as_user('03');
select is((public.get_my_community_creation_eligibility() ->> 'accountDays')::int, 30, '03: 30 dias de conta');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, true, '30 dias -> requisito de idade passa');
select pg_temp.as_user('04');
select is((public.get_my_community_creation_eligibility() ->> 'qualifiedDays')::int, 19, '04: 19 dias ativos');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, false, 'dias ativos insuficientes -> bloqueado');
-- dia fora da janela de 30 dias e dia não qualificado não contam
insert into public.community_creation_activity_days (user_id, activity_date, qualified_seconds, qualified) values
  (pg_temp.uid('04'), (now() at time zone 'America/Sao_Paulo')::date - 45, 900, true),
  (pg_temp.uid('04'), (now() at time zone 'America/Sao_Paulo')::date - 25, 120, false);
select is((public.get_my_community_creation_eligibility() ->> 'qualifiedDays')::int, 19, 'dia fora da janela e dia não qualificado não contam');
insert into public.community_creation_activity_days (user_id, activity_date, qualified_seconds, qualified)
  values (pg_temp.uid('04'), (now() at time zone 'America/Sao_Paulo')::date, 700, true);
select is((public.get_my_community_creation_eligibility() ->> 'qualifiedDays')::int, 20, 'o dia de hoje conta');
select is((public.get_my_community_creation_eligibility() ->> 'qualifiedToday')::boolean, true, 'qualifiedToday');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, true, 'dias ativos suficientes -> elegível');
select pg_temp.as_user('05');
select is((public.get_my_community_creation_eligibility() ->> 'emailVerified')::boolean, false, '05: e-mail não confirmado');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, false, 'e-mail não confirmado -> bloqueado');
select pg_temp.as_user('06');
select is(public.get_my_community_creation_eligibility() ->> 'accountStanding', 'unavailable', '06: conta restrita -> standing genérico');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, false, 'conta restrita -> bloqueado');
select pg_temp.as_user('07');
select is((public.get_my_community_creation_eligibility() ->> 'activeOwnedCommunities')::int, 3, '07: 3 comunidades ativas');
select is((public.get_my_community_creation_eligibility() ->> 'eligible')::boolean, false, 'limite atingido -> bloqueado');
select pg_temp.as_user('09');
select is((public.get_my_community_creation_eligibility() ->> 'activeOwnedCommunities')::int, 3, '09: comunidade inativa não consome limite');

-- ============================================================ CRIAÇÃO: ELEGIBILIDADE VEM ANTES DO PAGAMENTO
select pg_temp.as_user('02');
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000000a')$$, 'ACCOUNT_TOO_NEW', 'pagar com EvoCoins não pula o gate de idade');
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocash', 'key-0000000b')$$, 'ACCOUNT_TOO_NEW', 'pagar com EvoCash não pula o gate de idade');
select is(pg_temp.coins('02') || '/' || pg_temp.cash('02') || '/' || pg_temp.owned('02'), '5000/5000/0', 'gate recusado: nada cobrado, nada criado');
select pg_temp.as_user('05');
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000000c')$$, 'EMAIL_NOT_VERIFIED', 'e-mail não confirmado');
select pg_temp.as_user('06');
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000000d')$$, 'ACCOUNT_NOT_ELIGIBLE', 'conta restrita');
select pg_temp.as_user('07');
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000000e')$$, 'COMMUNITY_LIMIT_REACHED', 'limite de 3 comunidades próprias');
select pg_temp.as_user('04');
delete from public.community_creation_activity_days where user_id = pg_temp.uid('04') and activity_date = (now() at time zone 'America/Sao_Paulo')::date;
select throws_ok($$select public.create_community('Nova', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000000f')$$, 'NOT_ACTIVE_ENOUGH', 'dias ativos insuficientes');

-- ============================================================ CRIAÇÃO: ECONOMIA
select pg_temp.as_user('08');
select throws_ok($$select public.create_community('Sem saldo', 'x', 'dumbbell', 'essential', 'evocoins', 'key-00000010')$$, 'INSUFFICIENT_COINS', 'saldo insuficiente em EvoCoins');
select throws_ok($$select public.create_community('Sem saldo', 'x', 'dumbbell', 'essential', 'evocash', 'key-00000011')$$, 'INSUFFICIENT_CASH', 'saldo insuficiente em EvoCash');
select is(pg_temp.owned('08') || '/' || pg_temp.coins('08'), '0/100', 'saldo insuficiente: nada criado, nada cobrado');

select pg_temp.as_user('01');
select throws_ok($$select public.create_community('Forjada', 'x', 'dumbbell', 'platinum', 'evocoins', 'key-00000012')$$, 'INVALID_TIER', 'tier forjado');
select throws_ok($$select public.create_community('Forjada', 'x', 'dumbbell', 'essential', 'pix', 'key-00000013')$$, 'INVALID_PAYMENT_METHOD', 'forma de pagamento forjada');
select throws_ok($$select public.create_community('Forjada', 'x', 'dumbbell', 'essential', 'evocoins', 'k')$$, 'INVALID_REQUEST_ID', 'chave de idempotência inválida');
select throws_ok($$select public.create_community('', 'x', 'dumbbell', 'essential', 'evocoins', 'key-00000014')$$, 'INVALID_NAME', 'nome vazio');
select throws_ok($$select public.create_community('Arquivo', 'x', 'dumbbell', 'archive', 'evocoins', 'key-00000015')$$, 'PAYMENT_METHOD_UNAVAILABLE', 'Arquivo não é vendido em EvoCoins');
-- rollback em falha: ícone inválido estoura a constraint DEPOIS de checar saldo -- nada cobrado
select throws_ok($$select public.create_community('Icone ruim', 'x', 'bogus', 'essential', 'evocoins', 'key-00000016')$$, '23514', null, 'ícone inválido falha');
select throws_ok($$select public.create_community('Falsa oficial', 'x', 'evolutus', 'essential', 'evocoins', 'key-0000001d')$$,
  '42501', null, 'RPC de criação não pode usar o ícone oficial em comunidade particular');
select is(pg_temp.coins('01') || '/' || pg_temp.owned('01'), '5000/0', 'falha no meio: rollback total (sem débito, sem comunidade)');

create temp table created(label text, result jsonb);
grant all on created to public;
insert into created select 'essential-coins', public.create_community('  Corrida Evolutus  ', 'Grupo de corrida', 'footprints', 'essential', 'evocoins', 'key-00000017');
select is((select (result ->> 'replay')::boolean from created where label = 'essential-coins'), false, 'criação com EvoCoins');
select is(pg_temp.coins('01'), 4700, 'debitou 300 EvoCoins (preço do servidor)');
select is((select name || '|' || tier || '|' || post_retention_mode || '|' || (owner_id = pg_temp.uid('01'))::text || '|' || (created_by = pg_temp.uid('01'))::text
            from public.communities where id = (select (result ->> 'id')::uuid from created where label = 'essential-coins')),
          'Corrida Evolutus|essential|24h|true|true', 'tier/retenção do produto, owner = auth.uid(), nome aparado');
select is((select count(*)::int from public.community_members where community_id = (select (result ->> 'id')::uuid from created) and user_id = pg_temp.uid('01')), 1, 'dono entra como membro');
select is((select reason || '|' || asset || '|' || direction || '|' || amount::int from public.economy_transactions
            where user_id = pg_temp.uid('01') and reference_id = (select result ->> 'id' from created)), 'community_creation|coin|debit|300', 'ledger registrado');
-- retry/duplo clique: mesma chave, mesmo resultado, sem nova cobrança
select is((select public.create_community('  Corrida Evolutus  ', 'Grupo de corrida', 'footprints', 'essential', 'evocoins', 'key-00000017') ->> 'id'),
          (select result ->> 'id' from created), 'retry devolve a comunidade original');
select is((select (public.create_community('  Corrida Evolutus  ', 'Grupo de corrida', 'footprints', 'essential', 'evocoins', 'key-00000017') ->> 'replay')::boolean), true, 'marcado como replay');
select is(pg_temp.coins('01') || '/' || pg_temp.owned('01') || '/' ||
          (select count(*) from public.economy_transactions where user_id = pg_temp.uid('01') and reason = 'community_creation'), '4700/1/1', 'retry não cobra nem cria de novo');
select throws_ok($$select public.create_community('Outra coisa', 'x', 'dumbbell', 'essential', 'evocoins', 'key-00000017')$$, 'REQUEST_ID_CONFLICT', 'mesma chave com dados diferentes é recusada');

-- pagamento com EvoCash (Plus = 120)
insert into created select 'plus-cash', public.create_community('Plus Club', '', null, 'plus', 'evocash', 'key-00000018');
select is(pg_temp.cash('01'), 4880, 'debitou 120 EvoCash');
select is((select tier || '|' || post_retention_mode from public.communities where id = (select (result ->> 'id')::uuid from created where label = 'plus-cash')), 'plus|30d', 'Plus -> 30d');
select is((select asset || '|' || amount::int from public.economy_transactions where user_id = pg_temp.uid('01') and reference_id = (select result ->> 'id' from created where label = 'plus-cash')), 'cash|120', 'ledger em EvoCash');
insert into created select 'archive-cash', public.create_community('Arquivo Vivo', '', null, 'archive', 'evocash', 'key-00000019');
select is((select tier || '|' || post_retention_mode from public.communities where id = (select (result ->> 'id')::uuid from created where label = 'archive-cash')), 'archive|no_auto_expiration', 'Arquivo -> sem expiração automática');
-- limite: 3 criadas, a quarta falha mesmo pagando
select throws_ok($$select public.create_community('Quarta', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000001a')$$, 'COMMUNITY_LIMIT_REACHED', 'quarta comunidade bloqueada');
-- comunidade inativa não consome limite
update public.communities set is_active = false where id = (select (result ->> 'id')::uuid from created where label = 'plus-cash');
select lives_ok($$select public.create_community('Quarta', 'x', 'dumbbell', 'essential', 'evocoins', 'key-0000001b')$$, 'comunidade inativa libera vaga no limite');
update public.communities set is_active = true where id = (select (result ->> 'id')::uuid from created where label = 'plus-cash');
-- (reativação direta por postgres não passa pelo trigger de cliente; o caso de cliente está abaixo)

-- preço NULL em EvoCash = indisponível (falha fechada)
update public.community_creation_products set evocash_price = null where tier = 'essential';
select pg_temp.as_user('09');
update public.communities set is_active = false where owner_id = pg_temp.uid('09') and is_active;
select throws_ok($$select public.create_community('Cash nulo', 'x', 'dumbbell', 'essential', 'evocash', 'key-0000001c')$$, 'PAYMENT_METHOD_UNAVAILABLE', 'EvoCash sem preço configurado não é cobrável');
update public.community_creation_products set evocash_price = 50 where tier = 'essential';
update public.communities set is_active = true where owner_id = pg_temp.uid('09') and id <> 'c2000000-0000-0000-0000-000000000007';

-- ============================================================ SEGURANÇA / GRANTS
set local role authenticated;
select pg_temp.as_user('0a');
select throws_ok($$insert into public.communities (name, created_by, owner_id) values ('Direta', pg_temp.uid('0a'), pg_temp.uid('0a'))$$,
  '42501', null, 'usuário comum não faz INSERT direto de comunidade (RLS)');
select throws_ok($$insert into public.communities (name, created_by, icon_name) values ('Falsa oficial', pg_temp.uid('0a'), 'evolutus')$$,
  '42501', null, 'usuário comum não insere comunidade oficial pela API direta');
select throws_ok($$insert into public.communities (name, created_by, owner_id, tier, post_retention_mode) values ('Direta', pg_temp.uid('0a'), pg_temp.uid('0a'), 'archive', 'no_auto_expiration')$$,
  'TIER_IMMUTABLE', 'INSERT direto com tier forjado também é recusado');
select throws_ok($$select public._wallet_debit_coins(pg_temp.uid('0a'), 1)$$, '42501', null, 'cliente não chama helper financeiro privilegiado');
select throws_ok($$select public._ledger_record(pg_temp.uid('0a'), 'x', 'coin', 'credit', 1, 'x', null, null)$$, '42501', null, 'cliente não escreve no ledger');
select throws_ok($$select private.community_creation_state(pg_temp.uid('0a'))$$, '42501', null, 'cliente não chama a função interna de elegibilidade');
select throws_ok($$select * from public.community_creation_activity_days$$, '42501', null, 'cliente não lê o resumo de atividade');
select throws_ok($$insert into public.community_creation_activity_days (user_id, activity_date, qualified_seconds, qualified) values (pg_temp.uid('0a'), current_date, 9999, true)$$, '42501', null, 'cliente não forja dia ativo');
select throws_ok($$select * from public.community_creation_products$$, '42501', null, 'preços só pelo RPC (tabela fechada)');
select throws_ok($$update public.community_creation_rules set required_account_days = 0$$, '42501', null, 'cliente não altera as regras');
select throws_ok($$update public.wallets set coin_balance = 99999, cash_balance = 99999 where user_id = 'c1000000-0000-0000-0000-00000000000a'$$, '42501', null, 'cliente não escreve na carteira (REVOKE explícito, independente de RLS)');
select ok(has_function_privilege('authenticated', 'public.create_community(text,text,text,text,text,text)', 'execute'), 'authenticated executa create_community');
select ok(not has_function_privilege('anon', 'public.create_community(text,text,text,text,text,text)', 'execute'), 'anon não executa create_community');
select ok(not has_function_privilege('anon', 'public.get_my_community_creation_eligibility()', 'execute'), 'anon não executa a elegibilidade');
select ok(not has_function_privilege('anon', 'public.upgrade_community_tier(uuid,text,text,text)', 'execute'), 'anon não executa o upgrade');
reset role;
set local role authenticated;
select pg_temp.as_user('0b');
select lives_ok($$insert into public.communities (name, created_by, icon_name) values ('Comunidade oficial', pg_temp.uid('0b'), 'evolutus')$$,
  'superadmin cria comunidade oficial com o ícone da marca');
select throws_ok($$insert into public.communities (name, created_by, owner_id, icon_name) values ('Particular', pg_temp.uid('0b'), pg_temp.uid('0b'), 'evolutus')$$,
  '42501', null, 'nem superadmin aplica a marca a uma comunidade particular');
select is((select icon_name from public.communities where name = 'Comunidade oficial'), 'evolutus', 'ícone oficial persiste e pode ser lido');
select lives_ok($$update public.communities set icon_name = 'users' where name = 'Comunidade oficial'$$,
  'superadmin pode trocar o ícone oficial por outro');
select lives_ok($$update public.communities set icon_name = 'evolutus' where name = 'Comunidade oficial'$$,
  'superadmin pode selecionar a marca na edição');
select throws_ok($$update public.communities set owner_id = pg_temp.uid('0b') where name = 'Comunidade oficial'$$,
  '42501', null, 'comunidade marcada como oficial não pode ganhar dono');
reset role;
select is(pg_temp.coins('0a') || '/' || pg_temp.cash('0a'), '10/0', 'cliente não altera o próprio saldo');
select ok(to_regprocedure('public.create_community_with_cash(text,text,text,text)') is null, 'fluxo antigo (que ignorava o novo gate) foi removido');

-- dono altera a própria comunidade, mas não tier/retenção nem fura o limite reativando
set local role authenticated;
select pg_temp.as_user('01');
select throws_ok($$update public.communities set icon_name = 'evolutus' where owner_id = pg_temp.uid('01') and name = 'Corrida Evolutus'$$,
  '42501', null, 'dono não marca comunidade própria como oficial por UPDATE direto');
select lives_ok($$update public.communities set description = 'nova descrição' where owner_id = pg_temp.uid('01') and name = 'Corrida Evolutus'$$, 'dono edita descrição');
select throws_ok($$update public.communities set tier = 'archive', post_retention_mode = 'no_auto_expiration' where name = 'Corrida Evolutus'$$, 'TIER_IMMUTABLE', 'dono não promove a própria comunidade por UPDATE direto');
select throws_ok($$update public.communities set post_retention_mode = '30d' where name = 'Corrida Evolutus'$$, 'TIER_IMMUTABLE', 'dono não troca só a retenção');
select pg_temp.as_user('09');
select throws_ok($$update public.communities set is_active = true where id = 'c2000000-0000-0000-0000-000000000007'$$, 'COMMUNITY_LIMIT_REACHED', 'reativar acima do limite é bloqueado (não dá para desativar-criar-reativar)');
reset role;

-- ============================================================ RETENÇÃO DAS PUBLICAÇÕES
insert into public.community_members (community_id, user_id)
select (result ->> 'id')::uuid, pg_temp.uid('0a') from created where label in ('essential-coins', 'plus-cash', 'archive-cash');
set local role authenticated;
select pg_temp.as_user('0a');
-- O cliente nunca define expires_at (mesmo formato do app real, ver src/services/statusesService.js
-- createPhotoStatus/baseStatusFields: a coluna nunca é incluída no insert). O grant por coluna em
-- 20261026000005_aud_security_atomic.sql:94-95 nem concede expires_at a authenticated -- o cliente
-- não consegue nem tentar enviá-la. O servidor decide o valor via gatilho statuses_apply_retention,
-- a partir do tier da comunidade; é exatamente isso que as asserções abaixo verificam.
insert into public.statuses (id, community_id, author_id, type, text)
select 'c3000000-0000-0000-0000-000000000001', (result ->> 'id')::uuid, pg_temp.uid('0a'), 'text', 'post 24h'
  from created where label = 'essential-coins';
insert into public.statuses (id, community_id, author_id, type, text)
select 'c3000000-0000-0000-0000-000000000002', (result ->> 'id')::uuid, pg_temp.uid('0a'), 'text', 'post 30d'
  from created where label = 'plus-cash';
insert into public.statuses (id, community_id, author_id, type, text)
select 'c3000000-0000-0000-0000-000000000003', (result ->> 'id')::uuid, pg_temp.uid('0a'), 'text', 'post arquivo'
  from created where label = 'archive-cash';
reset role;
select ok((select expires_at between now() + interval '23 hours 59 minutes' and now() + interval '24 hours 1 minute' from public.statuses where id = 'c3000000-0000-0000-0000-000000000001'),
  '24h: expires_at = agora + 24h (decidido pelo servidor a partir do tier, nunca pelo cliente)');
select is((select retention_mode from public.statuses where id = 'c3000000-0000-0000-0000-000000000001'), '24h', 'post guarda retention_mode 24h');
select ok((select expires_at between now() + interval '29 days 23 hours' and now() + interval '30 days 1 hour' from public.statuses where id = 'c3000000-0000-0000-0000-000000000002'),
  '30d: expires_at = agora + 30 dias');
select is((select expires_at is null and retention_mode = 'no_auto_expiration' from public.statuses where id = 'c3000000-0000-0000-0000-000000000003'), true, 'Arquivo: expires_at nulo');
select is((select comments_close_at is null from public.statuses where id = 'c3000000-0000-0000-0000-000000000003'), true, 'sem expiração: comentários nunca fecham');
select is(private.comments_open((select s from public.statuses s where id = 'c3000000-0000-0000-0000-000000000003')), true, 'comentários abertos no post sem expiração');
update public.statuses set expires_at = now() - interval '1 minute' where id = 'c3000000-0000-0000-0000-000000000001';
select is(private.comments_open((select s from public.statuses s where id = 'c3000000-0000-0000-0000-000000000001')), false, 'post de 24h vencido: comentários fechados');
-- um post com expires_at nulo não é "expirado" por nenhuma contagem de vencidos
select is((select count(*)::int from public.statuses where community_id in (select (result ->> 'id')::uuid from created) and expires_at is not null and expires_at < now()), 1, 'só o post de 24h vencido aparece como expirado');

-- ============================================================ UPGRADE
update public.statuses set expires_at = now() + interval '5 hours' where id = 'c3000000-0000-0000-0000-000000000001';
select pg_temp.as_user('01');
select is((select public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'plus', 'evocoins', 'upg-00000001') ->> 'amountCharged')::int, 300, 'upgrade cobra a diferença do que já foi pago (600 - 300) em EvoCoins');
select is(pg_temp.coins('01'), 4100, 'saldo após o upgrade');
select is((select tier || '|' || post_retention_mode from public.communities where id = (select (result ->> 'id')::uuid from created where label = 'essential-coins')), 'plus|30d', 'comunidade atualizada');
select is((select reason || '|' || amount::int from public.economy_transactions where user_id = pg_temp.uid('01') and reason = 'community_upgrade'), 'community_upgrade|300', 'ledger do upgrade');
select is((select (public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'plus', 'evocoins', 'upg-00000001') ->> 'replay')::boolean), true, 'retry do upgrade é replay');
select is(pg_temp.coins('01'), 4100, 'retry do upgrade não cobra de novo');
select throws_ok($$select public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'essential', 'evocoins', 'upg-00000002')$$, 'NOT_AN_UPGRADE', 'sem downgrade');
select throws_ok($$select public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'plus', 'evocoins', 'upg-00000003')$$, 'NOT_AN_UPGRADE', 'mesmo tier não é upgrade');
select pg_temp.as_user('0a');
select throws_ok($$select public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'archive', 'evocash', 'upg-00000004')$$, 'NOT_OWNER', 'só o dono faz upgrade');
select pg_temp.as_user('01');
-- Plus (pago em EvoCoins no upgrade, EvoCash na criação) -> Arquivo em EvoCash: crédito só do que foi pago em EvoCash naquela comunidade (0)
select is((select public.upgrade_community_tier((select (result ->> 'id')::uuid from created where label = 'essential-coins'), 'archive', 'evocash', 'upg-00000005') ->> 'amountCharged')::int, 500, 'upgrade para Arquivo em EvoCash (sem crédito na moeda)');
-- posts antigos NÃO mudam; novos usam a nova regra
select is((select expires_at between now() + interval '4 hours' and now() + interval '6 hours' and retention_mode = '24h' from public.statuses where id = 'c3000000-0000-0000-0000-000000000001'), true, 'post antigo mantém prazo e regra');
set local role authenticated;
select pg_temp.as_user('0a');
insert into public.statuses (id, community_id, author_id, type, text)
select 'c3000000-0000-0000-0000-000000000004', (result ->> 'id')::uuid, pg_temp.uid('0a'), 'text', 'post depois do upgrade' from created where label = 'essential-coins';
reset role;
select is((select expires_at is null and retention_mode = 'no_auto_expiration' from public.statuses where id = 'c3000000-0000-0000-0000-000000000004'), true, 'post novo usa a nova retenção');
select is((select count(*)::int from public.statuses where id = 'c3000000-0000-0000-0000-000000000001' and retention_mode = '24h'), 1, 'post antigo continua 24h depois de todos os upgrades');

-- ============================================================ DIA ATIVO (SERVIDOR)
select pg_temp.as_user('0a');
select is((public.register_qualified_activity() ->> 'dayQualified')::boolean, false, 'resposta traz dayQualified = false enquanto o dia não qualificou (o app segue pingando)');
select is((select checkpoints_count || '/' || qualified_seconds || '/' || qualified from public.community_creation_activity_days
            where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date), '1/0/false', '1º ping do dia não soma tempo');
select public.register_qualified_activity();
select is((select checkpoints_count from public.community_creation_activity_days where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date), 1, 'ping a menos de 60s é ignorado (sem automação em rajada)');
update public.community_creation_activity_days set last_checkpoint_at = now() - interval '5 minutes' where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date;
select public.register_qualified_activity();
select is((select qualified_seconds from public.community_creation_activity_days where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date), 300, 'intervalo real de 5 min soma 300s');
update public.community_creation_activity_days set last_checkpoint_at = now() - interval '2 hours' where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date;
select public.register_qualified_activity();
select is((select qualified_seconds || '/' || qualified from public.community_creation_activity_days where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date), '1500/true', 'tempo real sozinho qualifica o dia (20261124000001: sem depender de evento alheio)');
update public.community_creation_activity_days set checkpoints_count = 40, last_checkpoint_at = now() - interval '10 minutes' where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date;
select is((public.register_qualified_activity() ->> 'dayQualified')::boolean, true, 'no teto de checkpoints, o dia já qualificado continua qualificado');
select is((select qualified_seconds from public.community_creation_activity_days where user_id = pg_temp.uid('0a') and activity_date = (now() at time zone 'America/Sao_Paulo')::date), 1500, 'teto de 40 pings por dia (limita escritas, não minutos)');
-- a atividade tem UMA fonte (community_creation_activity_days): nada de minutos paralelos em economy_daily
select is((select coalesce(sum(active_minutes), 0) from public.economy_daily where user_id = pg_temp.uid('0a')), 0::numeric, 'economy_daily não acumula mais minutos de atividade');

-- ============================================================ SESSÃO REVOGADA (20261114000003)
-- '01' segue elegível e com saldo -- a ÚNICA coisa que pode barrar estas chamadas é a sessão.
select pg_temp.as_user('01');
create temp table t_coins_before as select pg_temp.coins('01') as v;
create temp table t_cash_before as select pg_temp.cash('01') as v;
create temp table t_communities_before as select pg_temp.owned('01') as v;
select pg_temp.revoke_test_session('c1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.create_community('Comunidade pós-revogação', '', null, 'essential', 'evocoins', 'sess-revoked-create')$$,
  'SESSION_REVOKED', 'create_community nega sessão revogada antes de qualquer débito/criação'
);
select throws_ok(
  format($$select public.upgrade_community_tier(%L, 'archive', 'evocoins', 'sess-revoked-upgrade')$$,
    (select (result ->> 'id')::uuid from created where label = 'essential-coins')),
  'SESSION_REVOKED', 'upgrade_community_tier nega sessão revogada antes de qualquer débito'
);
select throws_ok(
  $$select public.get_my_community_creation_eligibility()$$,
  'SESSION_REVOKED', 'get_my_community_creation_eligibility nega sessão revogada (não expõe saldo)'
);
select is(public.list_community_creation_products(), null, 'list_community_creation_products devolve NULL (nunca os preços) com sessão revogada');
select throws_ok(
  $$select public.record_promotion_event('status', gen_random_uuid(), gen_random_uuid(), 'click')$$,
  'SESSION_REVOKED', 'record_promotion_event nega sessão revogada antes de tocar na promoção'
);
select is(pg_temp.coins('01'), (select v from t_coins_before), 'saldo de EvoCoins intacto após as tentativas com sessão revogada');
select is(pg_temp.cash('01'), (select v from t_cash_before), 'saldo de EvoCash intacto após as tentativas com sessão revogada');
select is(pg_temp.owned('01'), (select v from t_communities_before), 'nenhuma comunidade nova criada pela tentativa com sessão revogada');

-- Sessão ativa de novo (novo login): as mesmas ações voltam a funcionar sem mecanismo extra.
-- create_community: '01' já está no limite de comunidades ativas a esta altura do arquivo (regra
-- de negócio normal, nada a ver com sessão) -- em vez de exigir sucesso, prova que a checagem de
-- sessão deixou de ser o bloqueio: chega até a regra de negócio (COMMUNITY_LIMIT_REACHED), não
-- trava mais em SESSION_REVOKED.
select pg_temp.as_user('01');
select throws_ok(
  $$select public.create_community('Comunidade pós-revogação', '', null, 'essential', 'evocoins', 'sess-active-again')$$,
  'COMMUNITY_LIMIT_REACHED', 'sessão ativa de novo: create_community passa da checagem de sessão (chega à regra de negócio real)'
);
select ok((public.get_my_community_creation_eligibility()->>'evoCoinsBalance') is not null,
  'sessão ativa de novo: get_my_community_creation_eligibility volta a funcionar');
select is(jsonb_typeof(public.list_community_creation_products()), 'array', 'sessão ativa de novo: list_community_creation_products volta a funcionar');

select * from finish();
rollback;
