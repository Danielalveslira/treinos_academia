\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('fa100000-0000-0000-0000-000000000001','authenticated','authenticated','community-owner-aud@example.invalid','unused',now(),'{}','{}',now(),now()),
('fa100000-0000-0000-0000-000000000002','authenticated','authenticated','community-admin-aud@example.invalid','unused',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='fa100000-0000-0000-0000-000000000002';
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and p.published and u.id::text like 'fa100000-%';
insert into public.communities(id,name,created_by,owner_id) values ('fa200000-0000-0000-0000-000000000001','Promoção protegida','fa100000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) values ('fa200000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001');
select public._wallet_credit_cash('fa100000-0000-0000-0000-000000000001',300);
set local role authenticated;
select pg_temp.set_test_user('fa100000-0000-0000-0000-000000000001',true);
select throws_ok($q$update public.communities set promoted=true where id='fa200000-0000-0000-0000-000000000001'$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','dono não fabrica promoção');
select throws_ok($q$update public.communities set promoted_until=now()+interval '1 year' where id='fa200000-0000-0000-0000-000000000001'$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','dono não forja prazo');
select throws_ok($q$update public.communities set active_promotion_id=gen_random_uuid() where id='fa200000-0000-0000-0000-000000000001'$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','dono não forja vínculo');
select throws_ok($q$insert into public.communities(id,name,created_by,owner_id,promoted) values ('fa200000-0000-0000-0000-000000000001','ataque','fa100000-0000-0000-0000-000000000001','fa100000-0000-0000-0000-000000000001',true) on conflict(id) do update set promoted=excluded.promoted$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','UPSERT não burla guard');
select lives_ok($q$update public.communities set name='Comunidade editada',description='Edição legítima',post_access='admins' where id='fa200000-0000-0000-0000-000000000001'$q$,'edição normal preservada');
select lives_ok($q$select public.create_promotion('community','fa200000-0000-0000-0000-000000000001','community_boost_7d','aud:community-paid')$q$,'promoção paga de comunidade funciona');
select is((select cash_balance::int from public.wallets where user_id='fa100000-0000-0000-0000-000000000001'),200,'debita 100 EvoCash');
select ok((select promoted and active_promotion_id is not null and promoted_until>now() from public.communities where id='fa200000-0000-0000-0000-000000000001'),'flags pagas persistem');
select throws_ok($q$update public.communities set promoted=false,promoted_until=null,active_promotion_id=null where id='fa200000-0000-0000-0000-000000000001'$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','cliente não cancela direto');
select lives_ok($q$select public.cancel_promotion((select active_promotion_id from public.communities where id='fa200000-0000-0000-0000-000000000001'),null)$q$,'cancelamento pela RPC continua');
select ok((select not promoted and active_promotion_id is null and promoted_until is null from public.communities where id='fa200000-0000-0000-0000-000000000001'),'cancelamento limpa flags');
select pg_temp.set_test_user('fa100000-0000-0000-0000-000000000002',true);
select throws_ok($q$insert into public.communities(name,created_by,promoted) values ('Admin forjado','fa100000-0000-0000-0000-000000000002',true)$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','admin autenticado também não forja INSERT');
select lives_ok($q$insert into public.communities(name,created_by) values ('Admin legítimo','fa100000-0000-0000-0000-000000000002')$q$,'criação administrativa legítima preservada');
select throws_ok($q$update public.communities set promoted=true where id='fa200000-0000-0000-0000-000000000001'$q$,'42501','COMMUNITY_PROMOTION_SERVER_ONLY','admin autenticado não forja UPDATE');
reset role;
select is((select count(*)::int from public.economy_transactions where user_id='fa100000-0000-0000-0000-000000000001' and reason='promotion_purchase'),1,'cobrança auditada uma vez');
select * from finish();
rollback;
