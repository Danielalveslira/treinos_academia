-- Consolidation: tolerate older local installs without weakening the fresh schema.
-- No balances, ledger entries, prices, rights, sales flags or editorial data change.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
begin
 if not exists(select 1 from pg_constraint where conrelid='public.evocash_price_audit'::regclass and conname='evocash_price_audit_applied_revision_check') then
  alter table public.evocash_price_audit add constraint evocash_price_audit_applied_revision_check check(applied_revision>0) not valid;
 end if;
 if not exists(select 1 from pg_constraint where conrelid='public.evocash_price_audit'::regclass and conname='evocash_price_audit_check') then
  alter table public.evocash_price_audit add constraint evocash_price_audit_check check(action<>'publish' or price_version_id is not null) not valid;
 end if;
end $$;
alter table public.evocash_price_audit validate constraint evocash_price_audit_applied_revision_check;
alter table public.evocash_price_audit validate constraint evocash_price_audit_check;
-- Every creation supplies its explicit idempotency payload; an empty fallback
-- would hide a missing request snapshot in a manually bootstrapped local schema.
alter table private.advertising_drafts alter column creation_request drop default;
revoke execute on function public.admin_list_professional_listings(text,text,uuid,integer) from service_role;
