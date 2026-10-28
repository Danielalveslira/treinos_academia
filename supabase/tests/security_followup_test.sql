\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Fixtures: usuário comum e superadmin.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('c4000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
  'u' || n || '-secfollowup@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01', '02']) as n;
update public.users set role = 'superadmin' where id = 'c4000000-0000-0000-0000-000000000002';

-- "PUBLIC" no ACL é o grantee 0: é ele que faz anon e authenticated herdarem EXECUTE.
create or replace function pg_temp.public_can_execute(p_sig regprocedure) returns boolean language sql as $$
  select coalesce((select bool_or(a.grantee = 0 and a.privilege_type = 'EXECUTE')
    from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = p_sig), false)
$$;

-- ===== mark_infinitepay_checkout_uncertain: só service_role ======================================================
select ok(not pg_temp.public_can_execute('public.mark_infinitepay_checkout_uncertain(uuid)'), 'EXECUTE não está concedido a PUBLIC');
select ok(not has_function_privilege('anon', 'public.mark_infinitepay_checkout_uncertain(uuid)', 'execute'), 'anon não executa');
select ok(not has_function_privilege('authenticated', 'public.mark_infinitepay_checkout_uncertain(uuid)', 'execute'), 'authenticated não executa');
select ok(has_function_privilege('service_role', 'public.mark_infinitepay_checkout_uncertain(uuid)', 'execute'), 'service_role (Edge Function de checkout) executa');

-- Todas as funções do fluxo InfinitePay que só a Edge Function usa seguem fechadas para clientes.
select is((select count(*)::int from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.proname in ('finish_infinitepay_checkout', 'release_infinitepay_checkout',
                      'fail_infinitepay_checkout', 'mark_infinitepay_checkout_uncertain', 'confirm_infinitepay_cash_purchase')
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
         or pg_temp.public_can_execute(p.oid::regprocedure))), 0,
  'nenhuma função interna do checkout é executável por anon/authenticated/PUBLIC');
-- E as que o cliente PRECISA continuam abertas só para authenticated (o fluxo do usuário não quebra).
select ok(has_function_privilege('authenticated', 'public.cancel_my_cash_purchase(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.cancel_my_cash_purchase(uuid)', 'execute'), 'cancelar a própria compra: authenticated sim, anon não');

-- Comportamento: sem service_role a chamada é recusada de verdade, e a compra de ninguém muda.
insert into public.cash_purchases (id, user_id, request_id, payment_provider, package_id, package_label, cash_amount, amount_centavos, currency,
  status, provider_order_nsu)
values ('c4a00000-0000-0000-0000-000000000001', 'c4000000-0000-0000-0000-000000000001', 'c4b00000-0000-0000-0000-000000000001', 'infinitepay', 'pkg', 'Pacote', 10, 1000, 'BRL',
  'pending', 'evo_' || repeat('a', 32));
set local role anon;
select throws_ok($$select public.mark_infinitepay_checkout_uncertain('c4a00000-0000-0000-0000-000000000001')$$, '42501', null, 'anon recebe permission denied');
reset role;
set local role authenticated;
select pg_temp.set_test_user( 'c4000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.mark_infinitepay_checkout_uncertain('c4a00000-0000-0000-0000-000000000001')$$, '42501', null, 'nem o dono da compra a chama direto');
reset role;
select ok(not coalesce((select checkout_uncertain from public.cash_purchases where id = 'c4a00000-0000-0000-0000-000000000001'), false),
  'a compra não foi congelada por chamada de cliente');

-- ===== review_blocked_account_deletion =========================================================================
select is((select proconfig from pg_proc where oid = 'public.review_blocked_account_deletion(uuid, text)'::regprocedure),
  array['search_path=""'], 'search_path vazio (todas as referências do corpo são qualificadas)');
select ok((select prosecdef from pg_proc where oid = 'public.review_blocked_account_deletion(uuid, text)'::regprocedure), 'segue SECURITY DEFINER');
select ok(not has_function_privilege('anon', 'public.review_blocked_account_deletion(uuid, text)', 'execute'), 'anon não executa');
select ok(not pg_temp.public_can_execute('public.review_blocked_account_deletion(uuid, text)'), 'PUBLIC não executa');
select ok(has_function_privilege('authenticated', 'public.review_blocked_account_deletion(uuid, text)', 'execute'), 'a tela admin (authenticated) ainda chama; a barreira é is_superadmin() dentro');

-- A função continua funcionando com o search_path vazio: usuário comum é barrado, superadmin passa da barreira.
select pg_temp.public_can_execute('public.review_blocked_account_deletion(uuid, text)') is not null as sanity;
set local role authenticated;
select pg_temp.set_test_user( 'c4000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.review_blocked_account_deletion(gen_random_uuid(), 'nota de teste')$$, 'PERMISSION_DENIED', 'usuário comum é barrado');
select pg_temp.set_test_user( 'c4000000-0000-0000-0000-000000000002', true);
select throws_ok($$select public.review_blocked_account_deletion(gen_random_uuid(), 'x')$$, 'NOTE_REQUIRED', 'superadmin passa da barreira e as validações (com o search_path vazio) funcionam');
select throws_ok($$select public.review_blocked_account_deletion(gen_random_uuid(), 'nota válida de teste')$$, 'JOB_NOT_FOUND', 'o corpo resolve public.deletion_jobs sem search_path');
reset role;

-- ===== Contrato global (o mesmo de notification_security_test, aqui como rede de segurança desta migration) ======
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in ('list_published_professional_listings', 'is_superadmin', 'has_app_access', 'is_community_member', 'is_community_owner', 'can_post_in_community', 'community_access_allowed', 'push_delivery_ack', 'submit_commercial_lead', 'public_list_professionals', 'public_get_professional', 'public_professional_avatar_visible','public_product_catalog','authorize_storefront_media','public_storefront_sitemap','public_listing_sitemap')),
  0, 'nenhuma função SECURITY DEFINER fora da lista pública é executável por anon');
select is((select count(*)::int from pg_proc p where p.prosecdef and p.prokind = 'f' and p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and exists (select 1 from unnest(p.proconfig) c where c ~ '^search_path=' and c <> 'search_path=""' and c !~ 'pg_temp')),
  0, 'todo SECURITY DEFINER tem search_path vazio ou com pg_temp por último');

select * from finish();
rollback;
