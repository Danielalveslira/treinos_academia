-- Operational rollback: stop create-conflict recovery by request id while a human reviews.
-- The frontend falls back to its existing error message (edits stay visible, just unresolved).
begin;
revoke execute on function public.get_my_workout_sheet_by_request_id(uuid) from authenticated;
commit;
