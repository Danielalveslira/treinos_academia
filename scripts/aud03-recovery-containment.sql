-- PREPARED ONLY: execute on confirmed production only for emergency containment.
-- Preserves all rows, RLS, integrity trigger and protected read contract.
begin;
set local lock_timeout='5s';
revoke insert,update,delete on public.status_votes from public,anon,authenticated;
do $$ declare c record; begin
  for c in select attname from pg_attribute where attrelid='public.status_votes'::regclass
    and attnum>0 and not attisdropped loop
    execute format('revoke insert (%I), update (%I) on public.status_votes from public,anon,authenticated',c.attname,c.attname);
  end loop;
end $$;
-- If aggregate RPCs themselves are the incident, also temporarily revoke their
-- EXECUTE privileges. Restore only through a reviewed corrective migration.
notify pgrst,'reload schema';
commit;
