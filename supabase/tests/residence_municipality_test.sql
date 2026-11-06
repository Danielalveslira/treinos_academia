\ir _helpers/auth_session.sql
begin;
select no_plan();

-- Cidade onde mora (20261209000001): catálogo IBGE do servidor, coluna privada em public.users e a RPC
-- set_residence_municipality. ..01 conta ativa | ..02 conta ativa de controle | ..03 conta desativada |
-- ..04 conta recém-criada SEM aceite legal (momento exato em que o cadastro grava a cidade).
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('e3000000-0000-0000-0000-0000000000' || n)::uuid, 'authenticated', 'authenticated',
       'u' || n || '-city@example.invalid', 'not-used', case when n = '04' then null else now() end,
       '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04']) as n;
update public.users u set legal_acceptance_version = p.version, legal_acceptance_digest = p.digest,
  legal_acceptance_accepted_at = now()
  from public.legal_policy p
  where p.id and p.published and u.id::text like 'e3000000-%' and u.id <> 'e3000000-0000-0000-0000-000000000004';
update public.users set account_status = 'disabled' where id = 'e3000000-0000-0000-0000-000000000003';

create or replace function pg_temp.as_user(p text) returns void language sql as
  $$select pg_temp.set_test_user( case when p = '' then '' else 'e3000000-0000-0000-0000-0000000000' || p end, true)$$;

create or replace function pg_temp.error_of(q text) returns text language plpgsql as
  $$begin execute q; return null; exception when others then return sqlerrm; end$$;

create or replace function pg_temp.city_of(p text) returns integer language sql as
  $$select residence_municipality_code from public.users where id = ('e3000000-0000-0000-0000-0000000000' || p)::uuid$$;

-- === 1) catálogo do servidor ===
select is((select count(*)::int from public.ibge_municipalities), 5571, 'catálogo com os 5.571 municípios do IBGE');
select is((select count(distinct uf)::int from public.ibge_municipalities), 27, '27 UFs');
select is((select name || '/' || uf from public.ibge_municipalities where code = 2412500), 'São Miguel/RN', 'código oficial de São Miguel/RN');
select is((select name || '/' || uf from public.ibge_municipalities where code = 5101837), 'Boa Esperança do Norte/MT', 'município sem microrregião no payload do IBGE também está no catálogo');
select is((select count(*)::int from public.ibge_municipalities where name = 'Bom Jesus'), 5, 'homônimos em UFs diferentes coexistem');
select is((select count(*)::int from public.ibge_municipalities m
            where m.uf <> case code / 100000 when 11 then 'RO' when 12 then 'AC' when 13 then 'AM' when 14 then 'RR'
              when 15 then 'PA' when 16 then 'AP' when 17 then 'TO' when 21 then 'MA' when 22 then 'PI' when 23 then 'CE'
              when 24 then 'RN' when 25 then 'PB' when 26 then 'PE' when 27 then 'AL' when 28 then 'SE' when 29 then 'BA'
              when 31 then 'MG' when 32 then 'ES' when 33 then 'RJ' when 35 then 'SP' when 41 then 'PR' when 42 then 'SC'
              when 43 then 'RS' when 50 then 'MS' when 51 then 'MT' when 52 then 'GO' when 53 then 'DF' end), 0,
  'UF de cada município bate com o prefixo do código');

-- === 2) esquema e segurança ===
select is((select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'users' and column_name = 'residence_municipality_code'),
  'YES', 'coluna nullable: contas existentes continuam válidas');
select is(pg_temp.city_of('01'), null, 'conta existente fica sem cidade (nada é preenchido automaticamente)');
select ok((select relrowsecurity from pg_class where oid = 'public.ibge_municipalities'::regclass), 'RLS ligada no catálogo');
select ok(not has_table_privilege('anon', 'public.ibge_municipalities', 'select'), 'anon não lê o catálogo do servidor');
select ok(not has_table_privilege('authenticated', 'public.ibge_municipalities', 'insert'), 'authenticated não grava no catálogo');
select ok(not has_table_privilege('authenticated', 'public.ibge_municipalities', 'select'), 'authenticated não lê o catálogo do servidor (usa o estático)');
select is((select prosecdef from pg_proc where oid = 'public.set_residence_municipality(integer)'::regprocedure), true, 'RPC é SECURITY DEFINER');
select ok((select proconfig::text like '%search_path=%' from pg_proc where oid = 'public.set_residence_municipality(integer)'::regprocedure), 'search_path fixo');
select ok(not has_function_privilege('anon', 'public.set_residence_municipality(integer)', 'execute'), 'anon não executa a RPC');
select ok(has_function_privilege('authenticated', 'public.set_residence_municipality(integer)', 'execute'), 'authenticated executa a RPC');
select throws_ok($$update public.users set residence_municipality_code = 9999999 where id = 'e3000000-0000-0000-0000-000000000001'$$,
  '23503', null, 'FK recusa código fora do catálogo mesmo por escrita privilegiada');

set local role authenticated;

-- === 3) set_residence_municipality ===
select pg_temp.as_user('01');
select is(public.set_residence_municipality(2412500), 2412500, 'salva e devolve o código');
select is(pg_temp.city_of('01'), 2412500, 'cidade persistida na própria conta');
select is(public.set_residence_municipality(2412500), 2412500, 'repetir o mesmo código é aceito (idempotente)');
select is(public.set_residence_municipality(3550308), 3550308, 'troca de cidade');
select is(pg_temp.error_of($$select public.set_residence_municipality(1234567)$$), 'INVALID_MUNICIPALITY', 'código com formato válido mas inexistente é recusado');
select is(pg_temp.error_of($$select public.set_residence_municipality(99)$$), 'INVALID_MUNICIPALITY', 'código fora do formato é recusado');
select is(pg_temp.error_of($$select public.set_residence_municipality(null)$$), 'INVALID_MUNICIPALITY', 'null é recusado');
select is(pg_temp.city_of('01'), 3550308, 'código inválido não alterou nada');
select is(pg_temp.city_of('02'), null, 'outra conta não foi afetada');

-- Cadastro: a cidade é gravada antes do aceite legal e da confirmação do perfil.
select pg_temp.as_user('04');
select is(public.set_residence_municipality(2412559), 2412559, 'conta recém-criada sem aceite legal grava a cidade (fluxo do cadastro)');

select pg_temp.as_user('');
select is(pg_temp.error_of($$select public.set_residence_municipality(2412500)$$), 'NOT_AUTHENTICATED', 'sem sessão: recusado');

select pg_temp.as_user('03');
select is(pg_temp.error_of($$select public.set_residence_municipality(2412500)$$), 'PERMISSION_DENIED', 'conta desativada: recusado');

-- === 4) isolamento: sem escrita direta, sem leitura da cidade de outra conta, nada no perfil público ===
select pg_temp.as_user('02');
select is(pg_temp.error_of($$update public.users set residence_municipality_code = 2412500 where id = 'e3000000-0000-0000-0000-000000000001'$$) is not null
          or (select residence_municipality_code from public.users where id = 'e3000000-0000-0000-0000-000000000001') is null,
  true, 'UPDATE direto não é caminho de escrita');
select is((select count(*)::int from public.users where id = 'e3000000-0000-0000-0000-000000000001'), 0, 'outra conta não lê a linha (e a cidade) do usuário');
select is((select count(*)::int from information_schema.columns
            where table_schema = 'public' and table_name = 'public_profiles' and column_name like '%municip%'), 0,
  'perfil público não tem cidade');

reset role;
select is(pg_temp.city_of('01'), 3550308, 'cidade da conta 01 intacta após tentativas de outra conta');

-- === 5) set_birth_info: sexo é escolha explícita quando enviado; contas antigas intactas ===
update public.users set sexo = null where id = 'e3000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.as_user('01');
select lives_ok($$select public.set_birth_info('{"sexo":"nao_informar","dataNascimento":"1990-01-01"}'::jsonb)$$, '"Não informar" é escolha válida');
select is(pg_temp.error_of($$select public.set_birth_info('{"sexo":""}'::jsonb)$$), 'INVALID_SEXO', 'sexo vazio é recusado');
select is(pg_temp.error_of($$select public.set_birth_info('{"sexo":null}'::jsonb)$$), 'INVALID_SEXO', 'sexo nulo é recusado');
select is(pg_temp.error_of($$select public.set_birth_info('{"sexo":"outro"}'::jsonb)$$), 'INVALID_SEXO', 'valor fora das opções é recusado');
select lives_ok($$select public.set_birth_info('{"sexo":"feminino"}'::jsonb)$$, 'opção válida aceita');
select pg_temp.as_user('02');
select lives_ok($$select public.set_birth_info('{"dataNascimento":"1985-03-04"}'::jsonb)$$, 'sem a chave sexo (LegalGate de conta antiga) continua funcionando');
select is(pg_temp.error_of($$select public.set_birth_info('{"dataNascimento":"2015-01-01"}'::jsonb)$$), 'MINIMUM_AGE', 'retomada de cadastro não aceita menor de 16 anos');
select is(pg_temp.error_of($$select public.set_birth_info('{"dataNascimento":null}'::jsonb)$$), 'BIRTHDATE_REQUIRED', 'nascimento não pode ser apagado via cadastro');
reset role;
select is((select sexo from public.users where id = 'e3000000-0000-0000-0000-000000000001'), 'feminino', 'sexo persistido');
select is((select sexo from public.users where id = 'e3000000-0000-0000-0000-000000000002'), null, 'conta antiga sem sexo não foi alterada');
select is((select data_nascimento::text from public.users where id = 'e3000000-0000-0000-0000-000000000002'), '1985-03-04', 'nascimento gravado sem exigir sexo');

select * from finish();
rollback;
