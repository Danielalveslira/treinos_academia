begin;
select no_plan();

-- Fixtures (prefixo 71...): 01 superadmin | 02 membro comum (2 comunidades, 1 advertência,
-- carteira com EvoCash) | 03 em exclusão | 04 suspensa (vigente) | 05 desativada |
-- 06 suspensão expirada (volta a "active") | 07 compra pendente | 08 alvo de exclusão
-- pedida pelo admin | 09 usuário comum sem permissão.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('71000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-adminaccounts@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04','05','06','07','08','09']) as n;
update public.users set role = 'superadmin', username = 'superadminaccounts' where id = '71000000-0000-0000-0000-000000000001';
update public.users set username = 'membroaccounts', legal_acceptance_version = '1.4.0' where id = '71000000-0000-0000-0000-000000000002';

insert into public.communities (id, name, created_by) values
  ('72000000-0000-0000-0000-000000000001', 'Comunidade A', '71000000-0000-0000-0000-000000000002'),
  ('72000000-0000-0000-0000-000000000002', 'Comunidade B', '71000000-0000-0000-0000-000000000002');
insert into public.community_members (community_id, user_id) values
  ('72000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002'),
  ('72000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000002');

insert into public.wallets (user_id, coin_balance, cash_balance) values ('71000000-0000-0000-0000-000000000002', 7, 40);
insert into public.cash_purchases (user_id, request_id, package_id, package_label, cash_amount, amount_centavos, status)
values ('71000000-0000-0000-0000-000000000007', 'req-adminaccounts', 'pkg', 'Pacote', 10, 1000, 'pending');

insert into public.support_requests (id, user_id, kind, message)
values ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000009', 'report', 'Denúncia de teste do painel de contas.');
insert into public.moderation_decisions (request_id, admin_id, target_user_id, action, rule, reason, evidence) values
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'warning', 'Regra 1', 'Motivo 1', 'Evidência 1'),
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000002', 'no_action', 'Regra 1', 'Motivo 2', 'Evidência 2');

insert into public.account_restrictions (user_id, action, until) values
  ('71000000-0000-0000-0000-000000000004', 'temporary_suspension', now() + interval '3 days'),
  ('71000000-0000-0000-0000-000000000006', 'temporary_suspension', now() - interval '1 day');
update public.users set account_status = 'disabled', disabled_reason = 'Motivo de teste' where id = '71000000-0000-0000-0000-000000000005';

select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);
select public.queue_deletion('account', '71000000-0000-0000-0000-000000000003');

create temp table _snap as select public.admin_accounts_snapshot() as s;
create function pg_temp.acc(p_n text) returns jsonb language sql as $$
  select a from _snap, jsonb_array_elements(s->'accounts') a where a->>'id' = '71000000-0000-0000-0000-0000000000' || p_n
$$;

-- === 1. autorização ===
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000009', true);
select throws_ok($$select public.admin_accounts_snapshot()$$, 'PERMISSION_DENIED', 'usuário comum não executa o snapshot');
select throws_ok($$select public.admin_account_communities('71000000-0000-0000-0000-000000000002')$$, 'PERMISSION_DENIED', 'usuário comum não lê comunidades da conta');
select throws_ok($$select public.admin_account_financial('71000000-0000-0000-0000-000000000002')$$, 'PERMISSION_DENIED', 'usuário comum não lê financeiro da conta');
select throws_ok($$select public.admin_list_audit_log()$$, 'PERMISSION_DENIED', 'usuário comum não lê a auditoria');
select throws_ok($$select public.admin_set_accounts_status(array['71000000-0000-0000-0000-000000000002']::uuid[], true, 'motivo de teste')$$, 'PERMISSION_DENIED', 'usuário comum não altera status em lote');
select throws_ok($$select public.admin_request_account_deletion('71000000-0000-0000-0000-000000000008', 'motivo de teste')$$, 'PERMISSION_DENIED', 'usuário comum não pede exclusão');
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.admin_accounts_snapshot()$$, 'PERMISSION_DENIED', 'não autenticado não executa o snapshot');
select ok(not has_function_privilege('anon', 'public.admin_accounts_snapshot()', 'execute'), 'anon sem EXECUTE no snapshot');
select ok(not has_function_privilege('public', 'public.admin_accounts_snapshot()', 'execute'), 'public sem EXECUTE no snapshot');
select ok(has_function_privilege('authenticated', 'public.admin_accounts_snapshot()', 'execute'), 'authenticated com EXECUTE (a checagem real é is_superadmin)');
select set_config('request.jwt.claim.sub', '71000000-0000-0000-0000-000000000001', true);

-- === 2. conteúdo do snapshot (criado como superadmin lá em cima) ===
select is((select jsonb_typeof(s->'accounts') from _snap), 'array', 'accounts é array');
select is((select (s->'metrics'->>'total_accounts')::int from _snap), (select count(*)::int from public.users), 'total_accounts bate com public.users');
select is((select (s->'meta'->>'total')::int from _snap), (select count(*)::int from public.users), 'meta.total bate');
select is((select (s->'meta'->>'returned')::int from _snap), (select jsonb_array_length(s->'accounts') from _snap), 'meta.returned = tamanho da lista');
select is((select (s->'meta'->>'truncated')::boolean from _snap), false, 'não truncado com base pequena');
select is((select (s->'meta'->>'max_snapshot_rows')::int from _snap), 1000, 'teto de 1000 linhas');
select is((select (s->'metrics'->>'pending_deletions')::int from _snap),
  (select count(*)::int from public.deletion_jobs where kind = 'account' and state in ('pending', 'blocked_financial_review', 'auth_cleanup')),
  'exclusões pendentes batem com deletion_jobs');
select is((select (s->'metrics'->>'new_accounts_7d')::int from _snap), (select count(*)::int from public.users where created_at >= now() - interval '7 days'), 'novas em 7 dias bate');
select is((select (s->'metrics'->>'suspended_accounts')::int from _snap), 1, 'suspensas: só a vigente (a expirada não conta)');
select is(pg_temp.acc('02')->>'community_count', '2', 'community_count correto');
select is(pg_temp.acc('02')->>'flags_count', '1', 'flags_count ignora no_action');
select is(pg_temp.acc('01')->>'flags_count', '0', 'flags_count zero sem decisões');
select is(pg_temp.acc('02')->>'email', 'u02-adminaccounts@example.invalid', 'e-mail vem de auth.users');
select is(pg_temp.acc('02')->>'accepted_legal_version', '1.4.0', 'versão legal aceita');
select is(pg_temp.acc('02')->>'financial_status', 'balance', 'financeiro: com saldo');
select is(pg_temp.acc('07')->>'financial_status', 'pending', 'financeiro: compra pendente');
select is(pg_temp.acc('08')->>'financial_status', 'none', 'financeiro: sem saldo');
select is(pg_temp.acc('03')->>'status', 'deleting', 'status deleting (job aberto)');
select is(pg_temp.acc('03')->>'deletion_status', 'pending', 'deletion_status do job');
select is(pg_temp.acc('08')->>'deletion_status', 'none', 'sem exclusão = none');
select is(pg_temp.acc('04')->>'status', 'suspended', 'status suspended (restrição vigente)');
select is(pg_temp.acc('04')->>'restriction_action', 'temporary_suspension', 'ação da restrição');
select is(pg_temp.acc('06')->>'status', 'active', 'suspensão expirada = active');
select is(pg_temp.acc('05')->>'status', 'disabled', 'status disabled');
select is(pg_temp.acc('05')->>'disabled_reason', 'Motivo de teste', 'motivo da desativação');
select ok(pg_temp.acc('02') ?& array['id','username','email','role','status','created_at','last_sign_in_at','community_count','financial_status','flags_count','showcase_status','deletion_status','accepted_legal_version'], 'contrato do item da lista');
select ok(not (pg_temp.acc('02') ? 'bio'), 'não vaza campos de perfil');

-- === 3. status individual e em lote (com auditoria) ===
select lives_ok($$select public.set_account_status('71000000-0000-0000-0000-000000000002', true, 'Violação das regras')$$, 'desativa conta');
select is((select count(*)::int from public.admin_audit_log where target_user_id = '71000000-0000-0000-0000-000000000002' and action = 'account_disabled' and reason = 'Violação das regras' and admin_user_id = '71000000-0000-0000-0000-000000000001'), 1, 'auditoria de desativação');
select lives_ok($$select public.set_account_status('71000000-0000-0000-0000-000000000002', false)$$, 'reativa conta');
select is((select count(*)::int from public.admin_audit_log where target_user_id = '71000000-0000-0000-0000-000000000002' and action = 'account_reactivated'), 1, 'auditoria de reativação');
select lives_ok($$select public.set_account_status('71000000-0000-0000-0000-000000000002', false)$$, 'reativar conta já ativa é idempotente');
select is((select count(*)::int from public.admin_audit_log where target_user_id = '71000000-0000-0000-0000-000000000002' and action = 'account_reactivated'), 1, 'no-op não gera auditoria duplicada');
select throws_ok($$select public.set_account_status('71000000-0000-0000-0000-000000000003', false)$$, 'ACCOUNT_DELETING', 'não reativa conta em exclusão');
select throws_ok($$select public.set_account_status('71000000-0000-0000-0000-000000000002', true, 'x')$$, 'INVALID_REASON', 'motivo obrigatório para desativar');

create temp table _bulk as
  select public.admin_set_accounts_status(array[
    '71000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000003',
    '71000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000004']::uuid[], true, 'Revisão em lote') as r;
select is((select jsonb_array_length(r) from _bulk), 3, 'lote deduplica ids');
select is((select (e->>'ok')::boolean from _bulk, jsonb_array_elements(r) e where e->>'id' = '71000000-0000-0000-0000-000000000004'), true, 'lote: conta comum desativada');
select is((select e->>'error' from _bulk, jsonb_array_elements(r) e where e->>'id' = '71000000-0000-0000-0000-000000000003'), 'ACCOUNT_DELETING', 'lote: conta em exclusão falha sem abortar');
select is((select e->>'error' from _bulk, jsonb_array_elements(r) e where e->>'id' = '71000000-0000-0000-0000-000000000001'), 'CANNOT_DISABLE_ADMIN', 'lote: superadmin protegido');
select is((select account_status from public.users where id = '71000000-0000-0000-0000-000000000004'), 'disabled', 'lote persistiu a conta válida');
select is((select count(*)::int from public.admin_audit_log where reason = 'Revisão em lote'), 1, 'lote audita só o que mudou');
select throws_ok($$select public.admin_set_accounts_status('{}'::uuid[], true, 'motivo')$$, 'INVALID_ARGUMENT', 'lote vazio recusado');
select throws_ok($$select public.admin_set_accounts_status(array(select gen_random_uuid() from generate_series(1, 101)), true, 'motivo')$$, 'INVALID_ARGUMENT', 'lote > 100 recusado');

-- === 4. exclusão (reusa queue_deletion) ===
select throws_ok($$select public.admin_request_account_deletion('71000000-0000-0000-0000-000000000008', 'x')$$, 'INVALID_REASON', 'exclusão exige motivo');
select lives_ok($$select public.admin_request_account_deletion('71000000-0000-0000-0000-000000000008', 'Pedido do titular por e-mail')$$, 'pede exclusão');
select is((select count(*)::int from public.deletion_jobs where kind = 'account' and target_id = '71000000-0000-0000-0000-000000000008' and state = 'pending'), 1, 'job criado por queue_deletion');
select is((select account_status from public.users where id = '71000000-0000-0000-0000-000000000008'), 'deleting', 'conta marcada deleting');
select lives_ok($$select public.admin_request_account_deletion('71000000-0000-0000-0000-000000000008', 'Pedido do titular por e-mail')$$, 'repetir é no-op');
select is((select count(*)::int from public.admin_audit_log where target_user_id = '71000000-0000-0000-0000-000000000008' and action = 'account_deletion_requested' and metadata ? 'protocol'), 1, 'auditoria única da exclusão com protocolo');
select throws_ok($$select public.admin_request_account_deletion('71000000-0000-0000-0000-000000000001', 'motivo de teste')$$, 'CANNOT_DELETE_SELF', 'não exclui a si mesmo');

-- === 5. leituras sob demanda ===
select is((select jsonb_array_length(public.admin_account_communities('71000000-0000-0000-0000-000000000002'))), 2, 'comunidades da conta');
select is((select public.admin_account_financial('71000000-0000-0000-0000-000000000002')->>'cash_balance'), '40', 'financeiro: saldo EvoCash');
select is((select public.admin_account_financial('71000000-0000-0000-0000-000000000008')->'deletion'->>'state'), 'pending', 'financeiro: estado da exclusão');
select is((select public.admin_account_financial('71000000-0000-0000-0000-000000000009')->>'cash_balance'), '0', 'financeiro: sem carteira = 0');
select is((select jsonb_array_length(public.admin_list_audit_log('71000000-0000-0000-0000-000000000002', 50))), 2, 'auditoria filtrada por alvo');
select ok((select jsonb_array_length(public.admin_list_audit_log()) >= 4), 'auditoria global');
select is((select public.admin_list_audit_log('71000000-0000-0000-0000-000000000002', 1)->0->>'admin_username'), 'superadminaccounts', 'auditoria traz o admin');
select throws_ok($$select public.admin_list_audit_log(null, 101)$$, 'INVALID_ARGUMENT', 'limite máximo da auditoria');

-- === 6. auditoria é append-only ===
select throws_ok($$update public.admin_audit_log set reason = 'adulterado'$$, 'ADMIN_AUDIT_LOG_IMMUTABLE', 'update bloqueado');
select throws_ok($$delete from public.admin_audit_log$$, 'ADMIN_AUDIT_LOG_IMMUTABLE', 'delete bloqueado');
select throws_ok($$truncate public.admin_audit_log$$, 'ADMIN_AUDIT_LOG_IMMUTABLE', 'truncate bloqueado');

-- === 7. teto do snapshot ===
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select gen_random_uuid(), 'authenticated', 'authenticated', 'bulk' || i || '-adminaccounts@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from generate_series(1, 1001) i;
create temp table _big as select public.admin_accounts_snapshot() as s;
select is((select (s->'meta'->>'truncated')::boolean from _big), true, 'acima do teto: truncated = true');
select is((select (s->'meta'->>'returned')::int from _big), 1000, 'acima do teto: devolve só 1000');
select is((select jsonb_array_length(s->'accounts') from _big), 1000, 'acima do teto: lista com 1000');
select is((select (s->'metrics'->>'total_accounts')::int from _big), (select count(*)::int from public.users), 'métricas continuam cobrindo todas as contas');

select * from finish();
rollback;
