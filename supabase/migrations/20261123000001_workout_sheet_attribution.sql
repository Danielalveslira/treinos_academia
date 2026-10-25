-- Additive only: links a workout row to the sheet it was registered under, for the Home's
-- "próxima ficha recomendada" / "última ficha treinada" / "mais treinada no mês" panel.
-- Does NOT touch public.workouts' existing columns, RLS policy, EvoCoins/complete_workout_session,
-- or the offline outbox sync path (apply_workout_mutation/sync_workout_mutations): sheet_id is only
-- ever set by the direct online write path in the client; outbox-synced rows simply have it null.
set local lock_timeout = '5s';

alter table public.workouts add column sheet_id uuid;
alter table public.workouts add constraint workouts_sheet_id_fkey
  foreign key (sheet_id, user_id) references public.workout_sheets(id, user_id) on delete set null;
-- "Mais treinada no mês" / "última execução por ficha" read only recent, sheet-scoped rows.
create index workouts_sheet_activity_idx on public.workouts(user_id, sheet_id, date desc)
  where sheet_id is not null;

-- sheet_id is a fact about when/how the row was CREATED, never an editable field: an unrelated
-- edit (fixing a weight/note from History.jsx) must never move or clear a row's sheet attribution.
-- Extends the existing immutability guard (created_at, type) rather than adding a second trigger.
create or replace function public.enforce_workout_immutable_fields() returns trigger
  language plpgsql as $$
begin
  if new.created_at <> old.created_at then
    raise exception 'CREATED_AT_IMMUTABLE';
  end if;
  if new.type <> old.type then
    raise exception 'TYPE_IMMUTABLE';
  end if;
  if new.sheet_id is distinct from old.sheet_id then
    raise exception 'SHEET_ID_IMMUTABLE';
  end if;
  return new;
end;
$$;
