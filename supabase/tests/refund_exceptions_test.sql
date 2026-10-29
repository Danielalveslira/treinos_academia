\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
begin;
select no_plan();
delete from public.legal_policy;
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fb000000-0000-0000-0000-000000000001','authenticated','authenticated','refund-exception-owner@example.invalid','x',now(),'{}','{}',now(),now()),
('fb000000-0000-0000-0000-000000000002','authenticated','authenticated','refund-exception-admin@example.invalid','x',now(),'{}','{}',now(),now());
update public.users set role='superadmin' where id='fb000000-0000-0000-0000-000000000002';
create function pg_temp.exception_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('fb000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint)))::text,true);
end$$;
update private.refund_settings set financial_requests_enabled=true,settlement_enabled=true,expected_merchant='synthetic-merchant' where id;
create temp table sources(name text,p jsonb);
insert into sources values('old',pg_temp.cash_purchase_fixture('fb000000-0000-0000-0000-000000000001',25,590));
-- A complete old receipt fixture, including original ledger. This sets up a
-- past acquisition; it does NOT mutate a real contract's immutable terms.
update public.cash_purchases set status='credited',credited_at=now()-interval '10 days',provider_transaction_nsu='old-txn' where id=(select (p->>'id')::uuid from sources where name='old');
select public._wallet_credit_cash('fb000000-0000-0000-0000-000000000001',25);
select public._ledger_record('fb000000-0000-0000-0000-000000000001','old-fixture','cash','credit',25,'cash_purchase_confirmed','cash_purchase',(select p->>'id' from sources where name='old'));
insert into sources values('new',pg_temp.cash_purchase_fixture('fb000000-0000-0000-0000-000000000001',25,1000));
select public.confirm_infinitepay_cash_purchase((select (p->>'id')::uuid from sources where name='new'),(select p->>'orderNsu' from sources where name='new'),'new-txn','new-inv',1000,'pix',null);
select pg_temp.set_test_user('fb000000-0000-0000-0000-000000000001',true);
select is(public.get_refund_source('purchase',(select (p->>'id')::uuid from sources where name='old'))->>'withdrawalOpen','false','backend closes new unmotivated withdrawal after civil deadline');
select throws_ok($$select public.create_refund_request('purchase',(select (p->>'id')::uuid from sources where name='old'),'withdrawal','',gen_random_uuid())$$,'WITHDRAWAL_WINDOW_CLOSED_USE_COMPLAINT','new late withdrawal blocked without extinguishing other rights');
select lives_ok($$select public.create_refund_request('purchase',(select (p->>'id')::uuid from sources where name='old'),'service_failure','Falha no serviço após o prazo de arrependimento',gen_random_uuid())$$,'service failure remains accessible after seven days');
select is(public.get_refund_source('purchase',(select (p->>'id')::uuid from sources where name='old'))->'acquisition'->>'paidCentavos','590','older price comes from older payment');
select is(public.get_refund_source('purchase',(select (p->>'id')::uuid from sources where name='new'))->'acquisition'->>'paidCentavos','1000','same units at a different price use original payment');
select is(public.get_refund_source('purchase',(select (p->>'id')::uuid from sources where name='new'))->'acquisition'->>'promotionalUnits','not_classifiable_from_current_ledger','promotional attribution never fabricated');
select public._wallet_debit_cash('fb000000-0000-0000-0000-000000000001',40);
select public._ledger_record('fb000000-0000-0000-0000-000000000001','spent-fixture','cash','debit',40,'test','test','partial-consumption');
create temp table req as select public.create_refund_request('purchase',(select (p->>'id')::uuid from sources where name='new'),'withdrawal','',gen_random_uuid()) r;
select is((select r->>'reservedUnits' from req),'10','partial balance reserves only actual available aggregate units');
select is((select r->'acquisition'->>'paidCentavos' from req),'1000','partial use does not reduce legal amount automatically');
select is((select r->'acquisition'->>'provenance' from req),'untracked','no arbitrary attribution to first or last recharge');
select pg_temp.exception_admin();
select public.act_on_refund_request((select (r->>'id')::uuid from req),'review','Revisão de consumo parcial e enquadramento jurídico',gen_random_uuid(),1);
select public.act_on_refund_request((select (r->>'id')::uuid from req),'approve','Análise sintética fundamentada do valor integral',gen_random_uuid(),2,'{"legalReview":"confirmed","relatedContractsReview":"confirmed","basis":"Restituição integral revisada sem desconto por consumo parcial","partyClassification":"company"}');
select public.act_on_refund_request((select (r->>'id')::uuid from req),'provider_pending','Estorno externo em processamento sem execução automática',gen_random_uuid(),3);
select public.act_on_refund_request((select (r->>'id')::uuid from req),'provider_failed','Timeout externo exige conferência no canal oficial',gen_random_uuid(),4);
select is((select reserved_units from public.refund_requests where id=(select (r->>'id')::uuid from req)),10::bigint,'provider timeout/failure does not release contested balance');
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from req),'complete','Não há prova de devolução efetiva',gen_random_uuid(),5)$$,'REFUND_TRANSITION_DENIED','provider failure cannot be completed');
select public.act_on_refund_request((select (r->>'id')::uuid from req),'provider_pending','Operador conferindo transação original',gen_random_uuid(),5);
select public.act_on_refund_request((select (r->>'id')::uuid from req),'confirm_provider','Evidência administrativa sintética de restituição integral',gen_random_uuid(),6,
 jsonb_build_object('channel','infinitepay_original_payment','verification','administrative_evidence_only','externalId','exception-refund-id','reference','synthetic-proof-secret-reference','transactionNsu','new-txn','currency','BRL','merchant','synthetic-merchant','amountCentavos','1000','occurredAt',clock_timestamp()));
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from req),'complete','Liquidação de caso com créditos consumidos',gen_random_uuid(),8)$$,'CONSUMED_OR_UNRESERVED_CREDITS_REQUIRE_INVESTIGATION','consumption exception blocks inconsistent automatic completion');
select is((select reserved_units from public.refund_requests where id=(select (r->>'id')::uuid from req)),10::bigint,'failed completion leaves reservation and protocol intact');
select is((select count(*)::integer from public.refund_settlements where request_id=(select (r->>'id')::uuid from req)),0,'failed completion creates no settlement');
select pg_temp.set_test_user('fb000000-0000-0000-0000-000000000001',true);
select ok(public.get_refund_request((select (r->>'id')::uuid from req))::text not like '%synthetic-proof-secret-reference%','customer projection does not expose administrative evidence');
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from req),'cancel','Tentativa de cancelar após estorno confirmado',gen_random_uuid(),8)$$,'REFUND_TRANSITION_DENIED','requester cannot release hold after confirmed external refund');
select pg_temp.exception_admin();
select public.act_on_refund_request((select (r->>'id')::uuid from req),'investigate','Divergência de recuperação encaminhada para investigação',gen_random_uuid(),8);
select is((select status from public.refund_requests where id=(select (r->>'id')::uuid from req)),'disputed','manual investigation explicit and durable');
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from req),'reject','Recusa após investigação não pode liberar restituição comprovada',gen_random_uuid(),9)$$,'EXTERNAL_REFUND_REQUIRES_RECONCILIATION','investigation cannot release credits after proved external refund');
select public.act_on_refund_request((select (r->>'id')::uuid from req),'review','Revisão de conciliação preserva prova anterior',gen_random_uuid(),9);
select pg_temp.set_test_user('fb000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from req),'cancel','Cancelamento após investigação não libera estorno comprovado',gen_random_uuid(),10)$$,'EXTERNAL_REFUND_REQUIRES_RECONCILIATION','requester cannot release proved refund through review round trip');
select is((select reserved_units from public.refund_requests where id=(select (r->>'id')::uuid from req)),10::bigint,'both denied releases preserve exact hold');
select pg_temp.exception_admin();
-- A legitimately timely request whose analysis occurs after its preserved deadline.
select public.act_on_refund_request(id,'reject','Resposta fundamentada sintética ao problema anterior',gen_random_uuid(),revision) from public.refund_requests where purchase_id=(select (p->>'id')::uuid from sources where name='old');
create temp table past as
with inserted as (insert into public.refund_requests(requester_id,purchase_id,category,explanation,intent_id,acquisition_snapshot,policy_snapshot,origin_at,deadline_at,timely,created_at)
select 'fb000000-0000-0000-0000-000000000001',(p->>'id')::uuid,'withdrawal','',gen_random_uuid(),'{}','{}',now()-interval '10 days',now()-interval '3 days',true,now()-interval '4 days' from sources where name='old'
returning id) select * from inserted;

select lives_ok($$select public.act_on_refund_request((select id from past),'review','Análise posterior respeitando manifestação tempestiva',gen_random_uuid(),1)$$,'timely request remains valid when reviewed after deadline');
select is((select timely from public.refund_requests where id=(select id from past)),true,'review never recalculates timely snapshot');
select pg_temp.set_test_user('fb000000-0000-0000-0000-000000000001',true);
update public.users set account_status='disabled' where id='fb000000-0000-0000-0000-000000000001';
select throws_ok($$select public.get_refund_policy()$$,'42501','APP_ACCESS_DENIED','blocked account cannot invoke financial module');
update public.users set account_status='active' where id='fb000000-0000-0000-0000-000000000001';
set local role authenticated;
select throws_ok($$select * from public.refund_requests$$,'42501','permission denied for table refund_requests','RLS and grants reject direct customer table access');
reset role;

select is(public.get_refund_balance()->>'reserved','10','server projects reserved funds separately from total');
select is(public.get_refund_balance()->>'available','0','available funds never include held balance');
select is(jsonb_array_length(public.list_refund_events((select (r->>'id')::uuid from req),null,1)),1,'event history bounded by requested page size');
select ok(public.list_refund_events((select (r->>'id')::uuid from req))::text not like '%synthetic-proof-secret-reference%','paginated history also hides administrative evidence');
select throws_ok($$select public.list_refund_events((select (r->>'id')::uuid from req),null,101)$$,'INVALID_PAGE','unbounded event pages refused');
select * from finish();
rollback;
