\ir _helpers/auth_session.sql
begin;
select no_plan();

-- 20261222000013 (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md, seção 10): linha do
-- tempo editorial/operacional própria do anunciante, nunca a RPC de auditoria
-- administrativa, com actorKind derivado só pelo nome da ação (sem PII).
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('77100000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','ads-ops-history-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,4)i;
update public.users set role='superadmin' where id='77100000-0000-0000-0000-000000000003';
create function pg_temp.oh_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('77100000-0000-0000-0000-000000000003',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table oh_results(name text primary key,value jsonb); grant all on oh_results to authenticated;

select pg_temp.set_test_user('77100000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into oh_results values('account',to_jsonb(public.create_advertising_account('Synthetic ops-history advertiser')));
select public.create_advertising_campaign((select(value#>>'{}')::uuid from oh_results where name='account'),'home_banner',null,'Campanha histórico','','https://example.invalid/ops-history','77110000-0000-0000-0000-000000000001');
select public.edit_advertising_campaign('77110000-0000-0000-0000-000000000001',1,'Campanha histórico','','https://example.invalid/ops-history',false);
select public.edit_advertising_campaign('77110000-0000-0000-0000-000000000001',2,'Campanha histórico','','https://example.invalid/ops-history',true);
reset role;

-- Um gerente autorizado (outro usuário, não o dono) na mesma conta.
insert into public.advertiser_members(account_id,user_id,permission,granted_by)
select (select(value#>>'{}')::uuid from oh_results where name='account'),'77100000-0000-0000-0000-000000000002','manager','77100000-0000-0000-0000-000000000001';

select pg_temp.oh_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('77110000-0000-0000-0000-000000000001',3,false,'Motivo sintético de reprovação');
reset role;

select pg_temp.set_test_user('77100000-0000-0000-0000-000000000002',true);
set local role authenticated;
select public.edit_advertising_campaign('77110000-0000-0000-0000-000000000001',3,'Campanha histórico corrigida','','https://example.invalid/ops-history',true);
reset role;

select pg_temp.oh_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('77110000-0000-0000-0000-000000000001',4,true,'Motivo sintético de aprovação');
reset role;

-- Ordem real: create -> submit (1a) -> reject -> submit (correção) -> approve.
select pg_temp.set_test_user('77100000-0000-0000-0000-000000000001',true);
set local role authenticated;

-- Nenhuma leitura de auditoria administrativa é concedida aqui -- é uma RPC própria.
select throws_ok(
 $$select public.admin_advertising_operations(null)$$,
 '42501','a conta comum nunca tem acesso à RPC de auditoria administrativa ao tentar usá-la');

insert into oh_results values('history',public.get_advertising_operations_for_advertiser('77110000-0000-0000-0000-000000000001'));
select is((select jsonb_agg(x->>'action') from jsonb_array_elements((select value from oh_results where name='history')) x),
 '["approve", "submit", "reject", "submit", "create"]'::jsonb,
 'linha do tempo real, mais recente primeiro: create, submit (1a), reject, submit (correção), approve -- edit nunca aparece');

select is((select x->>'actorKind' from jsonb_array_elements((select value from oh_results where name='history')) x where x->>'action'='create'),'self','a criação é do próprio dono, que é quem está lendo agora');
select is((select x->>'actorKind' from jsonb_array_elements((select value from oh_results where name='history')) x where x->>'action'='approve'),'admin','aprovação só pode ter sido feita pela equipe Evolutus');
select is((select x->>'actorKind' from jsonb_array_elements((select value from oh_results where name='history')) x where x->>'action'='reject'),'admin','reprovação também só pode ter sido feita pela equipe Evolutus');
select is((select x->>'reason' from jsonb_array_elements((select value from oh_results where name='history')) x where x->>'action'='reject'),'Motivo sintético de reprovação','o motivo público da reprovação é preservado');

-- A segunda submissão (correção) foi feita pelo gerente, não pelo dono que está lendo agora.
select is((select x->>'actorKind' from jsonb_array_elements((select value from oh_results where name='history')) x where x->>'action'='submit' order by (x->>'id')::bigint asc limit 1),'other','a submissão feita por um gerente autorizado nunca aparece como "Você" pra outra pessoa da conta');

-- O gerente, por sua vez, vê a própria submissão como "Você" e a do dono como "other".
reset role;
select pg_temp.set_test_user('77100000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select x->>'actorKind' from jsonb_array_elements(public.get_advertising_operations_for_advertiser('77110000-0000-0000-0000-000000000001')) x where x->>'action'='submit' order by (x->>'id')::bigint asc limit 1),'self','o próprio gerente vê a sua submissão como "Você"');
reset role;

-- Paginação por cursor (id): o mais antigo nunca tem página seguinte; o mais recente,
-- como cursor, exclui a si mesmo e devolve exatamente o resto.
select pg_temp.set_test_user('77100000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into oh_results values('oldest_id',(select min((x->>'id')::bigint) from jsonb_array_elements((select value from oh_results where name='history')) x));
insert into oh_results values('newest_id',(select max((x->>'id')::bigint) from jsonb_array_elements((select value from oh_results where name='history')) x));
select is(public.get_advertising_operations_for_advertiser('77110000-0000-0000-0000-000000000001',(select(value#>>'{}')::bigint from oh_results where name='oldest_id')),'[]'::jsonb,'nada é mais antigo que o evento mais antigo');
select is(jsonb_array_length(public.get_advertising_operations_for_advertiser('77110000-0000-0000-0000-000000000001',(select(value#>>'{}')::bigint from oh_results where name='newest_id'))),4,'cursor no mais recente devolve exatamente os outros quatro, nunca ele mesmo');

-- Uma conta sem nenhum vínculo com este anúncio nunca lê seu histórico.
reset role;
select pg_temp.set_test_user('77100000-0000-0000-0000-000000000004',true);
set local role authenticated;
select public.create_advertising_account('Synthetic ops-history outsider');
select throws_ok(
 format('select public.get_advertising_operations_for_advertiser(%L::uuid)','77110000-0000-0000-0000-000000000001'),
 '42501','AD_EDITOR_REQUIRED','uma conta sem vínculo com este anúncio nunca lê seu histórico');

select * from finish();
rollback;
