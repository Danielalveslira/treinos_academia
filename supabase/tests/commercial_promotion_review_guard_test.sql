-- PR0: admin_review_commercial_promotion must require the caller's expected revision
-- and re-validate that the resource is still 'submitted' inside the same locked
-- transaction, so a stale, repeated or reversing decision is rejected without
-- mutating state, snapshot, status or auditing anything (20261217000001).
\ir _helpers/auth_session.sql
\ir _helpers/commercial_terms.sql
begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- Fixture only: the production supplier gate defaults to closed; commercial_orders
-- (used by the "already entitled" scenario) require it open, same as
-- advertising_campaigns_test.sql.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
select ('7c000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'authenticated','authenticated','promo-review-pr0-'||i||'@example.invalid','x',now(),'{}','{}',now(),now() from generate_series(1,3)i;
update public.users set role='superadmin' where id='7c000000-0000-0000-0000-000000000002';
update public.users u set legal_acceptance_version=p.version,legal_acceptance_digest=p.digest,legal_acceptance_accepted_at=now()
from public.legal_policy p where p.id and p.published and u.id::text like '7c000000-%';

create function pg_temp.pr0_owner() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('7c000000-0000-0000-0000-000000000001',true);
end$$;
create function pg_temp.pr0_admin() returns void language plpgsql as $$begin
 perform pg_temp.set_test_user('7c000000-0000-0000-0000-000000000002',true);
 perform set_config('request.jwt.claims',(current_setting('request.jwt.claims')::jsonb||jsonb_build_object('amr',jsonb_build_array(jsonb_build_object('method','password','timestamp',extract(epoch from clock_timestamp())::bigint))))::text,true);
end$$;
create function pg_temp.pr0_community(p_id uuid,p_name text) returns void language plpgsql as $$begin
 insert into public.communities(id,name,created_by,owner_id) values(p_id,p_name,'7c000000-0000-0000-0000-000000000001','7c000000-0000-0000-0000-000000000001');
 insert into public.community_members(community_id,user_id) values(p_id,'7c000000-0000-0000-0000-000000000001');
end$$;
create temp table pr0_results(name text primary key,value jsonb); grant all on pr0_results to authenticated;

select pg_temp.pr0_community('7c200000-0000-0000-0000-000000000001','PR0 aprovação');
select pg_temp.pr0_community('7c200000-0000-0000-0000-000000000002','PR0 reprovação/resubmissão');
select pg_temp.pr0_community('7c200000-0000-0000-0000-000000000003','PR0 estado suspenso');
select pg_temp.pr0_community('7c200000-0000-0000-0000-000000000004','PR0 direito contratado');

select pg_temp.pr0_owner();
set local role authenticated;
select public.configure_community_advertising('7c200000-0000-0000-0000-000000000001',false,true,0);
select public.configure_community_advertising('7c200000-0000-0000-0000-000000000002',false,true,0);
select public.configure_community_advertising('7c200000-0000-0000-0000-000000000003',false,true,0);
select public.configure_community_advertising('7c200000-0000-0000-0000-000000000004',false,true,0);
insert into pr0_results values('p1',public.prepare_commercial_promotion('community','7c200000-0000-0000-0000-000000000001'));
insert into pr0_results values('p2',public.prepare_commercial_promotion('community','7c200000-0000-0000-0000-000000000002'));
insert into pr0_results values('p3',public.prepare_commercial_promotion('community','7c200000-0000-0000-0000-000000000003'));
insert into pr0_results values('p4',public.prepare_commercial_promotion('community','7c200000-0000-0000-0000-000000000004'));
select is((select value->>'state' from pr0_results where name='p1'),'submitted','P1 criada pendente de análise');
reset role;

-- 1) Primeira aprovação válida.
select pg_temp.pr0_admin();
set local role authenticated;
select lives_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p1'),1,true,'Primeira análise sintética, aprovada')$$,'primeira aprovação válida é aceita');
reset role;
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p1')),'approved','P1 passa a approved');
select is((select count(*)::int from public.advertising_operations where resource_id=(select(value->>'resourceId')::uuid from pr0_results where name='p1') and action='approve_promotion'),1,'exatamente um registro de auditoria para a aprovação');

-- 3) Repetição da mesma decisão e 5) duas decisões administrativas simultâneas:
-- a mesma revisão (1) que já foi consumida pela aprovação acima representa o que uma
-- segunda sessão administrativa concorrente, que carregou a fila antes do commit
-- anterior, ainda teria em mãos -- ela deve perder a corrida, não duplicar a decisão.
select pg_temp.pr0_admin();
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p1'),1,true,'Repetição da mesma aprovação')$$,'PROMOTION_REVISION_CONFLICT','repetir a mesma aprovação com revisão já consumida é rejeitado');
-- 4) Tentativa de reverter uma aprovação já efetivada.
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p1'),1,false,'Tentativa de reverter a aprovação anterior')$$,'PROMOTION_REVISION_CONFLICT','reprovar por cima de uma aprovação já efetivada é rejeitado');
reset role;
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p1')),'approved','P1 continua approved -- nenhuma reversão silenciosa');
select is((select count(*)::int from public.advertising_operations where resource_id=(select(value->>'resourceId')::uuid from pr0_results where name='p1') and action in('approve_promotion','reject_promotion')),1,'nenhuma auditoria extra de decisão para as tentativas rejeitadas');

-- 9) Tentativa por usuário sem permissão administrativa.
select pg_temp.set_test_user('7c000000-0000-0000-0000-000000000003',true);
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p1'),1,true,'Usuário sem permissão administrativa')$$,'42501',null,'usuário sem permissão de superadmin não decide');
reset role;

-- 10) Tentativa de usar a assinatura antiga (3 argumentos): ela foi removida nesta
-- migration -- a chamada precisa falhar por função inexistente, nunca silenciosamente
-- aceitar a decisão sem checagem de concorrência.
select pg_temp.pr0_admin();
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p1'),true,'Assinatura antiga sem revisão esperada')$$,'42883',null,'assinatura antiga de 3 argumentos não existe mais');
reset role;

-- 2) Primeira reprovação válida; 6)/7) revisão desatualizada após reenvio (edição do
-- conteúdo depois que a revisão foi carregada pelo admin).
select pg_temp.pr0_admin();
set local role authenticated;
select lives_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p2'),1,false,'Primeira análise sintética, reprovada')$$,'primeira reprovação válida é aceita');
reset role;
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p2')),'rejected','P2 passa a rejected');
select pg_temp.pr0_owner();
set local role authenticated;
select public.resubmit_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p2'));
reset role;
select is((select content_revision from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p2')),2::bigint,'reenvio do proprietário avança a revisão para 2');
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p2')),'submitted','reenvio volta ao estado pendente de análise');
select pg_temp.pr0_admin();
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p2'),1,true,'Decisão com revisão desatualizada')$$,'PROMOTION_REVISION_CONFLICT','revisão 1 (carregada antes do reenvio) está obsoleta depois da edição');
select lives_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p2'),2,true,'Nova análise com a revisão correta, aprovada')$$,'decisão com a revisão atual (2) é aceita');
reset role;
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p2')),'approved','P2 reenviada é aprovada corretamente na revisão 2');

-- 8) Solicitação em estado diferente de 'submitted' (ex.: suspensa administrativamente)
-- nunca pode ser decidida como se estivesse pendente.
update private.commercial_resources set moderation_state='suspended' where id=(select(value->>'resourceId')::uuid from pr0_results where name='p3');
select pg_temp.pr0_admin();
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p3'),1,true,'Decisão sobre recurso suspenso')$$,'PROMOTION_REVISION_CONFLICT','recurso fora de submitted (suspenso) não pode ser decidido');
reset role;
select is((select moderation_state from private.commercial_resources where id=(select(value->>'resourceId')::uuid from pr0_results where name='p3')),'suspended','estado suspenso preservado, não sobrescrito pela tentativa rejeitada');

-- 11)/12) Impulsionamento que já possui direito de exibição contratado: a aprovação
-- não pode ser revertida depois da contratação, e a revisão em si nunca debita saldo
-- nem duplica cobrança -- só a contratação explícita do proprietário debita.
select pg_temp.pr0_admin();
set local role authenticated;
select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p4'),1,true,'Aprovação sintética para contratação');
reset role;
insert into public.commercial_price_versions(offering_code,revision,unit_price_cash,min_days,max_days,active_from,created_by,reason)
select 'community_boost',coalesce(max(revision),0)+1,5,1,7,clock_timestamp(),'7c000000-0000-0000-0000-000000000002','Tarifa sintética para o teste do PR0' from public.commercial_price_versions where offering_code='community_boost';
update public.commercial_offerings set sales_enabled=true where code='community_boost';
select public._wallet_credit_cash('7c000000-0000-0000-0000-000000000001',50);
select pg_temp.pr0_admin();
set local role authenticated;
-- community_discovery_boost nasce com capacidade zero (Phase 6 anchor, ver
-- 20261205000005): precisa ser aberto administrativamente antes de contratar,
-- igual ao que advertising_campaigns_test.sql faz para home_banner.
select public.admin_configure_advertising_placement('community_discovery_boost',1,true,true,0,'Capacidade sintética para o teste do PR0',true);
reset role;
select pg_temp.pr0_owner();
set local role authenticated;
select pg_temp.publish_test_commercial_terms();
insert into pr0_results values('p4_quote',public.quote_commercial_order((select(value->>'resourceId')::uuid from pr0_results where name='p4'),'2',gen_random_uuid()));
select is((select value->>'totalCash' from pr0_results where name='p4_quote'),'10','cotação calcula 5 EvoCash/dia x 2 dias');
insert into pr0_results values('p4_paid',pg_temp.confirm_with_terms((select(value->>'id')::uuid from pr0_results where name='p4_quote'),true));
reset role;
select is((select cash_balance from public.wallets where user_id='7c000000-0000-0000-0000-000000000001'),40,'contratação debita exatamente o total cotado, uma única vez');
select ok((select count(*)::int from public.visibility_entitlements where resource_id=(select(value->>'resourceId')::uuid from pr0_results where name='p4'))=1,'direito de exibição concedido pela contratação');
select pg_temp.pr0_admin();
set local role authenticated;
select throws_ok($$select public.admin_review_commercial_promotion((select(value->>'resourceId')::uuid from pr0_results where name='p4'),1,false,'Tentativa de reverter aprovação já contratada')$$,'PROMOTION_REVISION_CONFLICT','revisão sobre impulsionamento já contratado e com direito ativo é rejeitada');
reset role;
select is((select cash_balance from public.wallets where user_id='7c000000-0000-0000-0000-000000000001'),40,'a tentativa de revisão rejeitada nunca movimenta saldo');
select ok((select administrative_state from public.visibility_entitlements where resource_id=(select(value->>'resourceId')::uuid from pr0_results where name='p4'))='enabled','direito de exibição permanece íntegro após a tentativa rejeitada');

select * from finish();
rollback;
