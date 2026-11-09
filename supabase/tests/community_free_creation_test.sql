\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Benefício "primeira comunidade gratuita" (create_free_community, community_free_creation_grants)
-- -- ..01 conta nova, elegível para o grátis  ..02 e-mail não confirmado  ..03 conta restrita
-- ..04 limite de 3 comunidades  ..05 dono/post_access/upgrade-quote  ..06 backfill (owner_id)
-- ..07 backfill (ledger, comunidade já excluída)  ..09 membro comum / não-membro / não-dono
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c3000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'cc' || n || '-free@example.invalid', 'x',
       case when n = '02' then null else now() end, '{}', '{}', now(), now()
from unnest(array['01','02','03','04','05','06','07','08','09']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'c3000000-%';
-- Conta bem nova (0 dias) de propósito: prova que o benefício gratuito não exige dias de conta
-- nem dias ativos (diferente da via paga, que também deixou de exigir, ver eligibility_simplify).
update public.users set created_at = now() where id::text like 'c3000000-%';
insert into public.public_profiles (user_id, username)
select id, 'grat' || right(id::text, 2) from public.users where id::text like 'c3000000-%';
insert into public.account_restrictions (user_id, action, until)
  values (('c3000000-0000-0000-0000-000000000003')::uuid, 'temporary_suspension', now() + interval '7 days');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( 'c3000000-0000-0000-0000-0000000000' || p, true)$$;
create or replace function pg_temp.uid(p text) returns uuid language sql as
  $$select ('c3000000-0000-0000-0000-0000000000' || p)::uuid$$;
create or replace function pg_temp.owned(p text) returns int language sql as
  $$select count(*)::int from public.communities where owner_id = pg_temp.uid(p)$$;
create or replace function pg_temp.granted(p text) returns boolean language sql as
  $$select exists(select 1 from public.community_free_creation_grants where user_id = pg_temp.uid(p))$$;
create or replace function pg_temp.coins(p text) returns int language sql as
  $$select coalesce((select coin_balance from public.wallets where user_id = pg_temp.uid(p)), 0)$$;

-- ============================================================ CRIAÇÃO GRATUITA -- CAMINHO FELIZ
select pg_temp.as_user('01');
select is((public.get_my_community_creation_eligibility() ->> 'freeCommunityAvailable')::boolean, true, '01: benefício gratuito disponível');
select is(public.create_free_community('Minha primeira', 'desc', 'dumbbell', 'everyone', 'free-key-0000001') ->> 'tier', 'starter', '01: cria com tier starter');
select is(pg_temp.owned('01'), 1, '01: passou a ter 1 comunidade');
select is((select tier || '/' || post_retention_mode || '/' || post_access from public.communities where owner_id = pg_temp.uid('01')),
  'starter/24h/everyone', 'tier/retenção/post_access corretos, sem hardcode fora da RPC');
select is((select count(*)::int from public.community_members where community_id = (select id from public.communities where owner_id = pg_temp.uid('01')) and user_id = pg_temp.uid('01')),
  1, 'dono entra como membro');
select is((select count(*)::int from public.economy_transactions where user_id = pg_temp.uid('01') and reason = 'community_creation'),
  0, 'criação gratuita NÃO grava nenhuma linha no ledger (nem de valor 0)');
select is(pg_temp.granted('01'), true, 'grant gravado para 01');
select is((select source from public.community_free_creation_grants where user_id = pg_temp.uid('01')), 'new_user', 'source = new_user');

-- Replay idempotente: mesma chave + mesmo payload devolve a MESMA comunidade, sem 2º grant.
select is(public.create_free_community('Minha primeira', 'desc', 'dumbbell', 'everyone', 'free-key-0000001') ->> 'replay', 'true', '01: replay com a mesma chave devolve replay=true');
select is(pg_temp.owned('01'), 1, '01: replay não criou uma 2ª comunidade');
select is((select count(*)::int from public.community_free_creation_grants where user_id = pg_temp.uid('01')), 1, '01: replay não gravou um 2º grant');

-- Mesma chave, payload diferente (post_access mudou) -> conflito, nunca um replay incorreto.
select throws_ok(
  $$select public.create_free_community('Minha primeira', 'desc', 'dumbbell', 'admins', 'free-key-0000001')$$,
  'REQUEST_ID_CONFLICT', 'mesma chave + post_access diferente -> conflito, não replay'
);

-- Segunda tentativa (chave NOVA) de usar o benefício -> bloqueada, mesmo com tudo mais elegível.
select throws_ok(
  $$select public.create_free_community('Segunda', 'desc', 'dumbbell', 'everyone', 'free-key-0000002')$$,
  'FREE_BENEFIT_ALREADY_USED', '01: segunda comunidade grátis bloqueada'
);
select is(pg_temp.owned('01'), 1, 'tentativa bloqueada não criou nada');

-- Excluir a comunidade grátis NÃO restaura o benefício (ON DELETE SET NULL em community_id,
-- nunca CASCADE -- a decisão de bloqueio é só "a linha do grant existe").
delete from public.communities where owner_id = pg_temp.uid('01');
select is(pg_temp.granted('01'), true, 'grant sobrevive à exclusão da comunidade');
select is((select community_id from public.community_free_creation_grants where user_id = pg_temp.uid('01')), null, 'community_id vira NULL (ON DELETE SET NULL)');
select throws_ok(
  $$select public.create_free_community('Terceira', 'desc', 'dumbbell', 'everyone', 'free-key-0000003')$$,
  'FREE_BENEFIT_ALREADY_USED', 'exclusão não restaura o benefício'
);

-- ============================================================ ELEGIBILIDADE COMPARTILHADA, SEM GATE DE DIAS
select pg_temp.as_user('02');
select throws_ok(
  $$select public.create_free_community('Nova', 'x', 'dumbbell', 'everyone', 'free-key-0000004')$$,
  'EMAIL_NOT_VERIFIED', '02: e-mail não confirmado bloqueia a via gratuita igual à paga'
);
select pg_temp.as_user('03');
select throws_ok(
  $$select public.create_free_community('Nova', 'x', 'dumbbell', 'everyone', 'free-key-0000005')$$,
  'ACCOUNT_NOT_ELIGIBLE', '03: conta restrita bloqueia a via gratuita igual à paga'
);

-- ============================================================ LIMITE DE COMUNIDADES TAMBÉM VALE PARA O GRÁTIS
select pg_temp.as_user('04');
insert into public.communities (id, name, created_by, owner_id, is_active)
select ('c3900000-0000-0000-0000-' || lpad(i, 12, '0'))::uuid, 'Existente ' || i, pg_temp.uid('04'), pg_temp.uid('04'), true
from unnest(array['1', '2', '3']) as i;
select throws_ok(
  $$select public.create_free_community('Quarta', 'x', 'dumbbell', 'everyone', 'free-key-0000006')$$,
  'COMMUNITY_LIMIT_REACHED', '04: limite de 3 comunidades próprias também bloqueia o grátis'
);

-- ============================================================ POST_ACCESS: CRIAÇÃO + RPC DE ALTERAÇÃO + ENFORCEMENT
select pg_temp.as_user('05');
select is(public.create_free_community('Com post_access', 'x', 'dumbbell', 'admins', 'free-key-0000007') ->> 'tier', 'starter', '05: cria já com post_access=admins');
select is((select post_access from public.communities where owner_id = pg_temp.uid('05')), 'admins', 'post_access gravado desde a criação');

-- can_post_in_community respeita post_access='admins': dono pode, membro comum não.
-- (09 já existe desde o lote inicial de auth.users/public.users/public_profiles no topo.)
insert into public.community_members (community_id, user_id)
  select id, pg_temp.uid('09') from public.communities where owner_id = pg_temp.uid('05');
select is(public.can_post_in_community((select id from public.communities where owner_id = pg_temp.uid('05'))), true, '05 (dono) pode publicar com post_access=admins');
select pg_temp.as_user('09');
select is(public.can_post_in_community((select id from public.communities where owner_id = pg_temp.uid('05'))), false, 'membro comum NÃO pode publicar com post_access=admins');
-- não-membro também não pode (fail-closed)
delete from public.community_members where community_id = (select id from public.communities where owner_id = pg_temp.uid('05')) and user_id = pg_temp.uid('09');
select is(public.can_post_in_community((select id from public.communities where owner_id = pg_temp.uid('05'))), false, 'não-membro não pode publicar');

-- set_community_post_access: dono muda, não-dono é recusado, valor inválido é recusado.
select pg_temp.as_user('05');
select is(
  public.set_community_post_access((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'everyone') ->> 'postAccess',
  'everyone', '05 (dono) muda post_access para everyone'
);
select is((select post_access from public.communities where owner_id = pg_temp.uid('05')), 'everyone', 'persistiu a mudança');
select pg_temp.as_user('09');
select throws_ok(
  $$select public.set_community_post_access((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'admins')$$,
  'NOT_OWNER', 'membro comum não pode alterar post_access'
);
select pg_temp.as_user('05');
select throws_ok(
  $$select public.set_community_post_access((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'everyone-ish')$$,
  'INVALID_POST_ACCESS', 'valor inválido é recusado'
);

-- ============================================================ COTAÇÃO DE UPGRADE: BATE COM A COBRANÇA E DETECTA MUDANÇA DE PREÇO
update public.community_creation_products set evocoins_price = 600 where tier = 'plus';
select pg_temp.as_user('05');
select is(
  (public.quote_community_tier_upgrade((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'plus', 'evocoins') ->> 'amountDue')::int,
  600, 'quote: preço cheio (nenhum crédito anterior nesta comunidade/moeda)'
);
select public._wallet_credit_coins(pg_temp.uid('05'), 1000);
-- Preço muda DEPOIS da cotação (simula produto mudando entre a tela e a confirmação).
update public.community_creation_products set evocoins_price = 700 where tier = 'plus';
select throws_ok(
  $$select public.upgrade_community_tier((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'plus', 'evocoins', 'free-upgrade-0001', 600)$$,
  'PRICE_CHANGED', 'confirma com o valor da cotação ANTIGA depois do preço mudar -> recusado, nada cobrado'
);
select is(pg_temp.coins('05'), 1000, 'PRICE_CHANGED não cobrou nada');
select is((select tier from public.communities where owner_id = pg_temp.uid('05')), 'starter', 'PRICE_CHANGED não mudou o tier');
-- Cotiza de novo (preço atual) e confirma com o valor certo -> funciona, e bate exatamente com o cobrado.
select is(
  (public.quote_community_tier_upgrade((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'plus', 'evocoins') ->> 'amountDue')::int,
  700, 'quote: reflete o novo preço'
);
select is(
  (public.upgrade_community_tier((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'plus', 'evocoins', 'free-upgrade-0002', 700) ->> 'amountCharged')::int,
  700, 'cobra exatamente o valor cotado'
);
select is(pg_temp.coins('05'), 300, 'saldo debitado corretamente (1000 - 700)');
select is((select tier || '/' || post_retention_mode from public.communities where owner_id = pg_temp.uid('05')), 'plus/30d', 'tier e retenção atualizados');
select pg_temp.as_user('09');
select throws_ok(
  $$select public.quote_community_tier_upgrade((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'archive', 'evocash')$$,
  'NOT_OWNER', 'não-dono não consegue nem cotar'
);
select pg_temp.as_user('05');
select throws_ok(
  $$select public.quote_community_tier_upgrade((select id from public.communities where owner_id = 'c3000000-0000-0000-0000-000000000005'::uuid), 'essential', 'evocoins')$$,
  'NOT_AN_UPGRADE', 'essential (rank 1) não é upgrade a partir de plus (rank 2)'
);

-- ============================================================ BACKFILL: SINAIS CONFIRMADOS CONTRA A LÓGICA REAL DA MIGRATION
-- 06: já era dono/criador de uma comunidade ANTES desta suíte rodar (simulado aqui como se a
-- migration de backfill estivesse rodando agora) -- nunca deveria poder criar a gratuita.
insert into public.communities (id, name, created_by, owner_id, is_active)
  values ('c3900000-0000-0000-0000-000000000006', 'Comunidade antiga de 06', pg_temp.uid('06'), pg_temp.uid('06'), true);
-- 07: pagou por uma comunidade que foi excluída depois -- só sobra o ledger.
select public._wallet_credit_coins(pg_temp.uid('07'), 1000);
select public._wallet_debit_coins(pg_temp.uid('07'), 300);
select public._ledger_record(pg_temp.uid('07'), 'community-creation:' || v.id::text, 'coin', 'debit', 300, 'community_creation', 'community', v.id::text)
  from (select gen_random_uuid() as id) v;
-- Re-executa exatamente a lógica de backfill da migration 20261214000004 (idempotente, ON CONFLICT DO NOTHING).
insert into public.community_free_creation_grants (user_id, community_id, source)
select created_by, (array_agg(id order by created_at))[1], 'backfill_owner'
from public.communities where owner_id is not null group by created_by
on conflict (user_id) do nothing;
insert into public.community_free_creation_grants (user_id, community_id, source)
select user_id, null, 'backfill_ledger'
from public.economy_transactions
where user_id is not null and reason = 'community_creation' and reference_type = 'community' and direction = 'debit'
group by user_id on conflict (user_id) do nothing;
select is(pg_temp.granted('06'), true, '06: backfill via created_by concedeu o grant (impede 2ª comunidade grátis)');
select is((select source from public.community_free_creation_grants where user_id = pg_temp.uid('06')), 'backfill_owner', '06: source correto');
select is(pg_temp.granted('07'), true, '07: backfill via ledger concedeu o grant mesmo sem nenhuma comunidade restante');
select is((select source from public.community_free_creation_grants where user_id = pg_temp.uid('07')), 'backfill_ledger', '07: source correto');
select pg_temp.as_user('06');
select throws_ok(
  $$select public.create_free_community('Grátis indevida', 'x', 'dumbbell', 'everyone', 'free-key-0000008')$$,
  'FREE_BENEFIT_ALREADY_USED', '06: backfill realmente bloqueia a criação gratuita'
);
select pg_temp.as_user('07');
select throws_ok(
  $$select public.create_free_community('Grátis indevida', 'x', 'dumbbell', 'everyone', 'free-key-0000009')$$,
  'FREE_BENEFIT_ALREADY_USED', '07: idem, via sinal de ledger'
);

select * from finish();
rollback;
