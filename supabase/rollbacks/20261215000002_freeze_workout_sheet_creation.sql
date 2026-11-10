-- Operational rollback: stop new-sheet creation while a human reviews. Re-granting EXECUTE later
-- resumes the FIXED reconciliation behavior (not the old discard-on-retry bug) since this never
-- reverts the function body, only pauses the entrypoint.
begin;
revoke execute on function public.create_workout_sheet(uuid,text,text,text,smallint[],jsonb,uuid) from authenticated;
commit;
