\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
-- 20261212000002: registro de documentos comerciais, snapshot na cotação e aceite
-- comprovável por operação (pedido comercial e cotação de EvoCash).
begin;
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
select no_plan();

insert into public.commercial_offerings(code,name,description,integration_ready) values('synthetic_terms_fixture','Synthetic terms fixture','Rollback-only offering',true);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('7c000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','terms-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,3)i;
update public.users set role='superadmin' where id='7c000000-0000-0000-0000-000000000003';
update public.users set data_nascimento=(now()-interval '30 years')::date where id::text like '7c000000-%';
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
  from public.legal_policy p where p.id and u.id::text like '7c000000-%';
create function pg_temp.terms_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('7c000000-0000-0000-0000-000000000003',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
select pg_temp.terms_admin();
set local role authenticated;
select public.admin_publish_commercial_price('synthetic_terms_fixture','3',1,30,null,0,gen_random_uuid(),'Synthetic price only',true);
select public.admin_set_commercial_sales('synthetic_terms_fixture',true,1,gen_random_uuid(),'Synthetic enable',true);
reset role;
insert into private.commercial_resources(id,offering_code,owner_user_id,content_revision,approved_revision,moderation_state)
values('7c200000-0000-0000-0000-000000000001','synthetic_terms_fixture','7c000000-0000-0000-0000-000000000001',1,1,'approved');
select public._wallet_credit_cash('7c000000-0000-0000-0000-000000000001',100);
select public._ledger_record('7c000000-0000-0000-0000-000000000001','synthetic-terms-seed','cash','credit',100,'synthetic','fixture','terms');
create temp table r(name text primary key,value jsonb); grant all on r to authenticated;

-- 1) Registro: minuta não publica; digest calculado no servidor; imutabilidade --------
select throws_ok($$select private.publish_legal_document('{"documentId":"evocash-terms","version":"1.0.0","title":"Minuta","approved":false}'::jsonb)$$,
  'LEGAL_DRAFT_NOT_PUBLISHABLE','minuta comercial não é publicada');
select ok(not has_function_privilege('authenticated','public.admin_publish_legal_document(jsonb)','execute'),'usuário não publica documento comercial');
select ok(not has_function_privilege('anon','public.admin_publish_legal_document(jsonb)','execute'),'anônimo não publica documento comercial');
insert into r values('v1',private.publish_legal_document('{"documentId":"advertising-terms","version":"1.0.0","title":"Termos A","approved":true,"sections":[]}'::jsonb));
select is((select value->>'digest' from r where name='v1'),encode(sha256(convert_to('{"title": "Termos A", "version": "1.0.0", "approved": true, "sections": [], "documentId": "advertising-terms"}','UTF8')),'hex'),'digest é o sha256 do jsonb canônico calculado no servidor');
select is(private.publish_legal_document('{"documentId":"advertising-terms","version":"1.0.0","title":"Termos A","approved":true,"sections":[]}'::jsonb)->>'repeated','true','publicação idêntica é idempotente');
select throws_ok($$select private.publish_legal_document('{"documentId":"advertising-terms","version":"1.0.0","title":"Termos A alterado","approved":true,"sections":[]}'::jsonb)$$,
  'LEGAL_VERSION_IMMUTABLE','mesma versão com texto divergente falha');
select throws_ok($$update public.legal_document_versions set title='X' where document_id='advertising-terms'$$,'LEGAL_VERSION_IMMUTABLE','versão registrada é imutável');
select throws_ok($$delete from public.legal_document_versions where document_id='advertising-terms'$$,'LEGAL_HISTORY_IMMUTABLE','histórico não é apagado');
insert into private.commercial_offering_documents values('synthetic_terms_fixture','advertising-terms');

-- 2) Snapshot na cotação e aceite explícito ---------------------------------------------
select pg_temp.set_test_user('7c000000-0000-0000-0000-000000000001',true);
set local role authenticated;
select throws_ok($$insert into public.legal_document_versions(document_id,version,title,content,digest) values('advertising-terms','9.0.0','X','{}',repeat('a',64))$$,'42501',null,'cliente não insere documento');
insert into r values('q1',public.quote_commercial_order('7c200000-0000-0000-0000-000000000001','2',gen_random_uuid()));
select is((select value->'terms'->>'version' from r where name='q1'),'1.0.0','cotação congela a versão vigente');
select is((select value->'terms'->'conditions'->>'totalCash' from r where name='q1'),'6','snapshot guarda o total exibido');
select is((select (value->'terms'->>'current')::boolean from r where name='q1'),true,'cotação informa que os termos ainda vigoram');
select throws_ok($$select public.confirm_commercial_order((select (value->>'id')::uuid from r where name='q1'),true)$$,
  'COMMERCIAL_TERMS_ACCEPTANCE_REQUIRED','p_confirm=true sozinho não contrata');
select is((select cash_balance::text from public.wallets where user_id='7c000000-0000-0000-0000-000000000001'),'100','nada foi debitado sem aceite');
select throws_ok($$select public.accept_commercial_terms('order',(select (value->>'id')::uuid from r where name='q1'),'1.0.0',repeat('0',64),(select value->'terms'->>'conditionsDigest' from r where name='q1'))$$,
  'COMMERCIAL_TERMS_MISMATCH','digest adulterado é recusado');
select throws_ok($$select public.accept_commercial_terms('order',(select (value->>'id')::uuid from r where name='q1'),'1.0.0',(select value->'terms'->>'digest' from r where name='q1'),repeat('0',64))$$,
  'COMMERCIAL_CONDITIONS_MISMATCH','condições diferentes das exibidas são recusadas');
reset role;

-- 3) Termos mudam entre cotação e confirmação: nada é cobrado ----------------------------
select private.publish_legal_document('{"documentId":"advertising-terms","version":"1.1.0","title":"Termos B","approved":true,"sections":[]}'::jsonb);
set local role authenticated;
select throws_ok($$select public.confirm_commercial_order_with_terms((select (value->>'id')::uuid from r where name='q1'),'1.0.0',
  (select value->'terms'->>'digest' from r where name='q1'),(select value->'terms'->>'conditionsDigest' from r where name='q1'))$$,
  'COMMERCIAL_TERMS_CHANGED','mudança material de termos exige nova cotação');
select is((select cash_balance::text from public.wallets where user_id='7c000000-0000-0000-0000-000000000001'),'100','sem débito após mudança de termos');
select is((select count(*)::int from public.commercial_terms_acceptances),0,'nenhuma evidência gravada na tentativa recusada');

-- 4) Nova cotação, aceite e confirmação atômicos; repetição idempotente ---------------
insert into r values('q2',public.quote_commercial_order('7c200000-0000-0000-0000-000000000001','2',gen_random_uuid()));
insert into r values('paid',public.confirm_commercial_order_with_terms((select (value->>'id')::uuid from r where name='q2'),
  (select value->'terms'->>'version' from r where name='q2'),(select value->'terms'->>'digest' from r where name='q2'),
  (select value->'terms'->>'conditionsDigest' from r where name='q2')));
select is((select value->>'status' from r where name='paid'),'fulfilled','contratação concluída com aceite');
select is(public.confirm_commercial_order_with_terms((select (value->>'id')::uuid from r where name='q2'),
  (select value->'terms'->>'version' from r where name='q2'),(select value->'terms'->>'digest' from r where name='q2'),
  (select value->'terms'->>'conditionsDigest' from r where name='q2'))->>'fulfilledAt',(select value->>'fulfilledAt' from r where name='paid'),'repetição não gera nova cobrança');
select is((select cash_balance::text from public.wallets where user_id='7c000000-0000-0000-0000-000000000001'),'94','um único débito');
select is((select count(*)::int from public.commercial_terms_acceptances where order_id=(select (value->>'id')::uuid from r where name='q2')),1,'uma única evidência de aceite');
select is((select document_version from public.commercial_terms_acceptances where order_id=(select (value->>'id')::uuid from r where name='q2')),'1.1.0','pedido vinculado à versão exata aceita');
reset role;

-- 5) Recibo estável após nova publicação ----------------------------------------------
select private.publish_legal_document('{"documentId":"advertising-terms","version":"1.2.0","title":"Termos C","approved":true,"sections":[]}'::jsonb);
set local role authenticated;
select is(public.get_my_commercial_terms('order',(select (value->>'id')::uuid from r where name='q2'))->>'version','1.1.0','recibo antigo mantém a versão contratada');
select is(public.get_my_commercial_terms('order',(select (value->>'id')::uuid from r where name='q2'))->>'title','Termos B','texto histórico continua identificável');
select is((public.get_my_commercial_terms('order',(select (value->>'id')::uuid from r where name='q2'))->>'current')::boolean,false,'recibo indica que há versão mais nova');
select isnt(public.get_my_commercial_terms('order',(select (value->>'id')::uuid from r where name='q2'))->>'acceptedAt',null,'recibo traz o momento do aceite');
select is((select count(*)::int from public.legal_document_versions where document_id='advertising-terms'),3,'versões publicadas antigas continuam legíveis');
reset role;
select throws_ok($$update public.commercial_terms_acceptances set document_version='1.2.0'$$,'COMMERCIAL_HISTORY_IMMUTABLE','aceite não é reassociado a texto novo');

-- 6) Isolamento entre usuários --------------------------------------------------------
select pg_temp.set_test_user('7c000000-0000-0000-0000-000000000002',true);
set local role authenticated;
select is((select count(*)::int from public.commercial_terms_acceptances),0,'usuário não vê aceites de terceiros');
select is(public.get_my_commercial_terms('order',(select (value->>'id')::uuid from r where name='q2')),null,'nem o recibo de terceiros');
select throws_ok($$select public.accept_commercial_terms('order',(select (value->>'id')::uuid from r where name='q1'),'1.0.0',repeat('0',64),repeat('0',64))$$,
  'ORDER_NOT_FOUND','não aceita pelo pedido de outra pessoa');
reset role;

-- 7) EvoCash: checkout exige aceite das Condições do EvoCash -------------------------
insert into public.evocash_price_versions(revision,unit_price_centavos,minimum_unit_price_centavos,min_quantity,max_quantity,daily_quantity_limit,total_quantity_limit,quote_ttl_seconds,large_change_threshold_bps,active_from,created_by,reason)
values(9101,10,1,1,100,100,200,300,2000,clock_timestamp(),'7c000000-0000-0000-0000-000000000003','Synthetic terms tests');
update public.evocash_pricing_state set quoting_enabled=true,checkout_enabled=true where id;
select pg_temp.set_test_user('7c000000-0000-0000-0000-000000000002',true);
insert into r values('cq',public.create_evocash_purchase_quote('5',gen_random_uuid()));
set local role authenticated;
select is((select value->'terms'->>'version' from r where name='cq'),null,'sem Condições do EvoCash publicadas a cotação registra a ausência');
select throws_ok($$select public.accept_commercial_terms('evocash_quote',(select (value->>'quoteId')::uuid from r where name='cq'),null,null,null)$$,
  'COMMERCIAL_TERMS_UNAVAILABLE','sem documento publicado não há aceite');
select throws_ok($$select public.reserve_infinitepay_cash_purchase((select (value->>'quoteId')::uuid from r where name='cq'),gen_random_uuid())$$,
  'COMMERCIAL_TERMS_ACCEPTANCE_REQUIRED','checkout falha fechado sem termos aceitos');
reset role;
select private.publish_legal_document('{"documentId":"evocash-terms","version":"1.0.0","title":"Condições EvoCash","approved":true,"sections":[]}'::jsonb);
select pg_temp.set_test_user('7c000000-0000-0000-0000-000000000002',true);
insert into r values('cq2',public.create_evocash_purchase_quote('5',gen_random_uuid()));
set local role authenticated;
select is((select value->'terms'->'conditions'->>'totalCentavos' from r where name='cq2'),'50','snapshot do EvoCash guarda valor em reais (centavos)');
select lives_ok($$select public.accept_commercial_terms('evocash_quote',(select (value->>'quoteId')::uuid from r where name='cq2'),
  (select value->'terms'->>'version' from r where name='cq2'),(select value->'terms'->>'digest' from r where name='cq2'),(select value->'terms'->>'conditionsDigest' from r where name='cq2'))$$,
  'aceite das Condições do EvoCash');
reset role;
update public.economy_config set config = jsonb_set(config,'{supplierInfo,configured}','false'::jsonb) where id;
set local role authenticated;
select throws_ok($$select public.reserve_infinitepay_cash_purchase((select (value->>'quoteId')::uuid from r where name='cq2'),gen_random_uuid())$$,
  'SUPPLIER_INFO_NOT_CONFIGURED','fornecedor incompleto bloqueia reserva antes de criar cobrança');
reset role;
update public.economy_config set config = jsonb_set(config,'{supplierInfo,configured}','true'::jsonb) where id;
set local role authenticated;
select lives_ok($$select public.reserve_infinitepay_cash_purchase((select (value->>'quoteId')::uuid from r where name='cq2'),gen_random_uuid())$$,
  'checkout reservado depois do aceite');
select is(public.get_my_commercial_terms('purchase',(select id from public.cash_purchases where quote_id=(select (value->>'quoteId')::uuid from r where name='cq2')))->>'version','1.0.0',
  'compra de EvoCash aponta para as condições aceitas');
reset role;

-- 8) Cobertura: toda oferta real tem documento; refund só ativa versão aprovada --------
select is((select count(*)::int from public.commercial_offerings f where f.code not like 'synthetic%'
  and not exists(select 1 from private.commercial_offering_documents d where d.offering_code=f.code)),0,'nenhuma oferta real sem documento aplicável');
select throws_ok($$select public.admin_activate_refund_policy('draft-1')$$,'REFUND_POLICY_NOT_APPROVED','minuta de reembolso não é ativada');
select is((select policy_version from private.refund_settings where id),'draft-1','minuta continua apenas como texto não contratual');
select ok(not has_function_privilege('authenticated','public.admin_activate_refund_policy(text)','execute'),'usuário não ativa política de reembolso');
select ok(has_table_privilege('anon','public.legal_document_policy','select') and has_table_privilege('anon','public.legal_document_versions','select'),'documentos publicados são legíveis sem login');
select ok(not has_table_privilege('anon','public.legal_document_versions','insert') and not has_table_privilege('authenticated','public.legal_document_versions','update'),'ninguém além do service role escreve documentos');
select ok(not has_table_privilege('anon','public.commercial_terms_acceptances','select'),'aceites não são públicos');
select ok(not has_function_privilege('service_role','public.confirm_commercial_order_with_terms(uuid,text,text,text)','execute'),'service role não contrata em nome de usuário');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef and n.nspname in ('public','private')
    and p.proname in ('publish_legal_document','admin_publish_legal_document','capture_commercial_quote_terms','commercial_terms_json',
      'accept_commercial_terms','confirm_commercial_order_with_terms','get_my_commercial_terms','require_commercial_terms_acceptance','admin_activate_refund_policy')
    and not coalesce(p.proconfig @> array['search_path=""'],false)),0,'toda função SECURITY DEFINER nova fixa search_path vazio');

select * from finish();
rollback;
