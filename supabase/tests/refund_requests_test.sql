\ir _helpers/cash_purchase.sql
\ir _helpers/auth_session.sql
begin;
create extension if not exists pgtap with schema extensions;
set search_path=public,extensions;
select no_plan();
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
values('fa000000-0000-0000-0000-000000000001','authenticated','authenticated','refund-owner@example.invalid','x',now(),'{}','{}',now(),now()),
('fa000000-0000-0000-0000-000000000002','authenticated','authenticated','refund-admin@example.invalid','x',now(),'{}','{}',now(),now()),
('fa000000-0000-0000-0000-000000000003','authenticated','authenticated','refund-other@example.invalid','x',now(),'{}','{}',now(),now());
-- Preserve the shared legal policy row: deleting it holds a row lock throughout this
-- transaction and interferes with commercial_terms_evidence_test in pg_prove.
update public.users u set legal_acceptance_version=p.version,
  legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
  from public.legal_policy p where p.id and u.id::text like 'fa000000-%';
update public.users set role='superadmin' where id='fa000000-0000-0000-0000-000000000002';
create function pg_temp.refund_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('fa000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{amr}',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint)))::text,true);
end$$;
create temp table purchases as select pg_temp.cash_purchase_fixture('fa000000-0000-0000-0000-000000000001',25,590) p;
select public.confirm_infinitepay_cash_purchase((select (p->>'id')::uuid from purchases),(select p->>'orderNsu' from purchases),'refund-txn','refund-inv',590,'pix',null);
select pg_temp.set_test_user('fa000000-0000-0000-0000-000000000001',true);
select is(public.get_refund_policy()->>'approved','false','policy is unapproved draft');
select is(public.get_refund_policy()->>'requestsEnabled','false','financial requests default closed');
-- Scoped to this test's own purchase, never a global count: refund_contract_terms has no
-- per-test fixture prefix to isolate on (unlike the 76xxx/fa0xxx synthetic ids used elsewhere),
-- so counting the whole table coupled this assertion to whatever else writes to it, in this
-- file or any other run before it, instead of to the one fact this test actually verifies.
select is((select count(*)::integer from public.refund_contract_terms where purchase_id=(select (p->>'id')::uuid from purchases)),1,'receipt freezes exactly one policy for this purchase');
select throws_ok($$select public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'withdrawal','','fa000000-0000-0000-0000-000000000010')$$,'REFUND_REQUESTS_NOT_ENABLED','withdrawal behind safe rollout');
create temp table requests as select public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'service_failure','Compra não recebida corretamente','fa000000-0000-0000-0000-000000000011') r;
select ok((select r->>'protocol' from requests) like 'EVR-%','immediate protocol');
select is((select count(*)::integer from public.refund_request_events),1,'creation appends one event');
select is(public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'service_failure','Compra não recebida corretamente','fa000000-0000-0000-0000-000000000011')->>'id',(select r->>'id' from requests),'network retry recovers protocol');
select throws_ok($$select public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'fraud','different payload','fa000000-0000-0000-0000-000000000011')$$,'IDEMPOTENCY_CONFLICT','intent cannot be reused with another payload');
select is(public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'other','Another click on same source','fa000000-0000-0000-0000-000000000012')->>'id',(select r->>'id' from requests),'distinct click on active source returns existing case');
select is((select count(*)::integer from public.refund_requests),1,'one active request per source');
select pg_temp.set_test_user('fa000000-0000-0000-0000-000000000003',true);
select throws_ok($$select public.get_refund_source('purchase',(select (p->>'id')::uuid from purchases))$$,'REFUND_SOURCE_NOT_FOUND','cannot query another owner source');
select throws_ok($$select public.get_refund_request((select (r->>'id')::uuid from requests))$$,'REFUND_NOT_FOUND','cannot query another case');
select is(public.list_refund_requests(),'[]'::jsonb,'list isolates accounts');
select throws_ok($$select public.list_refund_requests(true)$$,'42501','PERMISSION_DENIED','ordinary user cannot open admin queue');
select pg_temp.set_test_user('fa000000-0000-0000-0000-000000000001',true);
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'cancel','Cancelamento solicitado pelo titular','fa000000-0000-0000-0000-000000000013',1);
update private.refund_settings set financial_requests_enabled=true where id;
truncate requests;
insert into requests select public.create_refund_request('purchase',(select (p->>'id')::uuid from purchases),'withdrawal','','fa000000-0000-0000-0000-000000000014');
select is((select r->>'timely' from requests),'true','timely request frozen on receipt');
select is((select r->>'reservedUnits' from requests),'25','specific contested aggregate units reserved atomically');
select is((select cash_balance::numeric from public.wallets where user_id='fa000000-0000-0000-0000-000000000001'),25::numeric,'reservation is not consumption');
select throws_ok($$select public._wallet_debit_cash('fa000000-0000-0000-0000-000000000001',1)$$,'CASH_RESERVED_FOR_REFUND','all existing spend paths respect reservation');
select throws_ok($$update public.refund_requests set deadline_at=now()$$,'REFUND_HISTORY_IMMUTABLE','deadline immutable even via privileged update');
select throws_ok($$delete from public.refund_request_events$$,'42501','COMMERCIAL_HISTORY_IMMUTABLE','append-only events');
select ok(not has_sequence_privilege('authenticated','public.refund_requests_sequence_id_seq','USAGE'),'customer cannot consume audit sequence');
select ok(not has_table_privilege('authenticated','public.refund_requests','SELECT'),'no direct case data access');
select ok(not has_table_privilege('authenticated','public.refund_requests','INSERT'),'no direct state mutation');
select ok(not has_function_privilege('authenticated','private.refund_json(public.refund_requests)','EXECUTE'),'internal projection not public');
select pg_temp.set_test_user('fa000000-0000-0000-0000-000000000002',true);
-- set_test_user dá amr=password fresco por padrão agora (is_full_login_session()); este teste
-- quer um JWT com login antigo (amr presente, mas não recente) -- remover o amr por completo
-- derrubaria is_full_login_session()/has_app_access() primeiro, trocando a mensagem esperada.
select set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from now()-interval '1 hour')::bigint))))::text,true);
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from requests),'review','Análise administrativa iniciada','fa000000-0000-0000-0000-000000000020',1)$$,'42501','RECENT_AUTH_REQUIRED','admin decision needs recent signed authentication');
select pg_temp.refund_admin();
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'review','Análise administrativa iniciada','fa000000-0000-0000-0000-000000000020',1);
select is(public.act_on_refund_request((select (r->>'id')::uuid from requests),'review','Análise administrativa iniciada','fa000000-0000-0000-0000-000000000020',1)->>'status','under_review','decision replay ignores now-stale revision');
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from requests),'complete','Concluir sem pagamento é inválido','fa000000-0000-0000-0000-000000000021',2)$$,'REFUND_TRANSITION_DENIED','approval does not complete payment');
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from requests),'approve','Aprovação sem revisão jurídica','fa000000-0000-0000-0000-000000000022',2)$$,'LEGAL_AND_CONTRACT_REVIEW_REQUIRED','partial use not automatically discounted');
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'approve','Restituição integral juridicamente revisada','fa000000-0000-0000-0000-000000000022',2,'{"legalReview":"confirmed","relatedContractsReview":"confirmed","basis":"Análise sintética de restituição integral e de todos contratos acessórios","partyClassification":"individual"}');
select is((select status from public.refund_requests where id=(select (r->>'id')::uuid from requests)),'approved','approved stays unpaid');
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'provider_pending','Operador realizará estorno no canal original','fa000000-0000-0000-0000-000000000023',3);
create temp table evidence as select jsonb_build_object('channel','infinitepay_original_payment','verification','administrative_evidence_only','externalId','refund-proof-1','reference','provider-document-1','transactionNsu','refund-txn','currency','BRL','merchant','synthetic-merchant','amountCentavos','590','occurredAt',clock_timestamp()) v;
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from requests),'confirm_provider','Prova administrativa de devolução integral','fa000000-0000-0000-0000-000000000024',4,(select v from evidence))$$,'REFUND_SETTLEMENT_NOT_ENABLED','settlement gate defaults closed');
update private.refund_settings set settlement_enabled=true,expected_merchant='synthetic-merchant' where id;
update public.economy_config set config=jsonb_set(config,'{financialControls,reversalsEnabled}','true') where id;
select throws_ok($$select public.act_on_refund_request((select (r->>'id')::uuid from requests),'confirm_provider','Prova de montante parcial divergente','fa000000-0000-0000-0000-000000000025',4,(select v||'{"amountCentavos":"200"}'::jsonb from evidence))$$,'PARTIAL_OR_PREVIOUS_REVERSAL_REQUIRES_INVESTIGATION','partial reversal stays investigation; no invented proration');
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'confirm_provider','Prova administrativa de devolução integral','fa000000-0000-0000-0000-000000000024',4,(select v from evidence));
select is((select cash_balance::numeric from public.wallets where user_id='fa000000-0000-0000-0000-000000000001'),25::numeric,'evidence alone does not mutate wallet');
select public.act_on_refund_request((select (r->>'id')::uuid from requests),'complete','Conciliação integral da devolução comprovada','fa000000-0000-0000-0000-000000000026',6);
select is((select cash_balance::numeric from public.wallets where user_id='fa000000-0000-0000-0000-000000000001'),0::numeric,'official reversal consumes reserved units exactly once');
select is((select count(*)::integer from public.cash_purchase_reversals where provider_event_id='refund-proof-1'),1,'one official reversal');
select is((select count(*)::integer from public.refund_settlements),1,'one settlement referencing original reversal');
select is(public.act_on_refund_request((select (r->>'id')::uuid from requests),'complete','Conciliação integral da devolução comprovada','fa000000-0000-0000-0000-000000000026',6)->>'status','completed','completion replay returns original result');
select is((select count(*)::integer from public.economy_transactions where reason='cash_purchase_reversal' and user_id='fa000000-0000-0000-0000-000000000001'),1,'one immutable ledger compensation');
select is((select sum(case when direction='credit' then amount else -amount end) from public.economy_transactions where asset='cash' and user_id='fa000000-0000-0000-0000-000000000001'),0::numeric,'wallet equals existing ledger');
select is(private.refund_deadline('2026-10-29T23:30:00-03:00',7),'2026-11-05T23:59:59.999999-03:00'::timestamptz,'civil calendar end-of-day, not 168 hours');
select is(private.refund_deadline('2018-11-03T22:30:00-03:00',7),'2018-11-10T23:59:59.999999-02:00'::timestamptz,'historical Brazil DST handled by database timezone');
select ok(not exists(select 1 from public.notifications where entity_type='refund_request' and metadata<>'{}'::jsonb),'notifications have no financial or complaint payload');
select ok(not exists(select 1 from public.notifications n join public.refund_request_events e on n.dedupe_key='refund-event:'||e.id
  where n.recipient_id=e.actor_id),'requester is never notified about an event they authored');
select ok(exists(select 1 from public.notifications n join public.refund_request_events e on n.dedupe_key='refund-event:'||e.id
  join public.refund_requests r on r.id=e.request_id where n.recipient_id=r.requester_id and e.actor_id<>r.requester_id),
  'requester is still notified about administrative actions');
select pg_temp.set_test_user('fa000000-0000-0000-0000-000000000001',true);
select pg_temp.revoke_test_session('fa000000-0000-0000-0000-000000000001');
select throws_ok($$select public.list_refund_requests()$$,'42501','APP_ACCESS_DENIED','revoked session cannot access cases');
select * from finish();
rollback;
