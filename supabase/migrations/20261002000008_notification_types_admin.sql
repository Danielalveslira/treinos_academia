-- Novos tipos de notificação administrativa. Em arquivo próprio porque um valor de enum
-- recém-adicionado só pode ser usado depois do commit da transação que o criou.
alter type public.notification_type add value if not exists 'admin_report';
alter type public.notification_type add value if not exists 'admin_appeal';
alter type public.notification_type add value if not exists 'admin_privacy_request';
alter type public.notification_type add value if not exists 'admin_moderation_decision';
alter type public.notification_type add value if not exists 'admin_restriction';
alter type public.notification_type add value if not exists 'admin_deletion_review';
