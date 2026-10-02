begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

-- 1 usuário comum (autor/denunciante), 2 e 3 superadmins, 4 outro usuário comum.
insert into auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select ('83000000-0000-0000-0000-0000000000' || n)::uuid,
       'authenticated', 'authenticated', 'notif-' || n || '@example.invalid',
       'not-used', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
from unnest(array['01','02','03','04']) as n;

update public.users set role = 'superadmin'
where id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003');

insert into public.communities (id, name, created_by, owner_id)
values (
  '84000000-0000-0000-0000-000000000001', 'Notificações',
  '83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000001'
);

-- Uma denúncia criada por um usuário comum gera alerta para CADA superadmin, e só para eles.
insert into public.support_requests (id, user_id, kind, message, category, community_id)
values (
  '85000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000001', 'report',
  'Conteúdo impróprio na publicação', 'fraud_or_scam',
  '84000000-0000-0000-0000-000000000001'
);

select is(
  (select count(*)::int from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000001' and type = 'admin_report'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003')),
  2, 'a nova denúncia notifica os dois superadmins do teste'
);
select is(
  (select count(*)::int from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000001', '83000000-0000-0000-0000-000000000004')),
  0, 'usuários comuns (inclusive o denunciante) não recebem alerta administrativo'
);
select is(
  (select priority from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003') limit 1),
  'high', 'fraude/golpe tem prioridade alta'
);
select is(
  (select action_url from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003') limit 1),
  '/admin/moderacao', 'o alerta aponta para a fila de moderação'
);
select ok(
  (select not (metadata::text like '%impróprio%') and actor_id is null
   from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003') limit 1),
  'o alerta não vaza o texto da denúncia nem a identidade do denunciante'
);

-- Decisão de moderação avisa os OUTROS superadmins (não quem decidiu).
insert into public.moderation_decisions (
  id, request_id, admin_id, target_user_id, action, community_id, rule, reason, evidence
) values (
  '86000000-0000-0000-0000-000000000001', '85000000-0000-0000-0000-000000000001',
  '83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000004',
  'community_ban', '84000000-0000-0000-0000-000000000001',
  'Regra de teste', 'Motivo de teste', 'Evidência de teste'
);
select is(
  (select recipient_id from public.notifications
   where entity_id = '86000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003')),
  '83000000-0000-0000-0000-000000000003'::uuid,
  'a restrição notifica o outro superadmin e não o autor da decisão'
);
select is(
  (select type::text from public.notifications
   where entity_id = '86000000-0000-0000-0000-000000000001'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003') limit 1),
  'admin_restriction', 'banimento de comunidade é uma restrição'
);

-- Leitura: cada usuário só enxerga as próprias notificações.
set local role authenticated;
select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000004', true);
select is(
  (select count(*)::int from public.notification_items), 0,
  'um usuário comum não vê alertas dos superadmins'
);
select is(public.notifications_unread_count(), 0, 'badge do usuário comum é zero');

select set_config('request.jwt.claim.sub', '83000000-0000-0000-0000-000000000003', true);
select is(public.notifications_unread_count(), 2, 'badge conta só as não lidas do próprio admin');
select throws_ok(
  $$insert into public.notifications (recipient_id, type) values (auth.uid(), 'admin_report')$$,
  '42501', null, 'cliente não consegue inserir notificações (nem forjar alerta administrativo)'
);

-- Marcar como lida reduz o badge; limpar arquiva sem apagar o evento original.
select is(
  public.notifications_mark_read(null, now() + interval '1 minute'), 2,
  'marcar todas como lidas atualiza as duas'
);
select is(public.notifications_unread_count(), 0, 'badge zera depois de marcar como lidas');
select is(
  public.notifications_archive(null, now() + interval '1 minute'), 2,
  'limpar arquiva as notificações do próprio usuário'
);
select is(
  (select count(*)::int from public.notification_items), 0,
  'arquivadas somem da lista'
);

reset role;
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '83000000-0000-0000-0000-000000000003'
     and archived_at is not null),
  2, 'limpar não apagou fisicamente as notificações'
);
select is(
  (select count(*)::int from public.support_requests
   where id = '85000000-0000-0000-0000-000000000001'),
  1, 'limpar não apagou a denúncia original'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '83000000-0000-0000-0000-000000000002'
     and archived_at is null),
  1, 'arquivar não afeta as notificações de outro usuário'
);

-- Recurso, pedido de privacidade e exclusão travada também geram alerta para os superadmins.
insert into public.support_requests (id, user_id, kind, message)
values
  ('85000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000001', 'appeal',
   'Quero contestar a decisão tomada'),
  ('85000000-0000-0000-0000-000000000003', '83000000-0000-0000-0000-000000000001', 'privacy',
   'Quero acessar os meus dados pessoais');

select is(
  (select count(*)::int from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000002' and type = 'admin_appeal'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003')),
  2, 'um recurso gera alerta para os superadmins'
);
select is(
  (select priority from public.notifications
   where entity_id = '85000000-0000-0000-0000-000000000003'
     and recipient_id = '83000000-0000-0000-0000-000000000002'),
  'high', 'pedido de privacidade gera alerta de prioridade alta'
);

insert into public.deletion_jobs (id, kind, target_id, requested_by)
values (
  '87000000-0000-0000-0000-000000000001', 'account',
  '83000000-0000-0000-0000-000000000004', '83000000-0000-0000-0000-000000000004'
);
update public.deletion_jobs set state = 'blocked_financial_review'
where id = '87000000-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.notifications
   where entity_id = '87000000-0000-0000-0000-000000000001' and type = 'admin_deletion_review'
     and recipient_id in ('83000000-0000-0000-0000-000000000002', '83000000-0000-0000-0000-000000000003')),
  2, 'exclusão travada por revisão financeira gera alerta'
);

select * from finish();
rollback;
