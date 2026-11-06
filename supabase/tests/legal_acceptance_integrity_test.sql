\ir _helpers/auth_session.sql
\ir _helpers/cash_purchase.sql
-- 20261212000001: fronteira de confiança do aceite jurídico, histórico imutável,
-- publicação controlada, consentimento específico de saúde e trava de compras de menores.
begin;
-- Fixture only: the production supplier gate defaults to closed.
update public.economy_config set config = config || jsonb_build_object('supplierInfo', jsonb_build_object('configured', true)) where id;
select no_plan();

-- Fixtures: duas versões registradas (uma publicada, uma minuta), usuários adulto,
-- adolescente (14, acima do minimumAge=12 do manifesto mas abaixo do piso de 16) e um
-- terceiro, todos com e-mail confirmado.
insert into public.legal_versions(version,manifest,documents,digest) values
 ('71.0.0','{"version":"71.0.0","published":true,"minimumAge":12,"date":"2026-11-02","changes":[]}','[{"id":"terms","title":"Termos A"}]',repeat('a',64)),
 ('71.1.0','{"version":"71.1.0","published":false,"minimumAge":12,"date":"2026-11-02","changes":[]}','[{"id":"terms","title":"Minuta"}]',repeat('b',64));
insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values
 ('71000000-0000-0000-0000-000000000001','authenticated','authenticated','legal-adult@example.invalid',now(),'{}','{}',now(),now()),
 ('71000000-0000-0000-0000-000000000002','authenticated','authenticated','legal-teen@example.invalid',now(),'{}','{}',now(),now()),
 ('71000000-0000-0000-0000-000000000003','authenticated','authenticated','legal-other@example.invalid',now(),'{}','{}',now(),now());
update public.users set data_nascimento=(now()-interval '30 years')::date where id='71000000-0000-0000-0000-000000000001';
update public.users set data_nascimento=(now()-interval '14 years')::date where id='71000000-0000-0000-0000-000000000002';
update public.users set data_nascimento=(now()-interval '40 years')::date where id='71000000-0000-0000-0000-000000000003';

-- 1) Histórico imutável e publicação controlada -------------------------------------
select throws_ok($$insert into public.legal_versions(version,manifest,documents,digest) values('71.2.0','{"version":"71.2.0","published":true}','[]','not-a-digest')$$,
  'LEGAL_VERSION_INVALID','digest arbitrário é recusado no registro');
select throws_ok($$update public.legal_versions set documents='[{"id":"terms","title":"Adulterado"}]' where version='71.0.0'$$,
  'LEGAL_VERSION_IMMUTABLE','texto de versão registrada não pode ser reescrito');
select throws_ok($$update public.legal_versions set digest=repeat('c',64) where version='71.0.0'$$,
  'LEGAL_VERSION_IMMUTABLE','digest de versão registrada não pode ser trocado');
select lives_ok($$insert into public.legal_versions(version,manifest,documents,digest)
  values('71.0.0','{"version":"71.0.0","published":true,"minimumAge":12,"date":"2026-11-02","changes":[]}','[{"id":"terms","title":"Termos A"}]',repeat('a',64))
  on conflict (version) do update set manifest=excluded.manifest,documents=excluded.documents,digest=excluded.digest$$,
  'republicação idêntica é idempotente');
select throws_ok($$insert into public.legal_versions(version,manifest,documents,digest)
  values('71.0.0','{"version":"71.0.0","published":true,"minimumAge":12}','[{"id":"terms","title":"Outro"}]',repeat('a',64))
  on conflict (version) do update set manifest=excluded.manifest,documents=excluded.documents$$,
  'LEGAL_VERSION_IMMUTABLE','republicação com texto divergente falha');
select throws_ok($$delete from public.legal_versions where version='71.0.0'$$,'LEGAL_HISTORY_IMMUTABLE','histórico não é apagado');

select throws_ok($$select private.publish_legal_policy('71.1.0',repeat('b',64))$$,'LEGAL_DRAFT_NOT_PUBLISHABLE','minuta não pode ser ativada');
select throws_ok($$select private.publish_legal_policy('71.0.0',repeat('c',64))$$,'LEGAL_VERSION_NOT_REGISTERED','digest divergente não publica');
select is(private.publish_legal_policy('71.0.0',repeat('a',64))->>'repeated','false','versão registrada é publicada');
select is(private.publish_legal_policy('71.0.0',repeat('a',64))->>'repeated','true','republicação é idempotente');
select is((select minimum_age::int from public.legal_policy where id),12,'idade mínima vem do manifesto registrado');
select isnt((select published_at from public.legal_versions where version='71.0.0'),null,'versão ativada fica marcada como publicada');
select ok(not has_function_privilege('authenticated','public.admin_publish_legal_policy(text,text)','execute'),'usuário não publica política');
select ok(not has_function_privilege('anon','public.admin_publish_legal_policy(text,text)','execute'),'anônimo não publica política');
select ok(has_function_privilege('service_role','public.admin_publish_legal_policy(text,text)','execute'),'fluxo administrativo (service role) publica');

set local role anon;
select is((select count(*)::int from public.legal_versions where version in ('71.0.0','71.1.0')),1,'minuta não vaza ao público; versão publicada continua legível');
reset role;

-- 2) Aceite: fronteira de confiança ----------------------------------------------------
set local role authenticated;
select pg_temp.set_test_user('',true);
select throws_ok($$select public.accept_legal_documents('{"version":"71.0.0","accepted":true}'::jsonb)$$,'NOT_AUTHENTICATED','sem sessão não aceita');
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000001',true);
select throws_ok($$insert into public.legal_versions(version,manifest,documents,digest) values('71.9.0','{"version":"71.9.0","published":true}','[]',repeat('d',64))$$,
  '42501',null,'cliente autenticado não insere documento jurídico');
select throws_ok($$update public.legal_policy set version='71.1.0' where id$$,'42501',null,'cliente autenticado não altera política');
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',false))$$,repeat('a',64)),
  'CONFIRMATION_REQUIRED','aceite exige escolha explícita');
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted','true'))$$,repeat('a',64)),
  'CONFIRMATION_REQUIRED','string "true" não substitui booleano explícito');
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true))$$,repeat('c',64)),
  'POLICY_MISMATCH','digest incorreto é recusado');
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.1.0','digest',%L,'accepted',true))$$,repeat('b',64)),
  'POLICY_MISMATCH','versão não vigente (minuta) é recusada');
select lives_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true,'source','signup',
   'healthDataConsent',true,'manifest','{"version":"71.0.0","evil":true}'::jsonb,'documents','[{"id":"terms","title":"Injetado"}]'::jsonb))$$,repeat('a',64)),
  'aceite válido sem consentimento de saúde cria/regulariza a conta');
select lives_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true))$$,repeat('a',64)),
  'repetição do aceite é idempotente');
reset role;
select is((select documents->0->>'title' from public.legal_versions where version='71.0.0'),'Termos A','conteúdo enviado pelo cliente nunca altera o arquivo jurídico');
select is((select count(*)::int from public.legal_acceptances where user_id='71000000-0000-0000-0000-000000000001'),1,'uma única evidência de aceite');
select is((select health_data_consent from public.legal_acceptances where user_id='71000000-0000-0000-0000-000000000001'),false,'healthDataConsent forçado de cliente antigo não vira consentimento');
select is((select count(*)::int from public.privacy_consent_events where user_id='71000000-0000-0000-0000-000000000001'),0,'nenhum consentimento presumido');
select is((select source from public.legal_acceptances where user_id='71000000-0000-0000-0000-000000000001'),'signup','origem do aceite registrada');
select is((select legal_acceptance_version from public.users where id='71000000-0000-0000-0000-000000000001'),'71.0.0','usuário passa a ter aceite vigente');

-- Consentimento opcional no mesmo aceite (texto exato) e recusa de texto desatualizado.
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000003',true);
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true,'healthConsentTextVersion','health-data-0'))$$,repeat('a',64)),
  'CONSENT_TEXT_OUTDATED','consentimento com texto não vigente é recusado e o aceite inteiro é desfeito');
select lives_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true,'healthConsentTextVersion','health-data-1','source','signup'))$$,repeat('a',64)),
  'aceite com consentimento específico opcional');
select is((public.get_my_privacy_consents()->'healthData'->>'granted')::boolean,true,'consentimento concedido é visível ao titular');
reset role;

-- 3) Idade mínima e trava de compras de menores --------------------------------------
update public.users set data_nascimento=(now()-interval '11 years')::date where id='71000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000002',true);
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true))$$,repeat('a',64)),
  'MINIMUM_AGE','idade mínima calculada no servidor');
reset role;
update public.users set data_nascimento=(now()-interval '14 years')::date where id='71000000-0000-0000-0000-000000000002';
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000002',true);
select throws_ok(format($$select public.accept_legal_documents(jsonb_build_object('version','71.0.0','digest',%L,'accepted',true))$$,repeat('a',64)),
  'MINIMUM_AGE','piso de 16 anos vence o manifesto histórico de 12: 14 anos não aceita');
reset role;
select ok(private.is_known_minor('71000000-0000-0000-0000-000000000002'),'14 anos é menor');
select ok(not private.is_known_minor('71000000-0000-0000-0000-000000000001'),'30 anos não é menor');
select throws_ok($$select pg_temp.cash_purchase_fixture('71000000-0000-0000-0000-000000000002')$$,'MINOR_PURCHASE_BLOCKED','menor não inicia compra de EvoCash, nem por API direta');
select lives_ok($$select pg_temp.cash_purchase_fixture('71000000-0000-0000-0000-000000000001')$$,'adulto segue o fluxo existente');
select has_trigger('public','evocash_purchase_quotes','evocash_quotes_block_minor','cotações de EvoCash protegidas');
select has_trigger('public','commercial_orders','commercial_orders_block_minor','contratações protegidas');
select has_trigger('public','promotions','promotions_block_minor','impulsionamentos legados protegidos');

-- 4) Consentimento: concessão, revogação, idempotência e efeito funcional ------------
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.save_body_check_in(jsonb_build_object('date',(now() at time zone 'America/Sao_Paulo')::date,'weightKg',80))$$,
  'HEALTH_CONSENT_REQUIRED','nova medida corporal exige consentimento específico');
select throws_ok($$select public.save_body_check_in('{"heightCm":180}'::jsonb)$$,
  'HEALTH_CONSENT_REQUIRED','altura isolada também exige consentimento de saúde');
select throws_ok($$select public.set_privacy_consent('health_data',true,'health-data-0','settings')$$,'CONSENT_TEXT_OUTDATED','concessão exige texto vigente');
select throws_ok($$select public.set_privacy_consent('health_data',true,'health-data-1','signup')$$,'INVALID_CONSENT_SOURCE','origem controlada pelo servidor');
select is((public.set_privacy_consent('health_data',true,'health-data-1','feature_prompt')->>'changed')::boolean,true,'concessão registrada');
select is((public.set_privacy_consent('health_data',true,'health-data-1','settings')->>'changed')::boolean,false,'concessão repetida não duplica evidência');
select lives_ok($$select public.save_body_check_in('{"heightCm":180}'::jsonb)$$,'altura autorizada é salva');
select lives_ok($$select public.save_body_check_in(jsonb_build_object('date',(now() at time zone 'America/Sao_Paulo')::date,'weightKg',80))$$,'com consentimento a medida é salva');
select throws_ok($$update public.privacy_consent_events set granted=false$$,'42501',null,'titular não reescreve histórico');
reset role;
select throws_ok($$update public.privacy_consent_events set granted=false where user_id='71000000-0000-0000-0000-000000000001'$$,'PRIVACY_HISTORY_IMMUTABLE','histórico de consentimento é imutável');

-- Revogação funciona mesmo com termos desatualizados e é respeitada.
update public.users set legal_acceptance_version='0.0.1' where id='71000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000001',true);
select is((public.set_privacy_consent('health_data',false,null,'settings')->>'granted')::boolean,false,'revogação aceita mesmo com termos desatualizados');
select throws_ok($$select public.save_body_check_in(jsonb_build_object('date',(now() at time zone 'America/Sao_Paulo')::date,'weightKg',81))$$,
  'HEALTH_CONSENT_REQUIRED','revogação bloqueia novas medidas');
select is((select count(*)::int from public.body_measurements where user_id='71000000-0000-0000-0000-000000000001'),0,'revogação elimina as medidas já registradas (20261212000005)');
select is((select height_cm from public.users where id='71000000-0000-0000-0000-000000000001'),null::smallint,'revogação elimina também a altura do perfil');
select throws_ok($$select public.save_body_check_in('{"heightCm":181}'::jsonb)$$,
  'HEALTH_CONSENT_REQUIRED','revogação bloqueia nova altura');
select is((select count(*)::int from public.privacy_consent_events where user_id='71000000-0000-0000-0000-000000000003'),0,'titular não lê consentimentos de terceiros');
reset role;
select is((select count(*)::int from public.privacy_consent_events where user_id='71000000-0000-0000-0000-000000000001'),2,'concessão e revogação sobrevivem como histórico mínimo de comprovação, mesmo após eliminar a medida');

-- Simula uma medida legada deixada por manutenção antes da correção. Revogar de novo
-- mantém o histórico idempotente, mas garante que nenhum dado corporal sobreviva.
select pg_temp.set_test_user(null,true);
insert into public.body_measurements(user_id,date,weight_kg)
values ('71000000-0000-0000-0000-000000000001',now(),80);
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000001',true);
select is((public.set_privacy_consent('health_data',false,null,'settings')->>'changed')::boolean,false,'revogação repetida não cria evento');
select is((select count(*)::int from public.body_measurements where user_id='71000000-0000-0000-0000-000000000001'),0,'revogação repetida também elimina medida legada');
reset role;

-- 4c) 20261212000005: revogação sem evento anterior também elimina legado -----
select pg_temp.set_test_user(null,true);
insert into public.body_measurements(user_id,date,weight_kg)
values ('71000000-0000-0000-0000-000000000002',now(),81);
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000002',true);
select lives_ok($$select public.set_privacy_consent('health_data',false,null,'settings')$$,'revogar sem nunca ter concedido não falha');
select is((public.set_privacy_consent('health_data',false,null,'settings')->>'changed')::boolean,false,'revogação repetida sem histórico prévio é no-op idempotente');
select is((select count(*)::int from public.privacy_consent_events where user_id='71000000-0000-0000-0000-000000000002'),0,'nenhum evento é criado para quem nunca concedeu');
select is((select count(*)::int from public.body_measurements where user_id='71000000-0000-0000-0000-000000000002'),0,'revogação sem evento anterior apaga medida legada');
reset role;
update public.users set account_status='disabled' where id='71000000-0000-0000-0000-000000000001';
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000001',true);
select throws_ok($$select public.set_privacy_consent('health_data',true,'health-data-1','settings')$$,'PERMISSION_DENIED','conta desativada não concede novo consentimento');
select lives_ok($$select public.set_privacy_consent('health_data',false,null,'settings')$$,'mas revogar continua possível');
reset role;

-- 4b) 20261212000003: direitos que subsistem sem aceite da versão vigente ----------------
update public.users set legal_acceptance_version='0.0.1' where id='71000000-0000-0000-0000-000000000003';
set local role authenticated;
select pg_temp.set_test_user('71000000-0000-0000-0000-000000000003',true);
select ok(not public.has_app_access(),'termos desatualizados bloqueiam o acesso geral');
select lives_ok($$select public.get_refund_policy()$$,'política de reembolso continua consultável');
select lives_ok($$select public.list_refund_requests(false,null,20)$$,'pedidos de reembolso continuam consultáveis');
select lives_ok($$select public.get_refund_balance()$$,'saldo/reservas continuam consultáveis');
select throws_ok($$select public.quote_commercial_order(gen_random_uuid(),'1',gen_random_uuid())$$,'42501','APP_ACCESS_DENIED','nova contratação continua exigindo aceite vigente');
select throws_ok($$select public.create_evocash_purchase_quote('5',gen_random_uuid())$$,'42501','PERMISSION_DENIED','nova compra continua exigindo aceite vigente');
select pg_temp.revoke_test_session('71000000-0000-0000-0000-000000000003');
select throws_ok($$select public.list_refund_requests(false,null,20)$$,'42501','APP_ACCESS_DENIED','sessão revogada não consulta reembolsos');
reset role;
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like '%refund%' and p.prosrc like '%require_commercial_user()%'),0,'nenhuma RPC de reembolso depende do aceite vigente');

-- 5) Endurecimento de funções -------------------------------------------------------
select ok(not has_function_privilege('anon','public.accept_legal_documents(jsonb)','execute'),'anônimo não aceita termos');
select ok(has_table_privilege('anon','public.privacy_consent_texts','select'),'texto do consentimento é público');
select ok(not has_table_privilege('anon','public.privacy_consent_events','select'),'eventos de consentimento não são públicos');
select ok(not has_function_privilege('anon','public.set_privacy_consent(text,boolean,text,text)','execute'),'anônimo não altera consentimento');
select ok(not has_function_privilege('authenticated','private.record_privacy_consent(uuid,text,boolean,text,text)','execute'),'helper privado não é exposto');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where p.prosecdef and n.nspname in ('public','private')
    and p.proname in ('accept_legal_documents','set_privacy_consent','get_my_privacy_consents','publish_legal_policy',
      'admin_publish_legal_policy','record_privacy_consent','has_privacy_consent','require_health_consent','is_known_minor','block_minor_purchase','require_rights_user')
    and not coalesce(p.proconfig @> array['search_path=""'],false)),0,'toda função SECURITY DEFINER nova fixa search_path vazio');

select * from finish();
rollback;
