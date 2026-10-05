-- Novos tipos do pipeline único de notificações. Em arquivo próprio: um valor de enum recém
-- adicionado só pode ser usado depois do commit da transação que o criou.
alter type public.notification_type add value if not exists 'post_like';
alter type public.notification_type add value if not exists 'economy_credit';
alter type public.notification_type add value if not exists 'economy_debit';
alter type public.notification_type add value if not exists 'moderation_notice';
alter type public.notification_type add value if not exists 'report_resolved';
