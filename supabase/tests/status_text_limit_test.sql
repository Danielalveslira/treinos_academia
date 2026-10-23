\ir _helpers/auth_session.sql
begin;
select no_plan();

insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
values ('b1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'u1-textlimit@example.invalid', 'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p where p.id and p.published and u.id = 'b1000000-0000-0000-0000-000000000001';
insert into public.communities (id, name, created_by) values ('b2000000-0000-0000-0000-00000000000a', 'Limite de texto', 'b1000000-0000-0000-0000-000000000001');
insert into public.community_members (community_id, user_id) values ('b2000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001');

create or replace function pg_temp.post(p_text text) returns void language sql as
  $f$insert into public.statuses (community_id, author_id, type, text)
     values ('b2000000-0000-0000-0000-00000000000a', 'b1000000-0000-0000-0000-000000000001', 'text', p_text)$f$;

set local role authenticated;
select pg_temp.set_test_user( 'b1000000-0000-0000-0000-000000000001', true);

select lives_ok($$select pg_temp.post('x')$$, '1 caractere continua válido');
select lives_ok($$select pg_temp.post(repeat('a', 500))$$, '500 caracteres (limite antigo) continuam válidos');
select lives_ok($$select pg_temp.post(repeat('d', 1000))$$, '1000 caracteres (limite intermediário) continuam válidos');
select lives_ok($$select pg_temp.post(repeat('b', 7000))$$, '7000 caracteres exatos são aceitos');
select throws_ok($$select pg_temp.post(repeat('c', 7001))$$, '23514', null, '7001 caracteres são recusados pelo banco');
select throws_ok($$select pg_temp.post('')$$, '23514', null, 'texto vazio continua recusado');

-- Markdown com título, lista, citação e tabela, exatamente 7000 caracteres, volta byte a byte igual
-- (o banco não normaliza quebras de linha nem barras verticais).
create temp table _md as
  select rpad(E'# Título\n\n- item **um**\n- item _dois_\n\n> citação\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n', 7000, 'x') as body;
select is(char_length((select body from _md)), 7000, 'amostra de markdown tem exatamente 7000 caracteres');
select lives_ok($$select pg_temp.post((select body from _md))$$, 'markdown de 7000 caracteres é aceito');
select is(
  (select text from public.statuses where community_id = 'b2000000-0000-0000-0000-00000000000a' and text like '# Título%'),
  (select body from _md),
  'markdown (títulos, listas, citação, tabela, quebras de linha) é preservado integralmente'
);

select * from finish();
rollback;
