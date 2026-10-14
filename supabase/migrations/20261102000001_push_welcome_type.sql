-- Separate transaction: the enum label is used only by the following migration.
alter type public.notification_type add value if not exists 'push_welcome';
