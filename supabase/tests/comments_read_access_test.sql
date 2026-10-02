begin;
select no_plan();

-- Guarda: um MEMBRO precisa conseguir LER comentários como o papel authenticated (a RLS de post_comments chama
-- private.can_view_status com os privilégios do usuário). Uma migration que revoga "all functions in schema private"
-- sem reconceder esse EXECUTE quebra a leitura para todos (403 permission denied for function can_view_status).
-- comments_system_test usa o dono das tabelas e por isso não detectava isso.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('b1000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated', 'rd' || n || '-read@example.invalid', 'x', now(), '{}', '{}', now(), now()
from unnest(array['01','02','03']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest, legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id::text like 'b1000000-%';
insert into public.public_profiles (user_id, username) select id, 'reader' || right(id::text, 2) from public.users where id::text like 'b1000000-%';
insert into public.communities (id, name, created_by, owner_id) values ('b2000000-0000-0000-0000-000000000001', 'Leitura', 'b1000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) values
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001'),
  ('b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000002');
insert into public.statuses (id, community_id, author_id, type, text, expires_at)
values ('b3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'b1000000-0000-0000-0000-000000000001', 'text', 'post', now() + interval '1 day');
update private.comment_rate_limits set min_interval = interval '0 seconds', burst_limit = 0 where singleton;
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
select public.comment_create('b3000000-0000-0000-0000-000000000001', null, 'Primeiro comentário', 'b4000000-0000-0000-0000-000000000001');

select ok(has_function_privilege('authenticated', 'private.can_view_status(uuid, uuid)', 'execute'), 'authenticated tem EXECUTE em private.can_view_status (usada pela RLS)');
select ok(not has_function_privilege('anon', 'private.can_view_status(uuid, uuid)', 'execute'), 'anon não tem');
select ok(not has_function_privilege('authenticated', 'private.comment_create(uuid, uuid, text, uuid)', 'execute'), 'implementações privadas de escrita continuam fechadas ao cliente');

set local role authenticated;
-- membro (autor do comentário) e outro membro leem pela view usada pelo app
select is((select count(*)::int from public.comment_list_items where status_id = 'b3000000-0000-0000-0000-000000000001'), 1, 'membro lista comentários pela view comment_list_items');
select is((select author_username from public.comment_list_items where status_id = 'b3000000-0000-0000-0000-000000000001'), 'reader02', 'view traz o autor');
select is((select count(*)::int from public.post_comments where status_id = 'b3000000-0000-0000-0000-000000000001'), 1, 'membro lê post_comments (RLS)');
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000001', true);
select is((select count(*)::int from public.comment_list_items where status_id = 'b3000000-0000-0000-0000-000000000001'), 1, 'o autor do post também lê');
select is((select count(*)::int from public.comment_likes), 0, 'comment_likes legível (policy usa o helper) -- sem erro de permissão');
-- não membro não enxerga (a RLS continua valendo)
select set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000003', true);
select is((select count(*)::int from public.comment_list_items where status_id = 'b3000000-0000-0000-0000-000000000001'), 0, 'não membro não vê comentários');
reset role;

select * from finish();
rollback;
