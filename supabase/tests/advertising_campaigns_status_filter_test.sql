\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
select no_plan();
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
-- Isolate from committed synthetic preview fixtures. Every change rolls back.
update private.commercial_resources set moderation_state='suspended' where offering_code='ad_home';
update public.advertising_placements set capacity=0,revision=0,sales_enabled=false,delivery_enabled=false where code='home_banner';
update public.commercial_offerings set sales_enabled=false where code='ad_home';

-- 20261222000012 (PROMPT_EVOLUTUS_REESTRUTURACAO_PUBLICIDADE.md, seção 4.1): o filtro de
-- status precisa valer sobre o conjunto real, não só a página de 20 carregada, e o resumo
-- de contagens precisa ser exato (nunca soma de uma página parcial).
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('77000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','ads-status-filter-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,2)i;
update public.users set role='superadmin' where id='77000000-0000-0000-0000-000000000002';
create function pg_temp.sf_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('77000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table sf_results(name text primary key,value jsonb); grant all on sf_results to authenticated;

select pg_temp.set_test_user('77000000-0000-0000-0000-000000000001',true);
set local role authenticated;
insert into sf_results values('account',to_jsonb(public.create_advertising_account('Synthetic status-filter advertiser')));

-- Campanha 1: nunca aprovada, ainda "Em análise" (submitted).
select public.create_advertising_campaign((select(value#>>'{}')::uuid from sf_results where name='account'),'home_banner',null,'Em análise','','https://example.invalid/sf-review','77010000-0000-0000-0000-000000000001');
select public.edit_advertising_campaign('77010000-0000-0000-0000-000000000001',1,'Em análise','','https://example.invalid/sf-review',true);

-- Campanha 2: aprovada, paga e com entrega ativa (live).
select public.create_advertising_campaign((select(value#>>'{}')::uuid from sf_results where name='account'),'home_banner',null,'Ativa','','https://example.invalid/sf-live','77020000-0000-0000-0000-000000000001');
select public.edit_advertising_campaign('77020000-0000-0000-0000-000000000001',1,'Ativa','','https://example.invalid/sf-live',true);
reset role;

select pg_temp.sf_admin();
set local role authenticated;
select public.admin_review_advertising_campaign('77020000-0000-0000-0000-000000000001',2,true,'Synthetic status-filter approval');
select public.admin_configure_advertising_placement('home_banner',1,true,true,0,'Synthetic status-filter capacity',true);
reset role;
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'ad_home',coalesce(max(revision),0)+1,7,1,30,clock_timestamp(),'77000000-0000-0000-0000-000000000002','Synthetic status-filter price' from public.commercial_price_versions where offering_code='ad_home';
update public.commercial_offerings set sales_enabled=true where code='ad_home';
select public._wallet_credit_cash('77000000-0000-0000-0000-000000000001',100);
select public._ledger_record('77000000-0000-0000-0000-000000000001','synthetic-status-filter','cash','credit',100,'synthetic','fixture','ads');

select pg_temp.set_test_user('77000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select pg_temp.publish_test_commercial_terms();
insert into sf_results values('quote',public.quote_commercial_order('77020000-0000-0000-0000-000000000001','2',gen_random_uuid()));
insert into sf_results values('paid',pg_temp.confirm_with_terms((select(value->>'id')::uuid from sf_results where name='quote'),true));

-- O filtro recusa um valor que não é um bucket real.
select throws_ok(
 $$select public.get_advertising_campaigns((select(value#>>'{}')::uuid from sf_results where name='account'),null,'nao-existe')$$,
 'INVALID_STATUS_FILTER','valor de filtro desconhecido é rejeitado');

-- Sem filtro: as duas campanhas aparecem.
select is(jsonb_array_length(public.get_advertising_campaigns((select(value#>>'{}')::uuid from sf_results where name='account'))),2,'sem filtro, as duas campanhas aparecem');

-- Filtro 'live': só a campanha paga e ativa, mesmo existindo uma campanha 'submitted' mais recente
-- (ad_id maior) que seria a única nos "20 itens carregados" se o filtro fosse aplicado no cliente.
select is(
 (select jsonb_agg(x->>'ad_id') from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from sf_results where name='account'),null,'live')) x),
 jsonb_build_array('77020000-0000-0000-0000-000000000001'),
 'filtro live retorna só a campanha realmente ativa, mesmo não sendo a mais recente');

-- Filtro 'submitted': só a campanha em análise.
select is(
 (select jsonb_agg(x->>'ad_id') from jsonb_array_elements(public.get_advertising_campaigns((select(value#>>'{}')::uuid from sf_results where name='account'),null,'submitted')) x),
 jsonb_build_array('77010000-0000-0000-0000-000000000001'),
 'filtro submitted retorna só a campanha em análise');

-- Filtro de um bucket sem nenhuma campanha: lista vazia, não erro.
select is(public.get_advertising_campaigns((select(value#>>'{}')::uuid from sf_results where name='account'),null,'archived'),'[]'::jsonb,'bucket sem campanhas devolve lista vazia, não erro');

-- Resumo: contagem exata, nunca soma de página parcial.
select is((public.advertising_campaigns_summary((select(value#>>'{}')::uuid from sf_results where name='account'))->>'total')::integer,2,'resumo conta as duas campanhas da conta');
select is((public.advertising_campaigns_summary((select(value#>>'{}')::uuid from sf_results where name='account'))->>'live')::integer,1,'resumo conta a campanha ativa');
select is((public.advertising_campaigns_summary((select(value#>>'{}')::uuid from sf_results where name='account'))->>'submitted')::integer,1,'resumo conta a campanha em análise');

-- Outra conta nunca vê o resumo/filtro desta.
reset role;
select pg_temp.set_test_user('77000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select throws_ok(
 format('select public.advertising_campaigns_summary(%L::uuid)',(select(value#>>'{}')::uuid from sf_results where name='account')),
 '42501','AD_EDITOR_REQUIRED','outra conta (mesmo superadmin, fora do console) não pode ler o resumo de outra conta');

select * from finish();
rollback;
