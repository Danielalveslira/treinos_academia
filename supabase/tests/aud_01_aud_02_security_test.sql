\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
-- Somente banco local/homologação; dados sintéticos e rollback integral.
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
 raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('f1000000-0000-0000-0000-00000000000' || n)::uuid, 'authenticated', 'authenticated',
 'aud-' || n || '@example.invalid', 'unused', now(), '{}', '{}', now(), now()
from generate_series(1,5) n;
update public.users set username = 'aud_' || right(id::text,1) where id::text like 'f1000000-%';
update public.users set created_at = now() - interval '1 year' where id = 'f1000000-0000-0000-0000-000000000001';
update auth.users set created_at = now() - interval '1 year' where id = 'f1000000-0000-0000-0000-000000000001';
update public.users set role = 'superadmin' where id = 'f1000000-0000-0000-0000-000000000005';
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
 legal_acceptance_accepted_at = now() from public.legal_policy p where p.id and p.published and u.id::text like 'f1000000-%';
insert into public.public_profiles(user_id,username) select id,username from public.users where id::text like 'f1000000-%';
insert into public.usernames(user_id,username) select id,username from public.users where id::text like 'f1000000-%';
select public._wallet_credit_cash('f1000000-0000-0000-0000-000000000003',40);
select public._ledger_record('f1000000-0000-0000-0000-000000000003','aud:cash','cash','credit',40,'cash_purchase_confirmed','cash_purchase','aud');
insert into public.communities(id,name,created_by,owner_id) values
 ('f2000000-0000-0000-0000-000000000001','AUD permitida','f1000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001'),
 ('f2000000-0000-0000-0000-000000000002','AUD proibida','f1000000-0000-0000-0000-000000000004','f1000000-0000-0000-0000-000000000004');
insert into public.community_members(community_id,user_id) select 'f2000000-0000-0000-0000-000000000001',
 ('f1000000-0000-0000-0000-00000000000' || n)::uuid from generate_series(1,3) n;

select public._wallet_credit_cash('f1000000-0000-0000-0000-000000000001',100);
select public._wallet_credit_coins('f1000000-0000-0000-0000-000000000002',100);
select pg_temp.cash_purchase_fixture('f1000000-0000-0000-0000-000000000004');

-- AUD-01: contas antiga, recente limpa e recente com saldo/ledger, mesmo resultado.
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000001',true);
select throws_ok('select public.delete_own_account()', '42501', null, 'conta antiga: RPC negada');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000002',true);
select throws_ok('select public.delete_own_account()', '42501', null, 'conta recente limpa: rollback desativado');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000003',true);
select throws_ok('select public.delete_own_account()', '42501', null, 'conta recente financeira: RPC negada');
select throws_ok('delete from auth.users', '42501', null, 'Auth: DELETE direto negado');
select throws_ok('delete from public.users', '42501', null, 'perfil: DELETE direto negado');
select throws_ok('delete from public.public_profiles', '42501', null, 'perfil público: DELETE negado');
select throws_ok('delete from public.usernames', '42501', null, 'reserva de nome: DELETE negado');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000004',true);
select throws_ok('select public.delete_own_account()', '42501', null, 'conta recente com compra pendente não chama rollback');
set local role anon;
select throws_ok('select public.delete_own_account()', '42501', null, 'anon não chama rollback');
set local role service_role;
select throws_ok('select public.delete_own_account()', '42501', null, 'service_role usa worker oficial, sem rollback');
set local role anon;
select pg_temp.set_test_user('',true);
select throws_ok($q$insert into public.statuses(community_id,author_id,type,text) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','anon')$q$,'42501',null,'anon não cria publicação');
reset role;
select is((select count(*)::int from auth.users where id::text like 'f1000000-%'),5,'nenhuma identidade apagada');
select is((select count(*)::int from public.users where id::text like 'f1000000-%'),5,'nenhum perfil apagado');
select is((select cash_balance::int from public.wallets where user_id = 'f1000000-0000-0000-0000-000000000003'),40,'saldo preservado');

-- AUD-02: sessão real de papel SQL, não apenas auth.uid() executando como postgres.
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000001',true);
select lives_ok($q$insert into public.statuses(id,community_id,author_id,type,text) values
 ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','legítima')$q$,'publicação legítima');
select is((select author_username from public.statuses where id='f3000000-0000-0000-0000-000000000001'),'aud_1','nome derivado no banco');
select ok((select not promoted and promoted_until is null and active_promotion_id is null
 and positive_vote_count=0 and negative_vote_count=0 and comment_count=0 and not author_is_superadmin
 from public.statuses where id='f3000000-0000-0000-0000-000000000001'),'metadados iniciais seguros');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,promoted) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',true)$q$, '42501', null, 'INSERT promoted: negado');
select throws_ok($q$update public.statuses set promoted=true where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE promoted: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,promoted) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',true) on conflict(id) do update set promoted=excluded.promoted$q$, '42501', null, 'UPSERT promoted: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,promoted_until) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year')$q$, '42501', null, 'INSERT promoted_until: negado');
select throws_ok($q$update public.statuses set promoted_until=now()+interval '1 year' where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE promoted_until: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,promoted_until) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year') on conflict(id) do update set promoted_until=excluded.promoted_until$q$, '42501', null, 'UPSERT promoted_until: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,active_promotion_id) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','f4000000-0000-0000-0000-000000000001'::uuid)$q$, '42501', null, 'INSERT active_promotion_id: negado');
select throws_ok($q$update public.statuses set active_promotion_id='f4000000-0000-0000-0000-000000000001'::uuid where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE active_promotion_id: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,active_promotion_id) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','f4000000-0000-0000-0000-000000000001'::uuid) on conflict(id) do update set active_promotion_id=excluded.active_promotion_id$q$, '42501', null, 'UPSERT active_promotion_id: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,positive_vote_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999)$q$, '42501', null, 'INSERT positive_vote_count: negado');
select throws_ok($q$update public.statuses set positive_vote_count=999 where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE positive_vote_count: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,positive_vote_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999) on conflict(id) do update set positive_vote_count=excluded.positive_vote_count$q$, '42501', null, 'UPSERT positive_vote_count: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,negative_vote_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999)$q$, '42501', null, 'INSERT negative_vote_count: negado');
select throws_ok($q$update public.statuses set negative_vote_count=999 where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE negative_vote_count: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,negative_vote_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999) on conflict(id) do update set negative_vote_count=excluded.negative_vote_count$q$, '42501', null, 'UPSERT negative_vote_count: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,comment_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999)$q$, '42501', null, 'INSERT comment_count: negado');
select throws_ok($q$update public.statuses set comment_count=999 where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE comment_count: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,comment_count) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',999) on conflict(id) do update set comment_count=excluded.comment_count$q$, '42501', null, 'UPSERT comment_count: negado');
select lives_ok($q$insert into public.statuses(id,community_id,author_id,type,text,author_username) values ('f3000000-0000-0000-0000-000000000011','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','forjado')$q$, 'INSERT author_username legado: sobrescrito');
select is((select author_username from public.statuses where id='f3000000-0000-0000-0000-000000000011'),'aud_1','nome falso substituído pelo nome real');
select throws_ok($q$update public.statuses set author_username='forjado' where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE author_username: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,author_username) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','forjado') on conflict(id) do update set author_username=excluded.author_username$q$, '42501', null, 'UPSERT author_username: negado');
select lives_ok($q$insert into public.statuses(id,community_id,author_id,type,text,author_is_superadmin) values ('f3000000-0000-0000-0000-000000000012','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',true)$q$, 'INSERT author_is_superadmin legado: sobrescrito');
select is((select author_is_superadmin from public.statuses where id='f3000000-0000-0000-0000-000000000012'),false,'selo falso substituído pelo papel real');
select throws_ok($q$update public.statuses set author_is_superadmin=true where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE author_is_superadmin: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,author_is_superadmin) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',true) on conflict(id) do update set author_is_superadmin=excluded.author_is_superadmin$q$, '42501', null, 'UPSERT author_is_superadmin: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,created_at) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year')$q$, '42501', null, 'INSERT created_at: negado');
select throws_ok($q$update public.statuses set created_at=now()+interval '1 year' where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE created_at: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,created_at) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year') on conflict(id) do update set created_at=excluded.created_at$q$, '42501', null, 'UPSERT created_at: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,expires_at) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year')$q$, '42501', null, 'INSERT expires_at: negado');
select throws_ok($q$update public.statuses set expires_at=now()+interval '1 year' where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE expires_at: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,expires_at) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque',now()+interval '1 year') on conflict(id) do update set expires_at=excluded.expires_at$q$, '42501', null, 'UPSERT expires_at: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,retention_mode) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','no_auto_expiration')$q$, '42501', null, 'INSERT retention_mode: negado');
select throws_ok($q$update public.statuses set retention_mode='no_auto_expiration' where id='f3000000-0000-0000-0000-000000000001'$q$, '42501', null, 'UPDATE retention_mode: negado');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text,retention_mode) values ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','ataque','no_auto_expiration') on conflict(id) do update set retention_mode=excluded.retention_mode$q$, '42501', null, 'UPSERT retention_mode: negado');
select throws_ok($q$insert into public.statuses(community_id,author_id,type,text) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002','text','outra autoria')$q$,'42501',null,'autoria alheia negada');
select throws_ok($q$insert into public.statuses(community_id,author_id,type,text) values
 ('f2000000-0000-0000-0000-000000000002','f1000000-0000-0000-0000-000000000001','text','comunidade proibida')$q$,'42501',null,'comunidade sem filiação negada');
select throws_ok($q$insert into public.statuses(id,community_id,author_id,type,text) values
 ('f3000000-0000-0000-0000-000000000001','f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','text','upsert conteúdo') on conflict(id) do update set text=excluded.text$q$,'42501',null,'UPSERT somente conteúdo também não contorna UPDATE');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000002',true);
select throws_ok($q$update public.statuses set text='alterado' where id='f3000000-0000-0000-0000-000000000001'$q$,'42501',null,'UPDATE post alheio negado');
reset role;
-- Política post_access permanece efetiva com a allowlist.
reset role;
update public.communities set post_access='admins' where id='f2000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000002',true);
select throws_ok($q$insert into public.statuses(community_id,author_id,type,text) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000002','text','membro sem permissão')$q$,'42501',null,'membro não publica quando post_access=admins');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000001',true);
select lives_ok($q$insert into public.statuses(community_id,author_id,type,poll_question,poll_options) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','poll','Pergunta?','[{"id":"0","label":"A"},{"id":"1","label":"B"}]')$q$,'dono publica enquete em comunidade admins');
select lives_ok($q$insert into public.statuses(community_id,author_id,type,workout_title,workout_date,workout_location) values
 ('f2000000-0000-0000-0000-000000000001','f1000000-0000-0000-0000-000000000001','workout','Treino',now()+interval '1 day','Academia')$q$,'publicação de treino legítima');
reset role;
update public.communities set post_access='everyone' where id='f2000000-0000-0000-0000-000000000001';
-- Fluxos autorizados atualizam metadados mesmo quando authenticated não tem UPDATE direto.
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000002',true);
select lives_ok($q$select public.cast_vote('f3000000-0000-0000-0000-000000000001',1::smallint)$q$,'voto autorizado atualiza contador');
select is((select positive_vote_count from public.statuses where id='f3000000-0000-0000-0000-000000000001'),1,'contador de voto legítimo');
select lives_ok($q$select public.comment_create('f3000000-0000-0000-0000-000000000001',null,'Comentário legítimo','f5000000-0000-0000-0000-000000000001')$q$,'comentário autorizado');
select is((select comment_count from public.statuses where id='f3000000-0000-0000-0000-000000000001'),1,'contador de comentário legítimo');
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000001',true);
select lives_ok($q$select public.create_promotion('post','f3000000-0000-0000-0000-000000000001','post_boost_3d','aud:promo1')$q$,'promoção paga autorizada');
select is((select cash_balance::int from public.wallets where user_id='f1000000-0000-0000-0000-000000000001'),75,'promoção debita EvoCash');
select ok((select promoted and active_promotion_id is not null and promoted_until>now() from public.statuses where id='f3000000-0000-0000-0000-000000000001'),'promoção paga persiste');
select throws_ok($q$update public.statuses set promoted=false where id='f3000000-0000-0000-0000-000000000001'$q$,'42501',null,'cliente não altera promoção paga');
select lives_ok($q$select public.cancel_promotion((select active_promotion_id from public.statuses where id='f3000000-0000-0000-0000-000000000001'),null)$q$,'titular cancela pela RPC');
select lives_ok($q$select public.create_promotion('post','f3000000-0000-0000-0000-000000000001','post_boost_3d','aud:promo2')$q$,'nova promoção exige novo pagamento');
select is((select cash_balance::int from public.wallets where user_id='f1000000-0000-0000-0000-000000000001'),50,'renovação cobra novamente');
reset role;
select is((select count(*)::int from public.economy_transactions where user_id='f1000000-0000-0000-0000-000000000001' and reason='promotion_purchase'),2,'duas cobranças auditadas');
-- Admin authenticated sem filiação não lê post; id da promoção vem da operação administrativa.
create temp table aud_promo as select active_promotion_id id from public.statuses where id='f3000000-0000-0000-0000-000000000001';
grant select on aud_promo to authenticated;
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000005',true);
select lives_ok($q$select public.cancel_promotion((select id from aud_promo),'Moderação de teste')$q$,'admin cancela por RPC com motivo');
select ok((select not promoted and positive_vote_count=1 and comment_count=1 from public.statuses where id='f3000000-0000-0000-0000-000000000001'),'moderação conserva contadores');
reset role;
-- grant service_role e RPCs definer não foram removidos.
select ok(has_table_privilege('service_role','public.statuses','UPDATE'),'serviço conserva UPDATE');
select ok(has_function_privilege('service_role','public.run_deletion_job(uuid)','EXECUTE'),'worker conserva execução');
set local role authenticated;
select pg_temp.set_test_user('f1000000-0000-0000-0000-000000000005',true);
select lives_ok($q$select public.queue_deletion('account','f1000000-0000-0000-0000-000000000003')$q$,'admin enfileira pedido oficial do titular');
reset role;
create temp table aud_job as select id from public.deletion_jobs where target_id='f1000000-0000-0000-0000-000000000003';
grant select on aud_job to service_role;
set local role service_role;
select is(public.run_deletion_job((select id from aud_job))->>'blocked','true','worker bloqueia pendência financeira');
reset role;
select is((select state from public.deletion_jobs where target_id='f1000000-0000-0000-0000-000000000003'),'blocked_financial_review','trilha financeira preservada');
select ok(exists(select 1 from public.users where id='f1000000-0000-0000-0000-000000000003'),'perfil financeiro preservado após worker');
select is((select text from public.statuses where id='f3000000-0000-0000-0000-000000000001'),'legítima','ataques não alteram conteúdo existente');
select * from finish();
rollback;
