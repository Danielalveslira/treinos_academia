begin;
select no_plan();

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('74000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'remind-active@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'remind-disabled@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'remind-admin@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'remind-concurrent@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'remind-credited@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'remind-cancelled@example.invalid', 'unused', now(), '{}', '{}', now(), now());
update public.users set role = 'superadmin' where id = '74000000-0000-0000-0000-000000000003';
select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', true);
select public.set_username('reminderactive');

create temp table _rm_active as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000001', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_active), 'https://checkout.infinitepay.io/evolutus?lenc=remind');

-- Autorização: só superadmin.
select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000001', true);
select throws_ok($$select public.admin_request_cash_purchase_reminder('00000000-0000-0000-0000-000000000000')$$,
  'PERMISSION_DENIED', 'comprador não pode enfileirar seu próprio lembrete');
select throws_ok($$select public.admin_get_cash_purchase_reminder_preview('00000000-0000-0000-0000-000000000000')$$,
  'PERMISSION_DENIED', 'comprador não pode ver a pré-visualização');

select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000003', true);

-- Pré-visualização: username + e-mail mascarado, nunca o e-mail real.
-- "remind-active" (13 chars) -> "re" + 11 asteriscos; "example.invalid" -> "e" + 6
-- asteriscos + ".invalid" (ver private._mask_email).
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_active))->>'username'),
  'reminderactive', 'preview resolve o username');
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_active))->>'maskedEmail'),
  're***********@e******.invalid', 'preview mascara o email, nunca devolve o real');
select ok((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_active))->>'maskedEmail')
  not like '%remind-active@example.invalid%', 'preview nunca contém o e-mail real');
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_active))->>'canSend'),
  'true', 'preview indica que o envio é permitido');

-- Compra pendente, conta ativa: enfileira com sucesso.
select is((public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_active))->>'queued'),
  'true', 'compra pendente de conta ativa pode ser enfileirada');
select is((select count(*)::int from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_active)), 1, 'uma linha enfileirada');
select is((select status from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_active)), 'pending', 'linha começa pending (worker assíncrono ainda não rodou)');
select is((select requested_by from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_active)), '74000000-0000-0000-0000-000000000003',
  'admin que pediu o lembrete é registrado');

-- Cooldown: segunda tentativa na mesma janela é bloqueada, não gera linha duplicada.
select is((public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_active))->>'queued'),
  'false', 'segunda tentativa dentro do cooldown é bloqueada');
select is((public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_active))->>'reason'),
  'cooldown', 'motivo do bloqueio é cooldown');
select is((select count(*)::int from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_active)), 1, 'nenhuma segunda linha foi criada (idempotente)');
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_active))->>'canSend'),
  'false', 'preview reflete o cooldown');

-- Concorrência: a RPC trava a compra (for update) -- duas chamadas no mesmo instante nunca
-- produzem duas linhas; simulado aqui como duas chamadas sequenciais na mesma transação de
-- teste (o lock garante que a segunda sempre veja a primeira já commitada). Usuário dedicado
-- (só 1 compra pendente por vez por usuário).
create temp table _rm_concurrent as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000004', 'pack_50_v2') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_concurrent), 'https://checkout.infinitepay.io/evolutus?lenc=concurrent');
select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_concurrent));
select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_concurrent));
select is((select count(*)::int from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_concurrent)), 1, 'duplo clique nunca gera dois lembretes para a mesma compra');

-- Compra CREDITADA: nunca enfileira. Usuário dedicado.
create temp table _rm_credited as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000005', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_credited), 'https://checkout.infinitepay.io/evolutus?lenc=credited');
select public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _rm_credited),
  (select r->>'orderNsu' from _rm_credited), 'txn-remind-credited', 'invoice-remind-credited', 590, 'pix', null);
select throws_ok($$select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_credited))$$,
  'PURCHASE_NOT_PENDING', 'compra creditada nunca recebe lembrete');

-- Compra CANCELADA: nunca enfileira. Usuário dedicado.
create temp table _rm_cancelled as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000006', 'pack_120') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_cancelled), 'https://checkout.infinitepay.io/evolutus?lenc=cancelled');
select public.admin_cancel_infinitepay_cash_purchase((select (r->>'id')::uuid from _rm_cancelled), 'teste de cancelamento antes do lembrete');
select throws_ok($$select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_cancelled))$$,
  'PURCHASE_NOT_PENDING', 'compra cancelada nunca recebe lembrete');

-- Conta DESATIVADA: mesmo com compra pendente, nunca enfileira (fora de escopo desta feature).
create temp table _rm_disabled as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000002', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_disabled), 'https://checkout.infinitepay.io/evolutus?lenc=disabledremind');
update public.users set account_status = 'disabled' where id = '74000000-0000-0000-0000-000000000002';
select throws_ok($$select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_disabled))$$,
  'ACCOUNT_NOT_ACTIVE', 'conta desativada nunca recebe lembrete por e-mail');
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_disabled))->>'canSend'),
  'false', 'preview também recusa conta desativada');
select is((public.admin_get_cash_purchase_reminder_preview((select (r->>'id')::uuid from _rm_disabled))->>'reason'),
  'account_not_active', 'motivo é account_not_active');

-- Worker (claim/finish): fila -> claim resolve e-mail/username -> finish marca sent.
create temp table _rm_claim as select * from public.claim_cash_purchase_reminder_jobs('worker-1', 10);
select is((select count(*)::int from _rm_claim), 2, 'worker reclama os 2 lembretes pendentes (_rm_active e _rm_concurrent)');
select is((select email from _rm_claim where purchase_id = (select (r->>'id')::uuid from _rm_active)),
  'remind-active@example.invalid', 'claim resolve o e-mail real só para o worker (service_role)');
select ok((select bool_and(status = 'pending') from public.cash_purchase_reminder_emails where id in (select id from _rm_claim)),
  'linhas ficam pending (locked) enquanto o worker processa');
select ok((select bool_and(locked_at is not null) from public.cash_purchase_reminder_emails where id in (select id from _rm_claim)),
  'linhas reclamadas ficam travadas para outro worker não pegar');
select public.finish_cash_purchase_reminder_batch('worker-1',
  (select jsonb_agg(jsonb_build_object('id', id, 'outcome', 'sent')) from _rm_claim));
select is((select count(*)::int from public.cash_purchase_reminder_emails where id in (select id from _rm_claim) and status = 'sent'),
  2, 'finish marca as duas linhas como enviadas');
select ok((select bool_and(sent_at is not null and locked_at is null) from public.cash_purchase_reminder_emails where id in (select id from _rm_claim)),
  'sent_at gravado e o lock liberado em todas');
select is((select count(*)::int from public.claim_cash_purchase_reminder_jobs('worker-2', 10)), 0,
  'depois de enviado, nada mais fica pendente para outro worker');

-- ============================================================================
-- Revalidação no claim: a compra pode mudar de estado ENTRE o clique (enfileirar) e o
-- envio (claim do worker). O claim precisa reconfirmar pendente+conta ativa de novo, e
-- marcar a linha como cancelled (com motivo) em vez de deixá-la pronta para o worker
-- enviar -- nunca um e-mail sobre uma compra que já não é mais o que o e-mail diria.
-- ============================================================================

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('74000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'remind-paidmeanwhile@example.invalid', 'unused', now(), '{}', '{}', now(), now()),
  ('74000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'remind-disabledmeanwhile@example.invalid', 'unused', now(), '{}', '{}', now(), now());

-- Compra PAGA depois de enfileirado o lembrete, antes do worker reclamar.
create temp table _rm_paid_meanwhile as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000007', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_paid_meanwhile), 'https://checkout.infinitepay.io/evolutus?lenc=paidmeanwhile');
select set_config('request.jwt.claim.sub', '74000000-0000-0000-0000-000000000003', true);
select is((public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_paid_meanwhile))->>'queued'),
  'true', 'lembrete enfileirado enquanto a compra ainda estava pendente');
select public.confirm_infinitepay_cash_purchase((select (r->>'id')::uuid from _rm_paid_meanwhile),
  (select r->>'orderNsu' from _rm_paid_meanwhile), 'txn-paidmeanwhile', 'invoice-paidmeanwhile', 590, 'pix', null);
select is((select count(*)::int from public.claim_cash_purchase_reminder_jobs('worker-paid-check', 10)
  where purchase_id = (select (r->>'id')::uuid from _rm_paid_meanwhile)), 0,
  'compra paga entre o clique e o envio NUNCA é devolvida ao worker (nenhum e-mail é enviado)');
select is((select status from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_paid_meanwhile)), 'cancelled',
  'o item é marcado cancelled em vez de ficar pronto para envio');
select is((select last_error from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_paid_meanwhile)), 'purchase_status_credited',
  'o motivo do cancelamento é registrado');

-- Conta DESATIVADA depois de enfileirado o lembrete, antes do worker reclamar.
create temp table _rm_disabled_meanwhile as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000008', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_disabled_meanwhile), 'https://checkout.infinitepay.io/evolutus?lenc=disabledmeanwhile');
select is((public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_disabled_meanwhile))->>'queued'),
  'true', 'lembrete enfileirado enquanto a conta ainda estava ativa');
update public.users set account_status = 'disabled' where id = '74000000-0000-0000-0000-000000000008';
select is((select count(*)::int from public.claim_cash_purchase_reminder_jobs('worker-disabled-check', 10)
  where purchase_id = (select (r->>'id')::uuid from _rm_disabled_meanwhile)), 0,
  'conta desativada entre o clique e o envio NUNCA é devolvida ao worker');
select is((select status from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_disabled_meanwhile)), 'cancelled',
  'o item é marcado cancelled em vez de ficar pronto para envio');
select is((select last_error from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_disabled_meanwhile)), 'account_not_active',
  'o motivo do cancelamento é registrado');

-- ============================================================================
-- Lease: um item reivindicado (claim) cujo worker nunca chama finish_cash_purchase_
-- reminder_batch (crash, timeout do runtime, instância morta) fica travado -- até o lock
-- expirar. O limite é 5 minutos (abaixo das 24h de retenção da Idempotency-Key no Resend;
-- ver comentário de claim_cash_purchase_reminder_jobs).
-- ============================================================================
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values ('74000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'remind-lease@example.invalid', 'unused', now(), '{}', '{}', now(), now());

create temp table _rm_lease as
  select public.reserve_infinitepay_cash_purchase('74000000-0000-0000-0000-000000000009', 'pack_25') as r;
select public.finish_infinitepay_checkout((select (r->>'id')::uuid from _rm_lease), 'https://checkout.infinitepay.io/evolutus?lenc=lease');
select public.admin_request_cash_purchase_reminder((select (r->>'id')::uuid from _rm_lease));

create temp table _rm_lease_claim1 as
  select * from public.claim_cash_purchase_reminder_jobs('worker-crashed', 10)
  where purchase_id = (select (r->>'id')::uuid from _rm_lease);
select is((select count(*)::int from _rm_lease_claim1), 1, 'worker-crashed reclama o item');
select is((select attempt_count from _rm_lease_claim1), 1, 'primeira tentativa registrada');
select ok((select locked_by = 'worker-crashed' from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_lease)), 'item travado pelo worker-crashed');

-- worker-crashed nunca chama finish (simulando o crash) -- com o lock ainda fresco, nenhum
-- outro worker pode reclamar o mesmo item.
select is((select count(*)::int from public.claim_cash_purchase_reminder_jobs('worker-too-soon', 10)
  where purchase_id = (select (r->>'id')::uuid from _rm_lease)), 0,
  'lock fresco (< 5 min) nunca é reclamado por outro worker');

-- Simula o lock ter passado dos 5 minutos sem finish (crash real teria deixado assim).
update public.cash_purchase_reminder_emails set locked_at = now() - interval '6 minutes'
  where purchase_id = (select (r->>'id')::uuid from _rm_lease);
create temp table _rm_lease_claim2 as
  select * from public.claim_cash_purchase_reminder_jobs('worker-recovered', 10)
  where purchase_id = (select (r->>'id')::uuid from _rm_lease);
select is((select count(*)::int from _rm_lease_claim2), 1,
  'lock expirado (> 5 min) É reclamado pelo próximo worker');
select is((select attempt_count from _rm_lease_claim2), 2, 'segunda tentativa registrada após o reclaim');
select ok((select locked_by = 'worker-recovered' from public.cash_purchase_reminder_emails
  where purchase_id = (select (r->>'id')::uuid from _rm_lease)), 'item agora travado pelo worker-recovered');

select * from finish();
rollback;
