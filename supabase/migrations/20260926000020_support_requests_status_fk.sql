-- decide_support_request's 'remove_content' action deletes the reported status, but the
-- original FK (implicit ON DELETE NO ACTION) blocked that while a support_requests row
-- still referenced it. Firestore had no such referential-integrity check to violate;
-- the Postgres-native equivalent is to null the reference out instead of blocking the
-- delete — the support request itself (and its content_snapshot) still records what the
-- reported content was.
alter table public.support_requests drop constraint support_requests_status_id_fkey;
alter table public.support_requests
  add constraint support_requests_status_id_fkey foreign key (status_id)
  references public.statuses(id) on delete set null;
