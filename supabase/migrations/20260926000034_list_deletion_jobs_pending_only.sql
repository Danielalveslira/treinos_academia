-- listDeletionJobs (main) só retorna jobs 'pending' — 'blocked_financial_review' fica
-- de fora até o painel de revisão financeira dedicado ser portado.
create or replace function public.list_deletion_jobs() returns setof public.deletion_jobs
  language sql stable security definer set search_path = public as $$
    select * from public.deletion_jobs
    where public.is_superadmin() and state = 'pending'
    order by updated_at asc
    limit 50
$$;
