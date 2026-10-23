-- Keep the established superadmin-only batched read, also denying revoked JWTs.
-- No rows, balances, events or backend worker permissions are changed.
set local lock_timeout = '5s';
alter policy cash_purchase_reminder_emails_select on public.cash_purchase_reminder_emails
 using (public.is_superadmin() and public.is_session_active());
