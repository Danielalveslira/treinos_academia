begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_temp;
select no_plan();

select ok(exists (
  select 1 from pg_publication_tables
  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'),
  'notifications está na publicação do Realtime');
select ok((select pubinsert and pubupdate from pg_publication where pubname = 'supabase_realtime'), 'a publicação emite INSERT e UPDATE');

-- A RLS que o Realtime usa para entregar eventos: só o destinatário enxerga a linha.
select ok((select relrowsecurity from pg_class where oid = 'public.notifications'::regclass), 'RLS ativa em notifications');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'notifications' and cmd = 'SELECT'
  and qual ilike '%recipient_id%auth.uid()%'), 1, 'única policy de SELECT: recipient_id = auth.uid()');
select ok(not has_table_privilege('anon', 'public.notifications', 'SELECT'), 'anon não lê notifications');
select ok(not has_table_privilege('authenticated', 'public.notifications', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.notifications', 'DELETE'), 'cliente não escreve direto em notifications');

-- Idempotência da migration: reaplicar não falha nem duplica a tabela na publicação.
select lives_ok($t$
  do $m$ begin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications') then
      alter publication supabase_realtime add table public.notifications;
    end if;
  end $m$
$t$, 'reaplicar é idempotente');
select is((select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'notifications'), 1, 'uma única entrada na publicação');

select * from finish();
rollback;
