-- Required for AuthContext's postgres_changes subscription (reflects admin actions
-- like disabling an account in other sessions in near real time).
alter publication supabase_realtime add table public.users;
