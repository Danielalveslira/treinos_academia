-- PR2: admin_commercial_pending_counts() must return real totals across the whole
-- table, not a truncated sample, and must stay admin-only. Fixtures reach 'submitted'
-- state directly (update private.*) where the real submission RPC would require extra
-- unrelated setup (approved media, etc.) that the creation/approval RPCs already have
-- their own dedicated tests for -- this file only proves the counting query itself.
\ir _helpers/auth_session.sql
\ir _helpers/cash_purchase.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('7d000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','pending-counts-pr2-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,2)i;
update public.users set role='superadmin' where id='7d000000-0000-0000-0000-000000000002';
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and p.published and u.id::text like '7d000000-%';

create function pg_temp.pr2_owner() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('7d000000-0000-0000-0000-000000000001',true);
end$$;
create function pg_temp.pr2_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('7d000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create temp table pr2_results(name text primary key,value jsonb); grant all on pr2_results to authenticated;

-- Baseline real: conta tudo o que já existir (não assume banco vazio), e cada
-- asserção usa delta contra esse baseline.
select pg_temp.pr2_admin();
set local role authenticated;
insert into pr2_results values('baseline',public.admin_commercial_pending_counts());
reset role;

select pg_temp.pr2_owner();
set local role authenticated;
-- 1) Anúncio pendente: cria via RPC real, força 'submitted' diretamente (fixture).
insert into pr2_results values('account',to_jsonb(public.create_advertising_account('PR2 pending counts advertiser')));
insert into pr2_results values(
 'ad',
 to_jsonb(public.create_advertising_campaign(
  (select(value#>>'{}')::uuid from pr2_results where name='account'),
  'home_banner',null,'PR2 pending ad','','https://example.invalid/pr2-pending','7e100000-0000-0000-0000-000000000001'
 ))
);
reset role;
update private.advertising_drafts set state='submitted' where ad_id=(select(value#>>'{}')::uuid from pr2_results where name='ad');

-- 2) Vitrine pendente: idem, cria via RPC real e força 'submitted' diretamente.
-- Fixture: banco de testes novo não tem limites de vitrine configurados ainda.
update public.storefront_settings set max_storefronts=5,max_products=20 where id;
select pg_temp.pr2_owner();
set local role authenticated;
insert into pr2_results values('storefront',to_jsonb(public.create_product_storefront('PR2 pending storefront','7e200000-0000-0000-0000-000000000001')));
reset role;
update private.commercial_resources set moderation_state='submitted' where id=(select(value#>>'{}')::uuid from pr2_results where name='storefront');

-- 3) Impulsionamento pendente: prepare_commercial_promotion já entrega 'submitted'
-- de verdade (sem fixture forçada), igual ao PR0.
insert into public.communities(id,name,created_by,owner_id) values('7e300000-0000-0000-0000-000000000001','PR2 pending counts community','7d000000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001');
insert into public.community_members(community_id,user_id) values('7e300000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001');
select pg_temp.pr2_owner();
set local role authenticated;
select public.configure_community_advertising('7e300000-0000-0000-0000-000000000001',false,true,0);
insert into pr2_results values('boost',public.prepare_commercial_promotion('community','7e300000-0000-0000-0000-000000000001'));
reset role;

-- 4) Reembolso em aberto: sem atalho de RPC curto (exige todo o fluxo real de
-- pagamento), então o fixture usa o helper compartilhado de cash_purchases já
-- validado por outros testes e insere a linha de refund_requests diretamente --
-- aqui só precisamos de uma linha com status aberto.
insert into pr2_results values('purchase',pg_temp.cash_purchase_fixture('7d000000-0000-0000-0000-000000000001'));
insert into public.refund_requests(id,requester_id,purchase_id,category,intent_id,status,acquisition_snapshot,policy_snapshot,origin_at,deadline_at,timely)
values('7e500000-0000-0000-0000-000000000001','7d000000-0000-0000-0000-000000000001',(select(value->>'id')::uuid from pr2_results where name='purchase'),'withdrawal','7e500000-0000-0000-0000-000000000002','requested','{}','{}',now(),now()+interval '5 days',true);

-- Agora a contagem real deve refletir exatamente +1 em cada categoria.
select pg_temp.pr2_admin();
set local role authenticated;
insert into pr2_results values('after',public.admin_commercial_pending_counts());
reset role;

select is(
 ((select value->>'pendingAds' from pr2_results where name='after')::int - (select value->>'pendingAds' from pr2_results where name='baseline')::int),
 1,
 'um anúncio submitted a mais é contado'
);
select is(
 ((select value->>'pendingStorefronts' from pr2_results where name='after')::int - (select value->>'pendingStorefronts' from pr2_results where name='baseline')::int),
 1,
 'uma vitrine submitted a mais é contada'
);
select is(
 ((select value->>'pendingBoosts' from pr2_results where name='after')::int - (select value->>'pendingBoosts' from pr2_results where name='baseline')::int),
 1,
 'um impulsionamento submitted a mais é contado'
);
select is(
 ((select value->>'openRefunds' from pr2_results where name='after')::int - (select value->>'openRefunds' from pr2_results where name='baseline')::int),
 1,
 'um reembolso aberto a mais é contado'
);

-- Decidir (aprovar/reprovar/concluir) tira da contagem de pendentes -- prova que a
-- contagem reflete o estado real, não um snapshot congelado.
update private.advertising_drafts set state='approved' where ad_id=(select(value#>>'{}')::uuid from pr2_results where name='ad');
update private.commercial_resources set moderation_state='approved' where id=(select(value#>>'{}')::uuid from pr2_results where name='storefront');
update private.commercial_resources set moderation_state='approved' where id=(select(value->>'resourceId')::uuid from pr2_results where name='boost');
-- refund_requests é protegida por gatilho de imutabilidade (private.protect_refund_request,
-- ver refund_requests_test.sql): só a RPC act_on_refund_request pode mudar o status, nunca
-- update direto. A asserção de "segue o estado atual" para reembolsos já foi feita acima
-- (delta +1 ao criar); as três categorias restantes já provam que a contagem não é cache.
select pg_temp.pr2_admin();
set local role authenticated;
insert into pr2_results values('decided',public.admin_commercial_pending_counts());
reset role;
select is(
 (select value->>'pendingAds' from pr2_results where name='decided'),
 (select value->>'pendingAds' from pr2_results where name='baseline'),
 'anúncio decidido volta ao baseline -- a contagem segue o estado atual, não um cache'
);
select is(
 (select value->>'pendingStorefronts' from pr2_results where name='decided'),
 (select value->>'pendingStorefronts' from pr2_results where name='baseline'),
 'vitrine decidida volta ao baseline'
);
select is(
 (select value->>'pendingBoosts' from pr2_results where name='decided'),
 (select value->>'pendingBoosts' from pr2_results where name='baseline'),
 'impulsionamento decidido volta ao baseline'
);

-- Permissão: usuário comum não pode chamar a RPC (só números, mas ainda é dado
-- administrativo -- nenhuma contagem vaza para quem não é superadmin).
select pg_temp.set_test_user('7d000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$select public.admin_commercial_pending_counts()$$,'42501',null,'usuário comum não pode consultar as contagens administrativas');
reset role;

select * from finish();
rollback;
