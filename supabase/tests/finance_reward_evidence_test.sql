\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Regressão corrigida por 20261124000001_finance_activity_reward_fix.sql: a migration anterior
-- (20261112000005) passou a exigir um crédito do MESMO dia por workout_completed/post_published/
-- comment_posted antes de pagar daily_activity -- quem só usa o app (navega, treina sem registrar
-- nada novo, vota) nunca mais recebia os 3 EvoCoins de atividade, e o mesmo gate silenciosamente
-- endureceu o "dia ativo" usado pela elegibilidade de criação de comunidade. Os cenários A-D abaixo
-- travam o comportamento restaurado: só tempo + checkpoints reais, nenhuma ação alheia.

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('f5000000-0000-0000-0000-00000000000' || n)::uuid,'authenticated','authenticated',
       'evidence-' || n || '@example.invalid','x',now(),'{}','{}',now(),now()
from unnest(array['1','2','3','4','5']) as n;

create or replace function pg_temp.u(n text) returns uuid language sql as
  $$select ('f5000000-0000-0000-0000-00000000000' || n)::uuid$$;
create or replace function pg_temp.coins(n text) returns int language sql as
  $$select coalesce((select coin_balance from public.wallets where user_id = pg_temp.u(n)), 0)$$;

-- ===== A: uso genuíno (tempo + checkpoints reais), ZERO ação de negócio alheia no dia =====
-- Pré-condição já no limiar (1800s/5 checkpoints) imita quem navegou o app por 30 min reais;
-- a chamada abaixo soma o próximo intervalo real (3 min, >= o mínimo de 60s entre checkpoints).
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000001',true);
insert into public.community_creation_activity_days(user_id,activity_date,qualified_seconds,qualified,checkpoints_count,last_checkpoint_at)
values('f5000000-0000-0000-0000-000000000001',private.sp_today(),1800,false,5,now()-interval '3 minutes');
select is(public.register_qualified_activity()->>'granted','true','uso genuíno sem nenhuma ação de negócio paga a atividade (regressão corrigida)');
select is((select qualified from public.community_creation_activity_days where user_id=auth.uid()),true,'tempo real sozinho também volta a qualificar o dia de criação de comunidade');
select is(pg_temp.coins('1'),3,'+3 EvoCoins só por tempo de uso');
select is((select count(*)::int from public.economy_transactions where user_id=auth.uid() and reason in ('workout_completed','post_published','comment_posted')),0,
          'nenhuma ação de negócio alheia foi criada nem exigida');
select is((select count(*)::int from public.economy_transactions where user_id=auth.uid() and reason='daily_activity'),1,'crédito de atividade persistido no ledger');
select is((select lifetime_coins_earned from public.wallets where user_id=auth.uid()),3,'persistência: lifetime também reflete o crédito');

-- ===== B: piso antifraude -- tempo suficiente mas poucos checkpoints (chamada mínima/forjada) =====
-- Antes de 20261112000005, dois checkpoints bem posicionados já bastavam para fechar 30 min
-- (cada intervalo soma até 20 min). O piso de checkpoints evita que o mínimo viável de chamadas
-- substitua presença real, sem depender de uma ação de negócio sem relação com o tempo de uso.
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000002',true);
insert into public.community_creation_activity_days(user_id,activity_date,qualified_seconds,qualified,checkpoints_count,last_checkpoint_at)
values('f5000000-0000-0000-0000-000000000002',private.sp_today(),1800,false,2,now()-interval '3 minutes');
select is(public.register_qualified_activity()->>'granted','false','tempo suficiente com poucos checkpoints não paga (piso antifraude)');
select is(pg_temp.coins('2'),0,'nenhum crédito com o piso de checkpoints não atingido');
select is((select count(*)::int from public.economy_transactions where user_id=auth.uid()),0,'nenhuma linha de ledger criada');

-- ===== C: dia ativo (criação de comunidade) restaurado independente do crédito de coins =====
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000003',true);
insert into public.community_creation_activity_days(user_id,activity_date,qualified_seconds,qualified,checkpoints_count,last_checkpoint_at)
values('f5000000-0000-0000-0000-000000000003',private.sp_today(),550,false,2,now()-interval '3 minutes');
create temp table scenario_c as select public.register_qualified_activity() as result;
select is((select result->>'granted' from scenario_c),'false','730s ainda não fecha os 30 min de recompensa de coins');
select is((select result->>'dayQualified' from scenario_c),'true','mas já qualifica o dia ativo (10 min), sem nenhuma ação alheia');

-- ===== D: uma aba aberta sem navegar (1 único ping) não prova nada -- nem antes nem depois =====
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000004',true);
select is(public.register_qualified_activity()->>'granted','false','1º ping do dia nunca soma tempo: app aberto sozinho não paga');
select is((select qualified_seconds from public.community_creation_activity_days where user_id=auth.uid() and activity_date=private.sp_today()),0,'1º ping não credita segundos');
select is(pg_temp.coins('4'),0,'nenhum crédito com uma única chamada');

-- ===== Mantido: evidência de recurso real para post/comentário/treino/foto (sem relação com o bug) =====
select pg_temp.set_test_user('f5000000-0000-0000-0000-000000000005',true);
select is(private.post_is_rewardable(jsonb_populate_record(null::public.statuses,'{"type":"photo","photo_path":"missing.webp"}')),false,'missing storage media not rewardable');
select is(private.post_is_rewardable(jsonb_populate_record(null::public.statuses,'{"type":"workout","author_id":"f5000000-0000-0000-0000-000000000005","workout_date":"2026-10-23T12:00:00Z"}')),false,'nonexistent workout not rewardable');
insert into public.communities(id,name,created_by,owner_id) values('f5000000-0000-0000-0000-000000000010','Evidence community',auth.uid(),auth.uid());
insert into public.community_members(community_id,user_id) values('f5000000-0000-0000-0000-000000000010',auth.uid());
insert into public.statuses(id,community_id,author_id,type,text) values
('f5000000-0000-0000-0000-000000000020','f5000000-0000-0000-0000-000000000010',auth.uid(),'text','Hoje fiz um treino consistente de pernas e corrida'),
('f5000000-0000-0000-0000-000000000021','f5000000-0000-0000-0000-000000000010',auth.uid(),'text','Hoje fiz um treino consistente de pernas e corrida');
update public.economy_pending_awards set due_at=now()-interval '1 second' where user_id=auth.uid();
select private.settle_pending_awards();
select is((select count(*)::int from public.economy_transactions where user_id=auth.uid() and reason='post_published'),1,'repeated content rewarded once across resource IDs');
select is((select sum(amount)::int from public.economy_transactions where user_id=auth.uid()),1,'one real post, independent of the activity engine');
update public.users set account_status='disabled' where id=auth.uid();
select is(private.award_evocoins(auth.uid(),'support_received','blocked-direct','test','blocked')->>'reason','account_unavailable','central engine revalidates account access');
update public.users set role='superadmin' where id=auth.uid();
select is(private.award_evocoins(auth.uid(),'support_received','allowed-admin','test','allowed')->>'awardedCoins','1','existing superadmin standing exception preserved');

select * from finish();
rollback;
