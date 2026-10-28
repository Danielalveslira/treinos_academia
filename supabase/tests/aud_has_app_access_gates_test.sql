\ir _helpers/auth_session.sql
-- F1 (2026-11-05_close_has_app_access_gates): valida que cada objeto do achado P18 nega
-- corretamente conta disabled/deleting/suspensa/banida e permite conta ativa e superadmin,
-- e que o mínimo da decisão do responsável (notices, support_requests, leitura da própria
-- linha) continua liberado mesmo bloqueado. Também valida P20 (search_path de cast_vote e
-- create_promotion) via os dois testes de invariante já existentes.
begin;
insert into public.professional_listing_limits(kind,max_per_owner)values('professional',10),('space',10) on conflict(kind)do update set max_per_owner=10;

select no_plan();

-- ===== Fixture: 7 contas em cada estado relevante, 1 comunidade compartilhada (C1) =====
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('9a000000-0000-0000-0000-00000000000'||n)::uuid,'authenticated','authenticated','gate-'||n||'@example.invalid','unused',now(),'{}','{}',now()-interval '90 days',now()
from unnest(array['1','2','3','4','5','6','7']) as n;
-- 1=active 2=disabled 3=deleting 4=suspended(temp) 5=banned(system_ban) 6=superadmin 7=other(active)
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
  from public.legal_policy p where p.id and p.published and u.id::text like '9a000000%';
update public.users set account_status='disabled', disabled_at=now(), disabled_by='9a000000-0000-0000-0000-000000000006', disabled_reason='teste de gate (F1)'
  where id='9a000000-0000-0000-0000-000000000002';
update public.users set account_status='deleting' where id='9a000000-0000-0000-0000-000000000003';
update public.users set role='superadmin' where id='9a000000-0000-0000-0000-000000000006';
insert into public.account_restrictions(user_id,action,until) values
  ('9a000000-0000-0000-0000-000000000004','temporary_suspension',now()+interval '7 days'),
  ('9a000000-0000-0000-0000-000000000005','system_ban',null);
insert into public.public_profiles(user_id,username) select id,'gate'||right(id::text,1) from public.users where id::text like '9a000000%';
select public._wallet_credit_coins(('9a000000-0000-0000-0000-00000000000'||n)::uuid, 5000) from unnest(array['1','2','3','4','5','6','7']) as n;
select public._wallet_credit_cash(('9a000000-0000-0000-0000-00000000000'||n)::uuid, 5000) from unnest(array['1','2','3','4','5','6','7']) as n;

insert into public.communities(id,name,created_by,owner_id) values
  ('9b000000-0000-0000-0000-000000000001','Gate C1','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id)
  select '9b000000-0000-0000-0000-000000000001', ('9a000000-0000-0000-0000-00000000000'||n)::uuid from unnest(array['1','2','3','4','5','6','7']) as n;

-- Uma comunidade por estado bloqueado + uma ativa, para os braços de "dono"
-- (communities_update, community_covers_*, statuses_delete/comment_delete por moderação).
insert into public.communities(id,name,created_by,owner_id) values
  ('9b000000-0000-0000-0000-000000000011','Gate Owner Active','9a000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001'),
  ('9b000000-0000-0000-0000-000000000012','Gate Owner Disabled','9a000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000002'),
  ('9b000000-0000-0000-0000-000000000013','Gate Owner Deleting','9a000000-0000-0000-0000-000000000003','9a000000-0000-0000-0000-000000000003'),
  ('9b000000-0000-0000-0000-000000000014','Gate Owner Suspended','9a000000-0000-0000-0000-000000000004','9a000000-0000-0000-0000-000000000004'),
  ('9b000000-0000-0000-0000-000000000015','Gate Owner Banned','9a000000-0000-0000-0000-000000000005','9a000000-0000-0000-0000-000000000005');
insert into public.community_members(community_id,user_id)
  select ('9b000000-0000-0000-0000-00000000001'||n)::uuid, ('9a000000-0000-0000-0000-00000000000'||n)::uuid from unnest(array['1','2','3','4','5']) as n;
insert into public.community_members(community_id,user_id) values
  ('9b000000-0000-0000-0000-000000000011','9a000000-0000-0000-0000-000000000007'),
  ('9b000000-0000-0000-0000-000000000012','9a000000-0000-0000-0000-000000000007'),
  ('9b000000-0000-0000-0000-000000000013','9a000000-0000-0000-0000-000000000007'),
  ('9b000000-0000-0000-0000-000000000014','9a000000-0000-0000-0000-000000000007'),
  ('9b000000-0000-0000-0000-000000000015','9a000000-0000-0000-0000-000000000007');

-- Um status de '7' (sempre ativo) em cada comunidade-dono, para o dono moderar/apagar.
insert into public.statuses(id,community_id,author_id,type,text) values
  ('9c000000-0000-0000-0000-000000000011','9b000000-0000-0000-0000-000000000011','9a000000-0000-0000-0000-000000000007','text','para moderar (active)'),
  ('9c000000-0000-0000-0000-000000000012','9b000000-0000-0000-0000-000000000012','9a000000-0000-0000-0000-000000000007','text','para moderar (disabled)'),
  ('9c000000-0000-0000-0000-000000000013','9b000000-0000-0000-0000-000000000013','9a000000-0000-0000-0000-000000000007','text','para moderar (deleting)'),
  ('9c000000-0000-0000-0000-000000000014','9b000000-0000-0000-0000-000000000014','9a000000-0000-0000-0000-000000000007','text','para moderar (suspended)'),
  ('9c000000-0000-0000-0000-000000000015','9b000000-0000-0000-0000-000000000015','9a000000-0000-0000-0000-000000000007','text','para moderar (banned)');
-- Um segundo status de '7' por comunidade-dono, dedicado só ao teste de comment_delete
-- (separado do de statuses_delete acima, que é apagado por aquele teste e não pode ser
-- reaproveitado aqui).
insert into public.statuses(id,community_id,author_id,type,text) values
  ('9c000000-0000-0000-0000-000000000041','9b000000-0000-0000-0000-000000000011','9a000000-0000-0000-0000-000000000007','text','post com comentario (active)'),
  ('9c000000-0000-0000-0000-000000000042','9b000000-0000-0000-0000-000000000012','9a000000-0000-0000-0000-000000000007','text','post com comentario (disabled)'),
  ('9c000000-0000-0000-0000-000000000043','9b000000-0000-0000-0000-000000000013','9a000000-0000-0000-0000-000000000007','text','post com comentario (deleting)'),
  ('9c000000-0000-0000-0000-000000000044','9b000000-0000-0000-0000-000000000014','9a000000-0000-0000-0000-000000000007','text','post com comentario (suspended)'),
  ('9c000000-0000-0000-0000-000000000045','9b000000-0000-0000-0000-000000000015','9a000000-0000-0000-0000-000000000007','text','post com comentario (banned)');
-- Um comentário de '7' em cada status 41-45, para o dono moderar via comment_delete.
-- IDs explícitos (não gen_random_uuid() dentro de um select com várias linhas): o
-- planner pode tratar uma subquery lateral sem correlação como constante e reusar o
-- mesmo valor em todas as linhas, colidindo com a chave primária.
insert into public.post_comments(id,status_id,author_id,root_comment_id,body,client_request_id) values
  ('9e000000-0000-0000-0000-000000000041','9c000000-0000-0000-0000-000000000041','9a000000-0000-0000-0000-000000000007','9e000000-0000-0000-0000-000000000041','comentario para moderar',gen_random_uuid()),
  ('9e000000-0000-0000-0000-000000000042','9c000000-0000-0000-0000-000000000042','9a000000-0000-0000-0000-000000000007','9e000000-0000-0000-0000-000000000042','comentario para moderar',gen_random_uuid()),
  ('9e000000-0000-0000-0000-000000000043','9c000000-0000-0000-0000-000000000043','9a000000-0000-0000-0000-000000000007','9e000000-0000-0000-0000-000000000043','comentario para moderar',gen_random_uuid()),
  ('9e000000-0000-0000-0000-000000000044','9c000000-0000-0000-0000-000000000044','9a000000-0000-0000-0000-000000000007','9e000000-0000-0000-0000-000000000044','comentario para moderar',gen_random_uuid()),
  ('9e000000-0000-0000-0000-000000000045','9c000000-0000-0000-0000-000000000045','9a000000-0000-0000-0000-000000000007','9e000000-0000-0000-0000-000000000045','comentario para moderar',gen_random_uuid());

-- Um status de '7' em C1, para todos votarem (cast_vote) -- e um status de cada estado
-- em C1, para cada um tentar promover o próprio post (create_promotion).
insert into public.statuses(id,community_id,author_id,type,text) values
  ('9c000000-0000-0000-0000-000000000099','9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000007','text','post votavel');
insert into public.statuses(id,community_id,author_id,type,text)
  select ('9c000000-0000-0000-0000-00000000002'||n)::uuid,'9b000000-0000-0000-0000-000000000001',('9a000000-0000-0000-0000-00000000000'||n)::uuid,'text','post proprio '||n
  from unnest(array['1','2','3','4','5','6']) as n;

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( '9a000000-0000-0000-0000-00000000000' || p, true)$$;

-- ===== 0) P20: os 2 testes de invariante de search_path devem passar a verde =====
select is((select count(*)::int from pg_proc p where p.prosecdef and p.prokind = 'f'
  and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=' and c <> 'search_path=""' and c !~ 'pg_temp')),
  0, 'P20: nenhuma função SECURITY DEFINER com search_path=public isolado (cast_vote/create_promotion corrigidas)');

-- ===== 1) status_expiration_control nasce pausado via DEFAULT da coluna =====
select col_default_is('public', 'status_expiration_control', 'enabled', 'false',
  'status_expiration_control.enabled tem DEFAULT false (nasce pausado por definição de coluna, não por acidente de ordem de migrations)');

-- ===== 2) authenticated não insere expires_at em public.statuses (42501) =====
set local role authenticated;
select pg_temp.as_user('1');
select throws_ok(
  $$insert into public.statuses (community_id, author_id, type, text, expires_at) values ('9b000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000001','text','x',now())$$,
  '42501', null, 'authenticated nao tem privilegio de coluna para definir expires_at em public.statuses');
reset role;

-- ===== 3) set_username (F1.2: gate agora e private.has_account_standing(), nao
--    has_app_access() -- ver secao 16 para a sequencia real de cadastro e a razao da
--    troca). Os codigos permanecem 'PERMISSION_DENIED' (a funcao levanta o mesmo erro
--    independente de qual helper a embasa), e os 6 estados abaixo ja cobrem a mesma
--    superficie de negacao/permissao da tarefa 5(b) para este objeto. =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.set_username('gateactive1')$$, 'set_username: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.set_username('gatedisabled')$$, 'PERMISSION_DENIED', 'set_username: disabled negada');
select pg_temp.as_user('3');
select throws_ok($$select public.set_username('gatedeleting')$$, 'PERMISSION_DENIED', 'set_username: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.set_username('gatesuspended')$$, 'PERMISSION_DENIED', 'set_username: suspensao temporaria negada');
select pg_temp.as_user('5');
select throws_ok($$select public.set_username('gatebanned')$$, 'PERMISSION_DENIED', 'set_username: banida (system_ban) negada');
select pg_temp.as_user('6');
select lives_ok($$select public.set_username('gatesuper1')$$, 'set_username: superadmin permitida (comportamento existente)');
reset role;

-- ===== 4) update_user_profile =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.update_user_profile('{"bio":"ok"}'::jsonb)$$, 'update_user_profile: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED', 'update_user_profile: disabled negada');
select pg_temp.as_user('3');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED', 'update_user_profile: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED', 'update_user_profile: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED', 'update_user_profile: banida negada');
select pg_temp.as_user('6');
select lives_ok($$select public.update_user_profile('{"bio":"ok"}'::jsonb)$$, 'update_user_profile: superadmin permitida');
reset role;

-- ===== 5) create_professional_listing (usage_profile elegivel: 'professional') =====
update public.users set usage_profile='professional' where id::text like '9a000000%';
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'create_professional_listing: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'APP_ACCESS_DENIED', 'create_professional_listing: disabled negada');
select pg_temp.as_user('3');
select throws_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'APP_ACCESS_DENIED', 'create_professional_listing: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'APP_ACCESS_DENIED', 'create_professional_listing: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'APP_ACCESS_DENIED', 'create_professional_listing: banida negada');
select pg_temp.as_user('6');
select lives_ok($$select public.create_professional_listing('professional',gen_random_uuid())$$, 'create_professional_listing: superadmin permitida');
reset role;

-- ===== 6) save_professional_listing_draft (usa a listing recem-criada de cada um) =====
create temp table listing_of(n text, id uuid);
insert into listing_of select n, id from public.professional_listings pl, unnest(array['1','6']) n
  where pl.owner_id = ('9a000000-0000-0000-0000-00000000000'||n)::uuid;
grant all on listing_of to public;
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.save_professional_listing_draft((select id from listing_of where n='1'),
  '{"kind":"professional","displayName":"Gate Teste","categoryKey":"personal_trainer","modalityKeys":["musculacao"],"bio":"bio valida aqui com conteudo suficiente","city":"Sao Paulo","uf":"SP","serviceMode":"online"}'::jsonb,0)$$,
  'save_professional_listing_draft: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.save_professional_listing_draft(gen_random_uuid(), '{}'::jsonb,0)$$, 'APP_ACCESS_DENIED', 'save_professional_listing_draft: disabled negada (antes de chegar a LISTING_NOT_FOUND)');
select pg_temp.as_user('3');
select throws_ok($$select public.save_professional_listing_draft(gen_random_uuid(), '{}'::jsonb,0)$$, 'APP_ACCESS_DENIED', 'save_professional_listing_draft: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.save_professional_listing_draft(gen_random_uuid(), '{}'::jsonb,0)$$, 'APP_ACCESS_DENIED', 'save_professional_listing_draft: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.save_professional_listing_draft(gen_random_uuid(), '{}'::jsonb,0)$$, 'APP_ACCESS_DENIED', 'save_professional_listing_draft: banida negada');
select pg_temp.as_user('6');
select lives_ok($$select public.save_professional_listing_draft((select id from listing_of where n='6'),
  '{"kind":"professional","displayName":"Gate Super","categoryKey":"coach","modalityKeys":["yoga"],"bio":"bio valida aqui com conteudo suficiente","city":"Rio","uf":"RJ","serviceMode":"online"}'::jsonb,0)$$,
  'save_professional_listing_draft: superadmin permitida');
reset role;

-- ===== 7) prepare_professional_listing_publish =====
set local role authenticated;
select pg_temp.as_user('1');
select throws_ok($$select public.prepare_professional_listing_publish((select id from listing_of where n='1'), 'gate-op-1')$$, 'EDITORIAL_REVIEW_REQUIRED',
  'prepare_professional_listing_publish: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.prepare_professional_listing_publish(gen_random_uuid(), 'gate-op-2')$$, 'APP_ACCESS_DENIED', 'prepare_professional_listing_publish: disabled negada');
select pg_temp.as_user('3');
select throws_ok($$select public.prepare_professional_listing_publish(gen_random_uuid(), 'gate-op-3')$$, 'APP_ACCESS_DENIED', 'prepare_professional_listing_publish: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.prepare_professional_listing_publish(gen_random_uuid(), 'gate-op-4')$$, 'APP_ACCESS_DENIED', 'prepare_professional_listing_publish: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.prepare_professional_listing_publish(gen_random_uuid(), 'gate-op-5')$$, 'APP_ACCESS_DENIED', 'prepare_professional_listing_publish: banida negada');
select pg_temp.as_user('6');
select throws_ok($$select public.prepare_professional_listing_publish((select id from listing_of where n='6'), 'gate-op-6')$$, 'EDITORIAL_REVIEW_REQUIRED',
  'prepare_professional_listing_publish: superadmin permitida');
reset role;

-- ===== 8) allocate_profile_avatar (+ policy profile_avatars_insert, via has_column_privilege indireto) =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.allocate_profile_avatar()$$, 'allocate_profile_avatar: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.allocate_profile_avatar()$$, 'PERMISSION_DENIED', 'allocate_profile_avatar: disabled negada');
select pg_temp.as_user('3');
select throws_ok($$select public.allocate_profile_avatar()$$, 'PERMISSION_DENIED', 'allocate_profile_avatar: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.allocate_profile_avatar()$$, 'PERMISSION_DENIED', 'allocate_profile_avatar: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.allocate_profile_avatar()$$, 'PERMISSION_DENIED', 'allocate_profile_avatar: banida negada');
select pg_temp.as_user('6');
select lives_ok($$select public.allocate_profile_avatar()$$, 'allocate_profile_avatar: superadmin permitida');
reset role;
-- Janela residual fechada: uma alocação feita ANTES do bloqueio (por '2', quando ainda
-- ativa) não autoriza mais o upload depois que a conta foi desativada.
insert into public.profile_avatar_media(id,owner_id,storage_path,state,created_at) values
  ('9a900000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000002/9a900000-0000-0000-0000-000000000002.webp','allocated',now());
set local role authenticated;
select pg_temp.as_user('2');
select throws_ok(
  $$insert into storage.objects (bucket_id, name) values ('profile-avatars', '9a000000-0000-0000-0000-000000000002/9a900000-0000-0000-0000-000000000002.webp')$$,
  '42501', null, 'profile_avatars_insert: alocacao previa nao basta -- conta desativada ainda e negada no upload');
reset role;

-- ===== 9) communities_update (braco do dono) =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$update public.communities set description='upd' where id='9b000000-0000-0000-0000-000000000011'$$, 'communities_update: dono ativo permitido');
select pg_temp.as_user('2');
select results_eq(
  $$update public.communities set description='upd' where id='9b000000-0000-0000-0000-000000000012' returning 1$$,
  $$select 1 where false$$, 'communities_update: dono desativado -- 0 linhas afetadas (RLS filtra silenciosamente)');
select pg_temp.as_user('3');
select results_eq(
  $$update public.communities set description='upd' where id='9b000000-0000-0000-0000-000000000013' returning 1$$,
  $$select 1 where false$$, 'communities_update: dono em exclusao -- 0 linhas afetadas');
select pg_temp.as_user('4');
select results_eq(
  $$update public.communities set description='upd' where id='9b000000-0000-0000-0000-000000000014' returning 1$$,
  $$select 1 where false$$, 'communities_update: dono suspenso -- 0 linhas afetadas');
select pg_temp.as_user('5');
select results_eq(
  $$update public.communities set description='upd' where id='9b000000-0000-0000-0000-000000000015' returning 1$$,
  $$select 1 where false$$, 'communities_update: dono banido -- 0 linhas afetadas');
select pg_temp.as_user('6');
select lives_ok($$update public.communities set description='upd-super' where id='9b000000-0000-0000-0000-000000000012'$$,
  'communities_update: superadmin atualiza comunidade de dono desativado (comportamento existente)');
reset role;

-- ===== 10) statuses_delete (braco de moderacao pelo dono) =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000011'$$, 'statuses_delete: dono ativo modera (apaga post de terceiro)');
select pg_temp.as_user('2');
select results_eq($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000012' returning 1$$,
  $$select 1 where false$$, 'statuses_delete: dono desativado nao modera mais -- 0 linhas');
select pg_temp.as_user('3');
select results_eq($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000013' returning 1$$,
  $$select 1 where false$$, 'statuses_delete: dono em exclusao nao modera -- 0 linhas');
select pg_temp.as_user('4');
select results_eq($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000014' returning 1$$,
  $$select 1 where false$$, 'statuses_delete: dono suspenso nao modera -- 0 linhas');
select pg_temp.as_user('5');
select results_eq($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000015' returning 1$$,
  $$select 1 where false$$, 'statuses_delete: dono banido nao modera -- 0 linhas');
select pg_temp.as_user('6');
select lives_ok($$delete from public.statuses where id='9c000000-0000-0000-0000-000000000012'$$,
  'statuses_delete: superadmin modera post em comunidade de dono desativado (comportamento existente)');
reset role;

-- ===== 11) comment_delete (braco de moderacao pelo dono, via can_moderate_status) =====
-- Usa os status 41-45 (dedicados, com comentário de '7'), não os 11-15 já apagados pela
-- seção 10 (statuses_delete).
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000041')$$,
  'comment_delete: dono ativo modera comentario de terceiro');
select pg_temp.as_user('2');
select throws_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000042')$$,
  'PERMISSION_DENIED', 'comment_delete: dono desativado nao modera comentario de terceiro');
select pg_temp.as_user('3');
select throws_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000043')$$,
  'PERMISSION_DENIED', 'comment_delete: dono em exclusao nao modera comentario de terceiro');
select pg_temp.as_user('4');
select throws_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000044')$$,
  'PERMISSION_DENIED', 'comment_delete: dono suspenso nao modera comentario de terceiro');
select pg_temp.as_user('5');
select throws_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000045')$$,
  'PERMISSION_DENIED', 'comment_delete: dono banido nao modera comentario de terceiro');
select pg_temp.as_user('6');
select lives_ok($$select public.comment_delete('9e000000-0000-0000-0000-000000000043')$$,
  'comment_delete: superadmin modera comentario em comunidade de dono em exclusao (comportamento existente)');
reset role;

-- ===== 12) cast_vote =====
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'cast_vote: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'PERMISSION_DENIED', 'cast_vote: disabled negada (achado original P18-d)');
select pg_temp.as_user('3');
select throws_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'PERMISSION_DENIED', 'cast_vote: deleting negada');
select pg_temp.as_user('4');
select throws_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'PERMISSION_DENIED', 'cast_vote: suspensao negada');
select pg_temp.as_user('5');
select throws_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'PERMISSION_DENIED', 'cast_vote: banida negada');
select pg_temp.as_user('6');
select lives_ok($$select public.cast_vote('9c000000-0000-0000-0000-000000000099', 1::smallint)$$, 'cast_vote: superadmin permitida');
reset role;

-- ===== 13) create_promotion (cada um promove o proprio post em C1) =====
-- F1.2: os 3 codigos distintos (ACCOUNT_DELETING/ACCOUNT_DISABLED/ACCOUNT_RESTRICTED) foram
-- restaurados na mesma precedencia da definicao anterior a F1 (PromoteDialog.jsx:89-90 tem
-- mensagens amigaveis mapeadas para 2 deles) -- PERMISSION_DENIED (via has_app_access(), ainda
-- presente como fallback) nao e mais o codigo esperado para nenhum destes 4 estados.
update public.community_creation_products set evocash_price = 50 where tier='essential';
set local role authenticated;
select pg_temp.as_user('1');
select lives_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000021','post_boost_3d','gate-promo-1')$$, 'create_promotion: ativa permitida');
select pg_temp.as_user('2');
select throws_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000022','post_boost_3d','gate-promo-2')$$, 'ACCOUNT_DISABLED', 'create_promotion: disabled negada com codigo distinto (F1.2 -- PromoteDialog.jsx:89)');
select pg_temp.as_user('3');
select throws_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000023','post_boost_3d','gate-promo-3')$$, 'ACCOUNT_DELETING', 'create_promotion: deleting negada com codigo distinto (F1.2)');
select pg_temp.as_user('4');
select throws_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000024','post_boost_3d','gate-promo-4')$$, 'ACCOUNT_RESTRICTED', 'create_promotion: suspensao negada com codigo distinto (F1.2 -- PromoteDialog.jsx:90)');
select pg_temp.as_user('5');
select throws_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000025','post_boost_3d','gate-promo-5')$$, 'ACCOUNT_RESTRICTED', 'create_promotion: banida negada com codigo distinto (F1.2)');
select pg_temp.as_user('6');
select lives_ok($$select public.create_promotion('post','9c000000-0000-0000-0000-000000000026','post_boost_3d','gate-promo-6')$$, 'create_promotion: superadmin permitida (comportamento existente -- has_app_access() nao faz excecao especial para superadmin alem do que a propria funcao ja concede)');
reset role;

-- ===== 14) sponsored_ads_select (leitura; braco global e braco de comunidade) =====
insert into public.sponsored_ads(id,created_by,partner_name,title,is_global,community_ids,display_mode) values
  ('9d000000-0000-0000-0000-000000000001','9a000000-0000-0000-0000-000000000006','Parceiro Gate','Anuncio global',true,'{}',array['feed']),
  ('9d000000-0000-0000-0000-000000000002','9a000000-0000-0000-0000-000000000006','Parceiro Gate','Anuncio C1',false,array['9b000000-0000-0000-0000-000000000001']::uuid[],array['feed']);
set local role authenticated;
select pg_temp.as_user('1');
select is((select count(*)::int from public.sponsored_ads), 2, 'sponsored_ads_select: ativa ve os 2 anuncios (global + da propria comunidade)');
select pg_temp.as_user('2');
select is((select count(*)::int from public.sponsored_ads), 0, 'sponsored_ads_select: disabled nao ve nenhum anuncio (sem erro -- so 0 linhas)');
select pg_temp.as_user('3');
select is((select count(*)::int from public.sponsored_ads), 0, 'sponsored_ads_select: deleting nao ve nenhum anuncio');
select pg_temp.as_user('4');
select is((select count(*)::int from public.sponsored_ads), 0, 'sponsored_ads_select: suspensao nao ve nenhum anuncio');
select pg_temp.as_user('5');
select is((select count(*)::int from public.sponsored_ads), 0, 'sponsored_ads_select: banida nao ve nenhum anuncio');
select pg_temp.as_user('6');
select is((select count(*)::int from public.sponsored_ads), 2, 'sponsored_ads_select: superadmin ve todos (comportamento existente)');
reset role;

-- ===== 15) Mínimo preservado pela decisão: notices, support_requests, leitura da própria linha =====
insert into public.notices(user_id,action,rule,reason) values ('9a000000-0000-0000-0000-000000000002','warning','account_disabled','sua conta foi desativada (teste)');
set local role authenticated;
select pg_temp.as_user('2');
select is((select count(*)::int from public.notices where user_id=auth.uid()), 1, 'disabled: ainda ve o proprio aviso de bloqueio (notices)');
select lives_ok($$select public.submit_support_request('{"kind":"privacy","message":"quero recorrer do bloqueio (teste)"}'::jsonb)$$,
  'disabled: ainda consegue abrir chamado de suporte (via submit_support_request -- nao ha INSERT direto de cliente em support_requests)');
select is((select account_status from public.users where id=auth.uid()), 'disabled', 'disabled: ainda le a propria linha em public.users (users_select)');
select pg_temp.as_user('5');
select lives_ok($$select public.submit_support_request('{"kind":"privacy","message":"quero recorrer do banimento (teste)"}'::jsonb)$$,
  'banida: ainda consegue abrir chamado de suporte');
reset role;

-- =====================================================================================
-- 16) F1.2 -- sequencia real de cadastro (Register.jsx), termos desatualizados e
--     equivalencia do novo helper com has_app_access() nos estados de bloqueio.
--     Publica uma politica legal (ausente neste container -- quem publica de verdade e
--     scripts/seed-legal.mjs, fora do pipeline de migrations/pgTAP) só agora, no fim do
--     arquivo, para não alterar o resultado das secoes 0-15 acima (já executadas).
-- =====================================================================================
insert into public.legal_policy (id, version, published, digest, published_at, minimum_age)
  values (true, 'f12-v1', true, 'f12-digest', now(), 18)
  on conflict (id) do update set
    version = 'f12-v1', published = true, digest = 'f12-digest', published_at = now(), minimum_age = 18;

-- 16a) Sequencia exata de Register.jsx: usuario novo, criado DEPOIS do corte de
-- verificacao de e-mail (email_verified_ok exige confirmed_at), com e-mail ainda NAO
-- confirmado (so enviado, fire-and-forget, como Register.jsx:118) e SEM aceite legal
-- (accept_legal_documents só roda em Register.jsx:141, depois de set_username:124).
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('9a100000-0000-0000-0000-000000000001','authenticated','authenticated','f12-newreg@example.invalid','unused',null,'{}','{}',now(),now());
insert into public.public_profiles(user_id,username) values ('9a100000-0000-0000-0000-000000000001','f12prereg');

create or replace function pg_temp.as_f1(p text) returns void language sql as
  $$select pg_temp.set_test_user( '9a100000-0000-0000-0000-00000000000' || p, true)$$;

set local role authenticated;
select pg_temp.as_f1('1');
select lives_ok($$select public.set_username('f12newreguser')$$,
  'F1.2 16a: set_username sucede ANTES do aceite legal e da verificacao de e-mail (Register.jsx:124, corrige o bug bloqueante da F1.1)');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED',
  'F1.2 16a: update_user_profile continua negado neste mesmo instante -- documentado, nao é um bug: o único call site real (Profile.jsx:89) nunca é atingido antes do LegalGate (ver tabela da tarefa 2), então esta chamada nunca ocorre na prática nesta janela');
reset role;

-- Register.jsx:125 (setBirthInfo) roda antes do aceite -- data de nascimento é
-- pré-requisito de accept_legal_documents (checagem de idade mínima).
update public.users set data_nascimento = (now() - interval '30 years')::date
  where id = '9a100000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.as_f1('1');
select lives_ok($$select public.accept_legal_documents(jsonb_build_object(
    'version','f12-v1','digest','f12-digest','accepted',true,'healthDataConsent',true,
    'manifest','{}'::jsonb,'documents','{}'::jsonb))$$,
  'F1.2 16a: accept_legal_documents sucede em Register.jsx:141, depois de set_username');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED',
  'F1.2 16a: update_user_profile AINDA negado so apos o aceite legal -- e-mail continua nao confirmado (email_verified_ok() tambem exigido por has_app_access(), residual que nao afeta o cadastro pois este objeto nunca e chamado nele)');
reset role;

update auth.users set email_confirmed_at = now() where id = '9a100000-0000-0000-0000-000000000001';

set local role authenticated;
select pg_temp.as_f1('1');
select lives_ok($$select public.update_user_profile('{"bio":"ok"}'::jsonb)$$,
  'F1.2 16a: update_user_profile sucede so depois do aceite legal E da verificacao de e-mail (ambos satisfeitos) -- confirma que o objeto continua com has_app_access() completo, sem afrouxamento indevido');
reset role;

-- 16b) os mesmos 6 estados continuam negados/permitidos para os objetos que ganharam
-- gate na F1 -- ja cobertos pelas secoes 3-8 e 12-13 acima (incluindo set_username, que
-- a partir desta migration usa private.has_account_standing() em vez de
-- has_app_access(), e create_promotion, com os 3 codigos distintos restaurados); nao
-- duplicado aqui.

-- 16c) usuario com versao de termos desatualizada: has_account_standing() nao se
-- importa (nunca checou termos), has_app_access() nega -- mesmo codigo de erro que uma
-- conta bloqueada (PERMISSION_DENIED), o que e o comportamento PRE-EXISTENTE de
-- has_app_access() (nao e uma mudanca da F1.2).
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values ('9a100000-0000-0000-0000-000000000002','authenticated','authenticated','f12-stale@example.invalid','unused',now(),'{}','{}',now()-interval '90 days',now());
update public.users set legal_acceptance_version='versao-antiga', legal_acceptance_digest='digest-antigo', legal_acceptance_accepted_at=now()-interval '30 days'
  where id='9a100000-0000-0000-0000-000000000002';
insert into public.public_profiles(user_id,username) values ('9a100000-0000-0000-0000-000000000002','f12stale');

create or replace function pg_temp.as_f1_2() returns void language sql as
  $$select pg_temp.set_test_user( '9a100000-0000-0000-0000-000000000002', true)$$;

-- Checagem direta das 2 funcoes (sem "set local role authenticated"): private.has_account_standing()
-- esta no schema private, que tem "revoke all ... from public, anon, authenticated" (ver
-- 20261002000003_comments_schema.sql:4) -- so e alcancavel de dentro de outra SECURITY DEFINER
-- ou pela role de conexao (superusuario neste container de teste), nunca direto por
-- "authenticated". auth.uid() le a GUC abaixo independente da role ambiente, entao o resultado
-- e o mesmo que um end-user teria ao disparar isso indiretamente via uma RPC.
select pg_temp.as_f1_2();
select is((select private.has_account_standing()), true,
  'F1.2 16c: has_account_standing() ignora termos desatualizados (so checa account_status/account_restrictions)');
select is((select public.has_app_access()), false,
  'F1.2 16c: has_app_access() nega por versao/digest de termos desatualizados (comportamento pre-existente, nao mudou na F1.2)');

set local role authenticated;
select pg_temp.as_f1_2();
select lives_ok($$select public.set_username('f12staleuser')$$,
  'F1.2 16c: set_username sucede mesmo com termos desatualizados (usa o helper estreito)');
select throws_ok($$select public.update_user_profile('{"bio":"x"}'::jsonb)$$, 'PERMISSION_DENIED',
  'F1.2 16c: update_user_profile nega com termos desatualizados -- documentado: exige novo accept_legal_documents, igual a uma conta bloqueada do ponto de vista do codigo de erro');
reset role;

-- 16d) equivalencia do helper com has_app_access() nos estados de bloqueio: para
-- disabled/deleting/suspenso/banido, ambas as funcoes devem concordar (ambas false),
-- independente do estado de termos/e-mail (que so has_app_access() checa) -- é esse o
-- recorte de "equivalencia" pedido, não que as duas sejam idênticas em todos os casos
-- (para conta ativa sem termos aceitos elas DIVERGEM de proposito, ja demonstrado acima).
-- Sem "set local role authenticated" pelo mesmo motivo da secao 16c (private.has_account_standing()
-- so e alcancavel pela role de conexao ou de dentro de outra SECURITY DEFINER).
select pg_temp.as_user('2');
select is((select public.has_app_access()), false, 'F1.2 16d: has_app_access() nega disabled');
select is((select private.has_account_standing()), false, 'F1.2 16d: has_account_standing() nega disabled (equivalente)');
select pg_temp.as_user('3');
select is((select public.has_app_access()), false, 'F1.2 16d: has_app_access() nega deleting');
select is((select private.has_account_standing()), false, 'F1.2 16d: has_account_standing() nega deleting (equivalente)');
select pg_temp.as_user('4');
select is((select public.has_app_access()), false, 'F1.2 16d: has_app_access() nega suspenso');
select is((select private.has_account_standing()), false, 'F1.2 16d: has_account_standing() nega suspenso (equivalente)');
select pg_temp.as_user('5');
select is((select public.has_app_access()), false, 'F1.2 16d: has_app_access() nega banido');
select is((select private.has_account_standing()), false, 'F1.2 16d: has_account_standing() nega banido (equivalente)');
-- Achado incidental: has_app_access() NAO isenta superadmin do bloco de termos legais (so
-- isenta disabled/email -- ver 20260926000023_users_new_fields.sql:33-50, a clausula de
-- legal_policy nao tem "u.role = 'superadmin' or" como as outras). Sem aceite valido da
-- politica publicada acima, retornaria NULL mesmo para superadmin -- aceite aqui pra isolar
-- exatamente o que esta secao quer medir (a excecao de account_status/restrictions).
update public.users set legal_acceptance_version='f12-v1', legal_acceptance_digest='f12-digest', legal_acceptance_accepted_at=now()
  where id='9a000000-0000-0000-0000-000000000006';
select pg_temp.as_user('6');
select is((select public.has_app_access()), true, 'F1.2 16d: has_app_access() permite superadmin (com termos aceitos -- ver nota acima: a clausula legal NAO isenta superadmin)');
select is((select private.has_account_standing()), true, 'F1.2 16d: has_account_standing() permite superadmin (mesma excecao)');

select * from finish();
rollback;
