-- Operational rollback: stop further deletions (and the RPCs this migration redefined) while a
-- human reviews. Never drops the new deleted_at column: that would destroy the only remaining
-- historical attribution for any sheet already soft-deleted under the new behavior. Reverting the
-- redefined functions back to their pre-migration bodies (which physically DELETE the sheet row
-- and lose workout_sheet_completions via CASCADE) is NOT offered here on purpose -- that would
-- reintroduce the exact data-loss bug this migration fixes. Apply only after deployment review.
begin;
revoke execute on function
 public.delete_workout_sheet(uuid,bigint),
 public.save_workout_sheet(uuid,bigint,jsonb,jsonb),
 public.duplicate_workout_sheet(uuid,uuid),
 public.set_workout_sheet_archived(uuid,boolean,bigint),
 public.list_my_workout_sheets(boolean,integer),
 public.get_my_workout_sheet(uuid,boolean)
from authenticated;
commit;
