-- Enum additions must commit before the value is used by the next migration.
alter type public.notification_type add value if not exists 'workout_reminder_before';
alter type public.notification_type add value if not exists 'workout_reminder_start';
