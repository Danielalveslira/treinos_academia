\ir _helpers/auth_session.sql
-- F1.1 (verificação): teste pgTAP dedicado para community_covers_insert/update
-- (não cobertos por aud_has_app_access_gates_test.sql), contra o Storage real local
-- (procedimento da F0b/F1: imagem oficial storage-api, não um stub).
begin;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('9f000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','cover-'||n||'@example.invalid','unused',now(),'{}','{}',now()-interval '90 days',now()
from unnest(array['1','2','3','4','5','6']) as n;
-- 1=active 2=disabled 3=deleting 4=suspended 5=banned 6=superadmin
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
  from public.legal_policy p where p.id and p.published and u.id::text like '9f000000%';
update public.users set account_status='disabled', disabled_at=now(), disabled_by='9f000000-0000-0000-0000-000000000006', disabled_reason='teste de gate (F1.1)'
  where id='9f000000-0000-0000-0000-000000000002';
update public.users set account_status='deleting' where id='9f000000-0000-0000-0000-000000000003';
update public.users set role='superadmin' where id='9f000000-0000-0000-0000-000000000006';
insert into public.account_restrictions(user_id,action,until) values
  ('9f000000-0000-0000-0000-000000000004','temporary_suspension',now()+interval '7 days'),
  ('9f000000-0000-0000-0000-000000000005','system_ban',null);
insert into public.public_profiles(user_id,username) select id,'cov'||right(id::text,1) from public.users where id::text like '9f000000%';

-- Uma comunidade por estado, cada uma de propriedade do usuário daquele estado.
insert into public.communities(id,name,created_by,owner_id) values
  ('9c0f0000-0000-0000-0000-000000000001','Cover Active','9f000000-0000-0000-0000-000000000001','9f000000-0000-0000-0000-000000000001'),
  ('9c0f0000-0000-0000-0000-000000000002','Cover Disabled','9f000000-0000-0000-0000-000000000002','9f000000-0000-0000-0000-000000000002'),
  ('9c0f0000-0000-0000-0000-000000000003','Cover Deleting','9f000000-0000-0000-0000-000000000003','9f000000-0000-0000-0000-000000000003'),
  ('9c0f0000-0000-0000-0000-000000000004','Cover Suspended','9f000000-0000-0000-0000-000000000004','9f000000-0000-0000-0000-000000000004'),
  ('9c0f0000-0000-0000-0000-000000000005','Cover Banned','9f000000-0000-0000-0000-000000000005','9f000000-0000-0000-0000-000000000005');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( '9f000000-0000-0000-0000-00000000000' || p, true)$$;

-- ===== community_covers_insert =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000001.webp')$$,
  'community_covers_insert: dono ativo permitido');
select pg_temp.as_user('2');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000002.webp')$$,
  '42501', null, 'community_covers_insert: dono desativado negado');
select pg_temp.as_user('3');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000003.webp')$$,
  '42501', null, 'community_covers_insert: dono em exclusao negado');
select pg_temp.as_user('4');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000004.webp')$$,
  '42501', null, 'community_covers_insert: dono suspenso negado');
select pg_temp.as_user('5');
select throws_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000005.webp')$$,
  '42501', null, 'community_covers_insert: dono banido negado');
select pg_temp.as_user('6');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000002.webp')$$,
  'community_covers_insert: superadmin insere capa em comunidade de dono desativado (comportamento existente)');
reset role;

-- ===== community_covers_update (usa as capas já inseridas: 001 por '1', 002 por '6'/superadmin) =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$update storage.objects set metadata='{"touched":true}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000001.webp'$$,
  'community_covers_update: dono ativo permitido');
select pg_temp.as_user('2');
select results_eq(
  $$update storage.objects set metadata='{"touched":true}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000002.webp' returning 1$$,
  $$select 1 where false$$, 'community_covers_update: dono desativado -- 0 linhas afetadas (RLS filtra silenciosamente)');
select pg_temp.as_user('6');
select lives_ok($$update storage.objects set metadata='{"touched":true}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000002.webp'$$,
  'community_covers_update: superadmin atualiza capa de comunidade de dono desativado (comportamento existente)');
reset role;

-- ===== Mesmo objeto, dono deixado negativo por completude: deleting/suspended/banned no update =====
set local role authenticated;
select pg_temp.as_user('6');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000003.webp')$$,
  'setup: superadmin cria capa para o teste de UPDATE em comunidade de dono em exclusao');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000004.webp')$$,
  'setup: idem, suspenso');
select lives_ok($$insert into storage.objects (bucket_id, name) values ('community-covers', '9c0f0000-0000-0000-0000-000000000005.webp')$$,
  'setup: idem, banido');
select pg_temp.as_user('3');
select results_eq($$update storage.objects set metadata='{"x":1}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000003.webp' returning 1$$,
  $$select 1 where false$$, 'community_covers_update: dono em exclusao -- 0 linhas afetadas');
select pg_temp.as_user('4');
select results_eq($$update storage.objects set metadata='{"x":1}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000004.webp' returning 1$$,
  $$select 1 where false$$, 'community_covers_update: dono suspenso -- 0 linhas afetadas');
select pg_temp.as_user('5');
select results_eq($$update storage.objects set metadata='{"x":1}'::jsonb where bucket_id='community-covers' and name='9c0f0000-0000-0000-0000-000000000005.webp' returning 1$$,
  $$select 1 where false$$, 'community_covers_update: dono banido -- 0 linhas afetadas');
reset role;

select * from finish();
rollback;
