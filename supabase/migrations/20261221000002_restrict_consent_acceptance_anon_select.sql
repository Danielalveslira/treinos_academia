-- public.commercial_terms_acceptances and public.privacy_consent_events already block every
-- write from anon/authenticated and restrict visible rows via RLS (user_id = auth.uid() or
-- is_superadmin()). Neither 20261212000001_legal_acceptance_integrity.sql nor
-- 20261212000002_commercial_terms_evidence.sql revoked SELECT from anon specifically -- only
-- insert/update/delete/truncate -- so anon kept the table-level SELECT every new public table
-- gets by default. RLS already returns zero rows to anon today (auth.uid() is null for an
-- unauthenticated request), so there is no live data exposure, but the grant is still a layer
-- that should not exist: if an RLS policy ever regressed, anon would fail open onto real
-- acceptance/consent records instead of being stopped by a permission-denied first. Only the
-- grant is revoked; RLS, the authenticated grant and every other privilege are unchanged.
revoke select on public.commercial_terms_acceptances from anon;
revoke select on public.privacy_consent_events from anon;
