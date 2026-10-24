-- Operational rollback: retain every new sheet/item. Apply only after deployment review.
-- Revert the frontend separately. Restore EXECUTE via the reviewed migration grants to resume.
begin;
revoke execute on function
 public.create_workout_sheet(uuid,text,text,text,smallint[],jsonb,uuid),
 public.save_workout_sheet(uuid,bigint,jsonb,jsonb),
 public.duplicate_workout_sheet(uuid,uuid),
 public.set_workout_sheet_archived(uuid,boolean,bigint),
 public.reorder_workout_sheets(uuid[])
from authenticated;
commit;
