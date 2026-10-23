\ir _helpers/auth_session.sql
begin;
select no_plan();

-- ..01 dono da comunidade A | ..02 membro que será banido | ..03 membro de controle | ..04 sem vínculo | ..05 superadmin
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('d1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-removal@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'd1000000-%';
update public.users set role = 'superadmin' where id = 'd1000000-0000-0000-0000-000000000005';

insert into public.communities (id, name, created_by, owner_id) values
  ('d2000000-0000-0000-0000-00000000000a', 'Remoção A', 'd1000000-0000-0000-0000-000000000005', 'd1000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) values
  ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001'),
  ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002'),
  ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003');

insert into public.statuses (id, community_id, author_id, type, expires_at, text, photo_path)
values
  ('d3000000-0000-0000-0000-0000000000a1', 'd2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'text', now() + interval '1 day', 'texto interno da comunidade', null),
  ('d3000000-0000-0000-0000-0000000000a2', 'd2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', 'photo', now() + interval '1 day', null, 'statusPhotos/d2000000-0000-0000-0000-00000000000a/d3000000-0000-0000-0000-0000000000a2.webp');
insert into storage.buckets (id, name, public) values ('status-photos', 'status-photos', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name)
  values ('status-photos', 'd2000000-0000-0000-0000-00000000000a/d3000000-0000-0000-0000-0000000000a2.webp');
insert into public.sponsored_ads (id, partner_name, title, community_ids, is_global, display_mode, expires_at, created_by)
  values ('d4000000-0000-0000-0000-000000000001', 'Parceiro R', 'Só da comunidade A', '{d2000000-0000-0000-0000-00000000000a}', false, '{feed}',
          now() + interval '30 days', 'd1000000-0000-0000-0000-000000000005');

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( case when p = '' then '' else 'd1000000-0000-0000-0000-0000000000' || p end, true)$$;

create or replace function pg_temp.rows_affected(q text) returns bigint language plpgsql as
  $$declare n bigint; begin execute q; get diagnostics n = row_count; return n; end$$;

-- === 1) metadados de segurança da RPC de estado de acesso ===
select is((select prosecdef from pg_proc where oid = 'public.get_community_access(uuid)'::regprocedure), true, 'get_community_access é SECURITY DEFINER');
select ok((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.get_community_access(uuid)'::regprocedure), 'get_community_access tem search_path fixo');
select ok(not has_function_privilege('anon', 'public.get_community_access(uuid)', 'execute'), 'anon não executa get_community_access');
select ok(has_function_privilege('authenticated', 'public.get_community_access(uuid)', 'execute'), 'authenticated executa get_community_access');

set local role authenticated;

-- === 2) antes da remoção: o membro tem acesso completo ===
select pg_temp.as_user('02');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'member', 'membro: estado member');
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 2::bigint, 'membro lê os posts');
select is((select count(*) from storage.objects where bucket_id = 'status-photos'), 1::bigint, 'membro lê a foto');
select is((select count(*) from public.sponsored_ads where id = 'd4000000-0000-0000-0000-000000000001'), 1::bigint, 'membro vê o anúncio direcionado à comunidade');
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000002'), 1::bigint, 'membro vê o próprio vínculo');

select pg_temp.as_user('04');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'not_member', 'sem vínculo: estado not_member');

-- === 3) remoção (banimento pelo dono) ===
-- o dono nunca é banível, nem por superadmin
select pg_temp.as_user('05');
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', true, 'tentativa de banir o dono')$$,
  'PROTECTED_ROLE', 'o dono da comunidade não pode ser banido'
);
select pg_temp.as_user('01');
select lives_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', true, 'violou as regras da comunidade')$$,
  'dono bane o membro'
);

-- === 4) depois da remoção: nenhuma superfície continua aberta para ele ===
select pg_temp.as_user('02');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'banned', 'removido: estado banned');
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000002'), 0::bigint, 'o vínculo deixa de existir (isMember/lista "minhas" refletem o servidor)');
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 0::bigint, 'não lê mais os posts');
select is((select count(*) from storage.objects where bucket_id = 'status-photos'), 0::bigint, 'não lê mais a mídia privada');
select is((select count(*) from public.sponsored_ads where id = 'd4000000-0000-0000-0000-000000000001'), 0::bigint, 'não vê mais anúncios direcionados à comunidade');
select throws_ok(
  $$select public.comment_create('d3000000-0000-0000-0000-0000000000a1', null, 'comentário de quem foi removido', gen_random_uuid())$$,
  'PERMISSION_DENIED', 'não comenta'
);
select throws_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'não consegue voltar a entrar sozinho'
);
select throws_ok(
  $$insert into public.statuses (community_id, author_id, type, expires_at, text) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', 'text', now() + interval '1 day', 'post do removido')$$,
  '42501', null, 'não publica'
);
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Denúncia vinda de quem foi removido da comunidade.',
    'statusId', 'd3000000-0000-0000-0000-0000000000a1', 'category', 'spam'))$$,
  'PERMISSION_DENIED', 'não consegue denunciar post da comunidade (nem usar a RPC para tocar no conteúdo)'
);

-- === 5) controle: quem continua membro não é afetado; contador e lista do dono refletem a realidade ===
select pg_temp.as_user('03');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'member', 'controle continua member');
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 2::bigint, 'controle continua lendo os posts');
select pg_temp.as_user('01');
select is((select member_count from public.communities where id = 'd2000000-0000-0000-0000-00000000000a'), 2, 'member_count desconta o removido');
select is((select count(*) from public.list_community_restrictions('d2000000-0000-0000-0000-00000000000a')), 1::bigint, 'dono ainda lista o banido (para poder desbanir)');

-- === 6) desbanir não devolve o vínculo: precisa entrar de novo, e então volta a ter acesso ===
select lives_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', false)$$,
  'dono desbane'
);
select pg_temp.as_user('02');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'not_member', 'desbanido volta a ser apenas not_member');
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 0::bigint, 'desbanir não reabre o conteúdo sozinho');
select lives_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002')$$,
  'desbanido pode pedir para entrar de novo'
);
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 2::bigint, 'e então volta a ler');

-- === 7) caminho da moderação global (decisão formal) também revoga o vínculo ===
reset role;
insert into public.community_restrictions (community_id, user_id, decision_id)
  values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003', null);
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000003'), 0::bigint, 'qualquer restrição nova revoga o vínculo, venha de onde vier');

-- === 8) REMOVER (sem banir): perde o acesso agora, sem restrição, e pode voltar ===
set local role authenticated;
select pg_temp.as_user('04');
select lives_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$,
  'usuário 04 entra'
);
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'member', '04 é member');
select throws_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002')$$,
  'PERMISSION_DENIED', 'membro comum não remove ninguém'
);
select pg_temp.as_user('02');
select throws_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$,
  'PERMISSION_DENIED', 'nem outro membro comum'
);
select pg_temp.as_user('01');
select throws_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001')$$,
  'CANNOT_REMOVE_SELF', 'dono não remove a si mesmo por esta RPC'
);
select pg_temp.as_user('05');
select throws_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001')$$,
  'PROTECTED_ROLE', 'o dono não pode ser removido, nem por superadmin'
);
select pg_temp.as_user('01');
select throws_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000005')$$,
  'PROTECTED_ROLE', 'superadmin não é removível'
);
select lives_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003')$$,
  'remover quem não é mais membro é um no-op (idempotente)'
);
select lives_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$,
  'dono remove o membro 04'
);
select pg_temp.as_user('04');
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'not_member', 'removido: not_member (não banned)');
select is((select count(*) from public.statuses where community_id = 'd2000000-0000-0000-0000-00000000000a'), 0::bigint, 'removido perde o conteúdo na hora');
select is((select count(*) from public.community_restrictions where user_id = 'd1000000-0000-0000-0000-000000000004'), 0::bigint, 'remover não cria restrição');
select is((select count(*) from storage.objects where bucket_id = 'status-photos'), 0::bigint, 'removido (sem ban) não lê a mídia privada');
select is((select count(*) from public.sponsored_ads where id = 'd4000000-0000-0000-0000-000000000001'), 0::bigint, 'removido (sem ban) não vê anúncio exclusivo da comunidade');
select throws_ok(
  $$select public.submit_support_request(jsonb_build_object(
    'kind', 'report', 'message', 'Denúncia vinda de quem foi removido da comunidade.',
    'statusId', 'd3000000-0000-0000-0000-0000000000a1', 'category', 'spam'))$$,
  'PERMISSION_DENIED', 'removido (sem ban) não usa a RPC de denúncia restrita a membros'
);
select lives_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$,
  'removido pode entrar de novo'
);
select pg_temp.as_user('05');
select lives_ok(
  $$select public.remove_community_member('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$,
  'superadmin também remove'
);
reset role;
select is((select member_count from public.communities where id = 'd2000000-0000-0000-0000-00000000000a'), 2, 'member_count coerente (dono + 02)');
select ok(not has_function_privilege('anon', 'public.remove_community_member(uuid, uuid)', 'execute'), 'anon não executa remove_community_member');
select ok(has_function_privilege('authenticated', 'public.remove_community_member(uuid, uuid)', 'execute'), 'authenticated executa (a barreira é o dono/superadmin dentro)');
select is((select prosecdef from pg_proc where oid = 'public.remove_community_member(uuid,uuid)'::regprocedure), true, 'remove_community_member é SECURITY DEFINER');
select ok((select proconfig::text like '%pg_temp%' from pg_proc where oid = 'public.remove_community_member(uuid,uuid)'::regprocedure), 'search_path com pg_temp');
select is((select count(*) from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'private.revoke_membership_on_restriction()'::regprocedure and a.privilege_type = 'EXECUTE' and a.grantee in (0, (select oid from pg_roles where rolname in ('anon')), (select oid from pg_roles where rolname = 'authenticated'))), 0::bigint, 'função do trigger não é executável por clientes');

-- === 9) BANIR é idempotente e auditado; remover+banir não deixa ban com vínculo ===
select pg_temp.as_user('01');
select lives_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', true, 'primeiro motivo do ban')$$,
  'dono bane 02 (que é membro de novo)'
);
select is(public.get_community_access('d2000000-0000-0000-0000-00000000000a'), 'member', 'dono segue member (sanidade do ator)');
reset role;
create temp table t_ban_before as
  select created_at, banned_by, reason from public.community_restrictions
  where community_id = 'd2000000-0000-0000-0000-00000000000a' and user_id = 'd1000000-0000-0000-0000-000000000002';
create temp table t_audit_before as
  select count(*) as n from public.admin_audit_log where action = 'community_member_banned' and target_user_id = 'd1000000-0000-0000-0000-000000000002';
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000002'), 0::bigint, 'ban removeu o vínculo');
set local role authenticated;
select pg_temp.as_user('01');
select lives_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', true, 'segundo motivo diferente')$$,
  'banir de novo não falha'
);
reset role;
select is((select count(*) from public.community_restrictions where user_id = 'd1000000-0000-0000-0000-000000000002'), 1::bigint, 'continua uma única restrição');
select is((select reason from public.community_restrictions where user_id = 'd1000000-0000-0000-0000-000000000002'), 'primeiro motivo do ban', 'segundo ban não sobrescreve o motivo original');
select is((select created_at from public.community_restrictions where user_id = 'd1000000-0000-0000-0000-000000000002'), (select created_at from t_ban_before), 'nem a data');
select is((select count(*) from public.admin_audit_log where action = 'community_member_banned' and target_user_id = 'd1000000-0000-0000-0000-000000000002'), (select n from t_audit_before), 'e não duplica a auditoria');
select ok(exists (select 1 from public.admin_audit_log where action = 'community_member_removed' and target_user_id = 'd1000000-0000-0000-0000-000000000004' and metadata->>'community_id' = 'd2000000-0000-0000-0000-00000000000a'), 'remover foi auditado com a comunidade');

-- === 10) DESBANIR duas vezes: idempotente e sem recriar vínculo ===
set local role authenticated;
select pg_temp.as_user('01');
select lives_ok($$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', false)$$, 'desbanir');
select lives_ok($$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002', false)$$, 'desbanir de novo não falha');
reset role;
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000002'), 0::bigint, 'desbanir não recria o vínculo');
select is((select count(*) from public.admin_audit_log where action = 'community_member_unbanned' and target_user_id = 'd1000000-0000-0000-0000-000000000002' and metadata->>'community_id' = 'd2000000-0000-0000-0000-00000000000a'), 2::bigint, 'duas auditorias de desbanir (seção 6 e esta), a repetição não gera mais uma');

-- === 11) adulteração direta / quem não pode administrar ===
set local role authenticated;
select pg_temp.as_user('04');
select lives_ok($$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000004')$$, '04 entra (necessário para os próximos testes)');
select throws_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000002')$$,
  '42501', null, 'não dá para inserir vínculo em nome de outro usuário (user_id adulterado)'
);
select is(pg_temp.rows_affected('delete from public.community_members where user_id = ''d1000000-0000-0000-0000-000000000001'''), 0::bigint, 'DELETE direto do vínculo de outro usuário não apaga nada');
select is(pg_temp.rows_affected('update public.community_members set user_id = ''d1000000-0000-0000-0000-000000000002'' where user_id = ''d1000000-0000-0000-0000-000000000004'''), 0::bigint, 'UPDATE do vínculo (user_id/community_id) não é permitido');
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003', true, 'tentativa de membro comum')$$,
  'PERMISSION_DENIED', 'membro comum não bane'
);
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003', false)$$,
  'PERMISSION_DENIED', 'membro comum não desbane'
);
select pg_temp.as_user('01');
select is(pg_temp.rows_affected('delete from public.community_members where user_id = ''d1000000-0000-0000-0000-000000000004'''), 0::bigint, 'nem o dono apaga vínculo por DELETE direto (só pela RPC)');
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', true, 'banir o próprio dono')$$,
  'CANNOT_BAN_SELF', 'dono não se bane'
);
select pg_temp.as_user('05');
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000001', true, 'superadmin banindo o dono')$$,
  'PROTECTED_ROLE', 'superadmin também não bane o dono'
);
reset role;

-- === 12) trigger: só ban total revoga; suspensão de conta e outras escritas não ===
insert into public.account_restrictions (user_id, action) values ('d1000000-0000-0000-0000-000000000004', 'temporary_suspension');
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000004'), 1::bigint, 'restrição de CONTA (parcial) não mexe no vínculo da comunidade');
delete from public.account_restrictions where user_id = 'd1000000-0000-0000-0000-000000000004';
update public.community_restrictions set banned_by = null where community_id = 'd2000000-0000-0000-0000-00000000000a';
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000004'), 1::bigint, 'UPDATE de coluna não-chave em restrições não afeta outros vínculos');
select throws_ok(
  $$insert into public.community_members (community_id, user_id) values ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000003')$$,
  '42501', 'COMMUNITY_BANNED', 'trigger de guarda bloqueia vínculo de banido mesmo para papel privilegiado'
);
select is((select count(*) from public.community_members m join public.community_restrictions r using (community_id, user_id)), 0::bigint, 'invariante: nenhum vínculo coexiste com restrição');

-- === 13) leitura (índices) ===
select is((select count(*) from pg_indexes where tablename in ('community_members','community_restrictions') and indexdef ~ '\(community_id, user_id\)'), 2::bigint, 'ambas as tabelas têm índice (community_id, user_id): não é preciso criar outro');

-- === 14) sessão revogada (20261113000003): dono de verdade, mas "sair de todos os dispositivos"
-- em outro aparelho já apagou a sessão -- fixture própria (06), sem tocar no estado das seções
-- anteriores. A checagem vem antes de qualquer mutação: nenhum vínculo/restrição é criado.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('d1000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'u06-removal@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
insert into public.community_members (community_id, user_id) values
  ('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000006');
set local role authenticated;
select pg_temp.as_user('01'); -- dono, continua autorizado por papel
select pg_temp.revoke_test_session('d1000000-0000-0000-0000-000000000001');
select throws_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000006', true, 'tentativa com sessão revogada')$$,
  'SESSION_REVOKED', 'set_community_member_ban nega sessão revogada mesmo sendo o dono de verdade'
);
reset role;
select is((select count(*) from public.community_members where user_id = 'd1000000-0000-0000-0000-000000000006'), 1::bigint, 'vínculo intacto: a tentativa com sessão revogada não teve efeito nenhum');
select is((select count(*) from public.community_restrictions where user_id = 'd1000000-0000-0000-0000-000000000006'), 0::bigint, 'nenhuma restrição criada pela tentativa com sessão revogada');
set local role authenticated;
select pg_temp.as_user('01'); -- novo login (nova sessão): a mesma ação volta a funcionar sem nenhum mecanismo extra
select lives_ok(
  $$select public.set_community_member_ban('d2000000-0000-0000-0000-00000000000a', 'd1000000-0000-0000-0000-000000000006', true, 'sessão ativa de novo')$$,
  'sessão ativa de novo: volta a funcionar'
);
reset role;

select * from finish();
rollback;
