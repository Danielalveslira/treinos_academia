begin;
select no_plan();

-- Guarda contra a regressão de ordem de migrations: a versão FINAL das funções de moderação precisa ter, ao mesmo
-- tempo, a moderação da Vitrine (listing_id/suspend_listing) E a de comentários (comment_id/post_comments) -- num
-- banco criado do zero, uma migration "reapply" posterior chegou a apagar a de comentários.
create temp table _defs as
select p.proname, pg_get_functiondef(p.oid) def, p.prosecdef, p.proconfig
from pg_proc p
where p.pronamespace = 'public'::regnamespace and p.proname in ('decide_support_request', 'admin_list_support_requests');

select is((select count(*)::int from _defs), 2, 'as duas funções existem (uma assinatura cada)');
select ok((select def ilike '%suspend_listing%' and def ilike '%listing_id%' from _defs where proname = 'decide_support_request'), 'decide_support_request mantém a moderação da Vitrine');
select ok((select def ilike '%comment_id%' and def ilike '%post_comments%' and def ilike '%removed_by_moderation%' from _defs where proname = 'decide_support_request'), 'decide_support_request mantém a moderação de comentários');
select ok((select def ilike '%no_status%' or def ilike '%no_content%' from _defs where proname = 'decide_support_request'), 'validação de conteúdo alvo presente');
select ok((select def ilike '%''commentId''%' and def ilike '%''listingId''%' from _defs where proname = 'admin_list_support_requests'), 'admin_list_support_requests devolve commentId e listingId');
select ok((select bool_and(prosecdef) from _defs), 'ambas security definer');
select ok((select bool_and(proconfig::text ilike '%search_path%') from _defs), 'ambas com search_path fixo');
select ok((select bool_and(def ilike '%coalesce(public.is_superadmin(), false)%') from _defs), 'checagem de superadmin fail-closed (coalesce) nas duas');

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'mod-guard@example.invalid', 'x', now(), '{}', '{}', now(), now());
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.decide_support_request('{}'::jsonb)$$, 'PERMISSION_DENIED', 'usuário comum não decide pedidos');
select throws_ok($$select public.admin_list_support_requests()$$, 'PERMISSION_DENIED', 'usuário comum não lista pedidos');
select ok(has_function_privilege('authenticated', 'public.decide_support_request(jsonb)', 'execute'), 'authenticated mantém execute (a função se protege por is_superadmin)');

select * from finish();
rollback;
