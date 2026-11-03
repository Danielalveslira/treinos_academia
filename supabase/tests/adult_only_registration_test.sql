\ir _helpers/auth_session.sql
-- 20261212000004 (+ regra 18+ de accept_legal_documents em 20261212000001): cadastro exclusivo
-- para 18 anos completos no dia civil de America/Sao_Paulo, por API direta e retomada de perfil.
begin;
select no_plan();

create temp table d as select
  (now() at time zone 'America/Sao_Paulo')::date as today,
  ((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date as adult18,
  (((now() at time zone 'America/Sao_Paulo')::date - interval '18 years')::date + 1) as minor_by_one_day;
grant select on d to authenticated;

-- Política histórica ainda declarando 12 anos (como a 1.5.0 publicada).
insert into public.legal_versions(version,manifest,documents,digest) values
 ('72.0.0','{"version":"72.0.0","published":true,"minimumAge":12}','[{"id":"terms","title":"Histórico"}]',repeat('e',64));
select private.publish_legal_policy('72.0.0',repeat('e',64));

insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('72a00000-0000-0000-0000-00000000000'||i)::uuid,'authenticated','authenticated','adult-'||i||'@example.invalid',now(),'{}','{}',now(),now()
from generate_series(1,5) i;
create function pg_temp.err(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return null; exception when others then return sqlerrm; end $$;

-- 1) Fronteira exata dos 18 anos ----------------------------------------------------------
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000001',true);
select is(pg_temp.err(format($$select public.set_birth_info(jsonb_build_object('dataNascimento',%L))$$,(select minor_by_one_day from d))),
  'MINIMUM_AGE','um dia antes do 18º aniversário: recusado');
select is(pg_temp.err(format($$select public.set_birth_info(jsonb_build_object('dataNascimento',%L))$$,(select today+1 from d))),
  'MINIMUM_AGE','data futura: recusada');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"2004-02-30"}'::jsonb)$$),'INVALID_BIRTHDATE','data inexistente (30/02)');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"2003-02-29"}'::jsonb)$$),'INVALID_BIRTHDATE','29/02 em ano não bissexto');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1890-01-01"}'::jsonb)$$),'INVALID_BIRTHDATE','idade implausível');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":null}'::jsonb)$$),'BIRTHDATE_REQUIRED','nulo não apaga nem burla');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":""}'::jsonb)$$),'BIRTHDATE_REQUIRED','vazio não apaga nem burla');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":20000101}'::jsonb)$$),'BIRTHDATE_REQUIRED','tipo não textual recusado');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"01/01/2000"}'::jsonb)$$),'BIRTHDATE_REQUIRED','formato fora de AAAA-MM-DD recusado');
reset role;
select is((select data_nascimento from public.users where id='72a00000-0000-0000-0000-000000000001'),null,'nenhuma tentativa recusada gravou data');
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000001',true);
select is(pg_temp.err(format($$select public.set_birth_info(jsonb_build_object('dataNascimento',%L,'sexo','nao_informar'))$$,(select adult18 from d))),
  null,'exatamente no 18º aniversário: aceito');
reset role;
select is((select data_nascimento from public.users where id='72a00000-0000-0000-0000-000000000001'),(select adult18 from d),'data adulta persistida');
select is((select sexo from public.users where id='72a00000-0000-0000-0000-000000000001'),'nao_informar','sexo persistido junto');

-- 29/02: mesma aritmética no servidor (age()) e na regra de bloqueio.
select is(extract(year from age(date '2026-02-28', date '2008-02-29'))::int,17,'29/02: 17 anos em 28/02 de ano comum');
select ok(date '2008-02-29' > (date '2026-02-28' - interval '18 years')::date,'29/02: regra de bloqueio coincide com age() em 28/02');
select is(extract(year from age(date '2026-03-01', date '2008-02-29'))::int,18,'29/02: 18 anos em 01/03');
select ok(not (date '2008-02-29' > (date '2026-03-01' - interval '18 years')::date),'29/02: liberado em 01/03');

-- 2) Retomada de perfil e troca posterior da data ------------------------------------------
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000001',true);
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1990-01-01"}'::jsonb)$$),null,'perfil incompleto: correção adulta permitida (retomada)');
reset role;
update public.users set username='adultone' where id='72a00000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000001',true);
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1990-01-01"}'::jsonb)$$),null,'mesmo valor após conclusão: idempotente');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1980-01-01"}'::jsonb)$$),'BIRTHDATE_LOCKED','perfil concluído: data não é trocada por API');
reset role;
select is((select data_nascimento from public.users where id='72a00000-0000-0000-0000-000000000001'),date '1990-01-01','data concluída permanece');

-- Conta preexistente de menor não se declara adulta depois para liberar compras.
update public.users set username='legacyteen', data_nascimento=(select today from d)-interval '16 years' where id='72a00000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000002',true);
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1990-01-01"}'::jsonb)$$),'BIRTHDATE_LOCKED','menor preexistente não troca a própria data');
reset role;
select ok(private.is_known_minor('72a00000-0000-0000-0000-000000000002'),'continua identificada como menor (compras bloqueadas)');

-- 3) Sessão: sem sessão e sessão revogada ---------------------------------------------------
set local role authenticated;
select pg_temp.set_test_user('',true);
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1990-01-01"}'::jsonb)$$),'NOT_AUTHENTICATED','sem sessão');
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000003',true);
select pg_temp.revoke_test_session('72a00000-0000-0000-0000-000000000003');
select is(pg_temp.err($$select public.set_birth_info('{"dataNascimento":"1990-01-01"}'::jsonb)$$),'APP_ACCESS_DENIED','sessão revogada');
reset role;
select is((select data_nascimento from public.users where id='72a00000-0000-0000-0000-000000000003'),null,'sessão revogada não gravou nada');

-- 4) Aceite com política histórica de 12 anos: servidor exige 18 ---------------------------
update public.users set data_nascimento=(select minor_by_one_day from d) where id='72a00000-0000-0000-0000-000000000004';
update public.users set data_nascimento=(select adult18 from d) where id='72a00000-0000-0000-0000-000000000005';
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000004',true);
select is(pg_temp.err(format($$select public.accept_legal_documents(jsonb_build_object('version','72.0.0','digest',%L,'accepted',true))$$,repeat('e',64))),
  'MINIMUM_AGE','17 anos não aceita mesmo com manifesto histórico de 12');
select ok(not coalesce(public.has_app_access(),false),'conta de 17 anos não fica utilizável');
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000005',true);
select is(pg_temp.err(format($$select public.accept_legal_documents(jsonb_build_object('version','72.0.0','digest',%L,'accepted',true))$$,repeat('e',64))),
  null,'exatamente 18 anos aceita');
select ok(public.has_app_access(),'adulto obtém acesso');
reset role;
update public.users set data_nascimento=null where id='72a00000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.set_test_user('72a00000-0000-0000-0000-000000000003',true);
select is(pg_temp.err(format($$select public.accept_legal_documents(jsonb_build_object('version','72.0.0','digest',%L,'accepted',true))$$,repeat('e',64))),
  'BIRTHDATE_REQUIRED','conta sem nascimento não aceita');
select ok(not coalesce(public.has_app_access(),false),'conta sem nascimento não fica utilizável');
reset role;
select is((select count(*)::int from public.legal_acceptances where user_id in ('72a00000-0000-0000-0000-000000000003','72a00000-0000-0000-0000-000000000004')),0,'nenhuma evidência de aceite para recusados');
select is((select legal_acceptance_version from public.users where id='72a00000-0000-0000-0000-000000000004'),null,'estado do menor não foi alterado');
select is((select manifest->>'minimumAge' from public.legal_versions where version='72.0.0'),'12','versão histórica permanece inalterada (idade declarada não reescrita)');
select is((select digest from public.legal_versions where version='72.0.0'),repeat('e',64),'digest histórico inalterado');

-- 5) Endurecimento -------------------------------------------------------------------------
select ok(not has_function_privilege('anon','public.set_birth_info(jsonb)','execute'),'anônimo não grava nascimento');
select ok(has_function_privilege('authenticated','public.set_birth_info(jsonb)','execute'),'usuário autenticado continua usando a RPC');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid='public.set_birth_info(jsonb)'::regprocedure),'search_path vazio');
select ok((select prosecdef from pg_proc where oid='public.set_birth_info(jsonb)'::regprocedure),'SECURITY DEFINER preservado');

select * from finish();
rollback;
